import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Eraser, Image as ImageIcon, Pencil, RotateCcw, Trash2, Type, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";


type Tool = "edit" | "text" | "image" | "whiteout";

/** A real piece of text found inside the PDF, with its position and font look. */
type TextItem = {
  key: string;
  page: number;
  original: string;
  value: string;
  x: number;
  /** baseline y in page points, origin bottom-left (as PDF stores it) */
  baseline: number;
  w: number;
  size: number;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
  /** extra bold thickness: 1 = normal bold, 2/3 = heavier (faux bold passes) */
  weight?: number;
  /** true when the look (bold/italic/serif/size) was changed by hand */
  dirty?: boolean;
  /** paper colour sampled right around the line, used for the on-screen preview */
  bg?: string;


};

type PdfMeta = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
};

type Obj = {
  id: string;
  page: number;
  type: Tool;
  /** page-point coordinates, origin top-left */
  x: number;
  y: number;
  text?: string;
  size?: number;
  color?: string;
  w?: number;
  h?: number;
  dataUrl?: string;
};

type PageInfo = { png: string; width: number; height: number };

const DISPLAY_W = 700;

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#111111");
  if (!m) return { r: 0.07, g: 0.07, b: 0.07 };
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

/**
 * Recreate what sits behind a line of text (paper tint, watermark, coloured band)
 * by blending the pixel strips just above and below it, so replaced text does not
 * end up inside a white box.
 */
function buildBackgroundPatch(
  src: HTMLCanvasElement | undefined,
  rect: { x: number; y: number; w: number; h: number },
  pageHeightPt: number,
): string | null {
  if (!src) return null;
  const scale = src.height / pageHeightPt;
  const px = Math.max(0, Math.round(rect.x * scale));
  const pw = Math.max(1, Math.round(rect.w * scale));
  const pTop = Math.max(0, Math.round((pageHeightPt - rect.y - rect.h) * scale));
  const ph = Math.max(1, Math.round(rect.h * scale));
  if (px + pw > src.width || pTop + ph > src.height) return null;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  const gap = Math.max(2, Math.round(scale));
  const rowAbove = Math.max(0, pTop - gap);
  const rowBelow = Math.min(src.height - 1, pTop + ph + gap);
  let above: Uint8ClampedArray;
  let below: Uint8ClampedArray;
  try {
    above = sctx.getImageData(px, rowAbove, pw, 1).data;
    below = sctx.getImageData(px, rowBelow, pw, 1).data;
  } catch {
    return null;
  }
  const out = document.createElement("canvas");
  out.width = pw;
  out.height = ph;
  const octx = out.getContext("2d");
  if (!octx) return null;
  const img = octx.createImageData(pw, ph);
  for (let y = 0; y < ph; y++) {
    const t = ph === 1 ? 0 : y / (ph - 1);
    for (let x = 0; x < pw; x++) {
      const si = x * 4;
      const di = (y * pw + x) * 4;
      for (let c = 0; c < 3; c++) {
        img.data[di + c] = Math.round(above[si + c]! * (1 - t) + below[si + c]! * t);
      }
      img.data[di + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out.toDataURL("image/png");
}

/** Average paper colour just above and below a line, as a CSS colour. */
function sampleBackground(
  ctx: CanvasRenderingContext2D,
  pageHeightPt: number,
  scale: number,
  rect: { x: number; y: number; w: number; h: number },
): string {
  try {
    const px = Math.max(0, Math.round(rect.x * scale));
    const pw = Math.max(1, Math.round(rect.w * scale));
    const pTop = Math.max(0, Math.round((pageHeightPt - rect.y - rect.h) * scale));
    const ph = Math.max(1, Math.round(rect.h * scale));
    const gap = Math.max(2, Math.round(scale));
    const rows = [Math.max(0, pTop - gap), Math.min(ctx.canvas.height - 1, pTop + ph + gap)];
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const y of rows) {
      const d = ctx.getImageData(px, y, Math.min(pw, ctx.canvas.width - px), 1).data;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]!;
        g += d[i + 1]!;
        b += d[i + 2]!;
        n++;
      }
    }
    if (!n) return "#ffffff";
    return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
  } catch {
    return "#ffffff";
  }
}



export function PdfEditor() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [objs, setObjs] = useState<Obj[]>([]);
  const [items, setItems] = useState<TextItem[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("edit");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<PdfMeta>({
    title: "",
    author: "",
    subject: "",
    keywords: "",
    creator: "",
    producer: "",
  });
  const [textValue, setTextValue] = useState("Sample text");
  const [fontSize, setFontSize] = useState(14);
  const [color, setColor] = useState("#111111");
  const pendingImage = useRef<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; scale: number } | null>(null);
  /** rendered page bitmaps, kept so replaced text can reuse the real background */
  const pageCanvases = useRef<HTMLCanvasElement[]>([]);


  const sel = objs.find((o) => o.id === selected) ?? null;
  const editItem = items.find((i) => i.key === editingKey) ?? null;
  const changedCount = items.filter((i) => i.value !== i.original || i.dirty).length;

  function updateItem(key: string, value: string) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, value } : i)));
  }

  function patchItem(key: string, patch: Partial<TextItem>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch, dirty: true } : i)));
  }

  const openPdf = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      setBytes(buf);
      setFileName(file.name);
      setObjs([]);
      setItems([]);
      pageCanvases.current = [];
      setEditingKey(null);
      setSelected(null);

      const pdfjs: any = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await pdfjs.getDocument({ data: buf.slice() }).promise;

      const rendered: PageInfo[] = [];
      const found: TextItem[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        rendered.push({ png: canvas.toDataURL("image/png"), width: base.width, height: base.height });
        pageCanvases.current[p - 1] = canvas;


        // Collect the real text of the page so it can be retyped in place.
        try {
          const tc: any = await page.getTextContent();
          const styles: any = tc.styles || {};
          const anyPage: any = page;
          const realName = (fontName: string) => {
            try {
              const fo =
                anyPage.commonObjs?.get?.(fontName) ??
                anyPage.objs?.get?.(fontName) ??
                anyPage._transport?.commonObjs?.get?.(fontName);
              return String(fo?.name || fo?.loadedName || fo?.fallbackName || "");
            } catch {
              return "";
            }
          };
          (tc.items as any[]).forEach((it, i) => {
            const str: string = it.str ?? "";
            if (!str.trim()) return;
            const tr: number[] = it.transform || [1, 0, 0, 1, 0, 0];
            const size = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || 10;
            const st = styles[it.fontName] || {};
            const family = [realName(it.fontName), st.fontFamily, it.fontName].filter(Boolean).join(" ").toLowerCase();
            const weight = Number(st.fontWeight) || 0;
            found.push({
              key: `${p - 1}:${i}`,
              page: p - 1,
              original: str,
              value: str,
              x: tr[4],
              baseline: tr[5],
              w: it.width || size * str.length * 0.5,
              size,
              bold: weight >= 600 || /bold|black|heavy|semibold|[-,]bd\b|extrab/.test(family),
              weight: /black|heavy|extrab|bold900|800/.test(family) || weight >= 800 ? 3 : 2,

              italic: st.italic === true || /italic|oblique/.test(family),
              serif: /times|georgia|garamond|book|minion|cambria|(^|[^s])serif/.test(family) && !/sans/.test(family),
              mono: /mono|courier|consol/.test(family),
              bg: sampleBackground(ctx, base.height, viewport.scale, {
                x: tr[4],
                y: tr[5] - size * 0.26,
                w: Math.max(it.width || size * str.length * 0.5, 2),
                h: size * 1.18,
              }),
            });

          });
        } catch {
          /* text layer unavailable for this page */
        }
      }
      setPages(rendered);
      setItems(found);

      const { PDFDocument } = await import("pdf-lib");
      const lib = await PDFDocument.load(buf.slice(), { updateMetadata: false });
      setMeta({
        title: lib.getTitle() ?? "",
        author: lib.getAuthor() ?? "",
        subject: lib.getSubject() ?? "",
        keywords: (lib.getKeywords() ?? "") as string,
        creator: lib.getCreator() ?? "",
        producer: lib.getProducer() ?? "",
      });
      toast.success(`Loaded ${doc.numPages} page${doc.numPages > 1 ? "s" : ""}`);
    } catch (err: any) {
      toast.error(err?.message || "Could not open this PDF");
    } finally {
      setBusy(false);
    }
  }, []);

  function addObject(pageIdx: number, xPt: number, yPt: number) {
    if (tool === "edit") return;
    const id = Math.random().toString(36).slice(2);
    if (tool === "text") {
      setObjs((o) => [
        ...o,
        { id, page: pageIdx, type: "text", x: xPt, y: yPt, text: textValue || "Text", size: fontSize, color },
      ]);
    } else if (tool === "whiteout") {
      setObjs((o) => [...o, { id, page: pageIdx, type: "whiteout", x: xPt, y: yPt, w: 160, h: 24 }]);
    } else if (tool === "image") {
      if (!pendingImage.current) {
        toast.error("Pick an image file first");
        return;
      }
      setObjs((o) => [
        ...o,
        { id, page: pageIdx, type: "image", x: xPt, y: yPt, w: 120, h: 120, dataUrl: pendingImage.current! },
      ]);
    }
    setSelected(id);
  }

  function updateSel(patch: Partial<Obj>) {
    if (!sel) return;
    setObjs((o) => o.map((x) => (x.id === sel.id ? { ...x, ...patch } : x)));
  }

  async function exportPdf() {
    if (!bytes) return;
    setBusy(true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const fontCache = new Map<string, any>();
      async function fontFor(it: TextItem) {
        const key = `${it.serif ? "s" : it.mono ? "m" : "h"}${it.bold ? "b" : ""}${it.italic ? "i" : ""}`;
        if (fontCache.has(key)) return fontCache.get(key);
        const pick = it.mono
          ? it.bold && it.italic
            ? StandardFonts.CourierBoldOblique
            : it.bold
              ? StandardFonts.CourierBold
              : it.italic
                ? StandardFonts.CourierOblique
                : StandardFonts.Courier
          : it.serif
            ? it.bold && it.italic
              ? StandardFonts.TimesRomanBoldItalic
              : it.bold
                ? StandardFonts.TimesRomanBold
                : it.italic
                  ? StandardFonts.TimesRomanItalic
                  : StandardFonts.TimesRoman
            : it.bold && it.italic
              ? StandardFonts.HelveticaBoldOblique
              : it.bold
                ? StandardFonts.HelveticaBold
                : it.italic
                  ? StandardFonts.HelveticaOblique
                  : StandardFonts.Helvetica;
        const f = await doc.embedFont(pick);
        fontCache.set(key, f);
        return f;
      }
      const docPages = doc.getPages();

      // Retype changed text in place: cover the old line, draw the new one at the same spot.
      for (const it of items) {
        if (it.value === it.original && !it.dirty) continue;
        const page = docPages[it.page];
        if (!page) continue;
        const f = it.value ? await fontFor(it) : null;
        let size = it.size;
        const maxW = Math.max(it.w, 1);
        if (f) {
          // Only shrink a little, so bold/serif text keeps its weight instead of turning tiny.
          const minSize = it.size * 0.82;
          while (size > minSize && f.widthOfTextAtSize(it.value, size) > maxW * 1.15) size -= 0.25;
        }
        const drawnW = f ? f.widthOfTextAtSize(it.value, size) : 0;
        const { height: pgH } = page.getSize();
        const rect = {
          x: it.x - 0.5,
          y: it.baseline - it.size * 0.26,
          w: Math.max(maxW, drawnW) + 1.5,
          h: Math.max(it.size, size) * 1.18,
        };
        // Rebuild the background behind the old line (watermarks, tints, colours)
        // instead of stamping a white box over it.
        const patch = buildBackgroundPatch(pageCanvases.current[it.page], rect, pgH);
        if (patch) {
          const raw = Uint8Array.from(atob(patch.split(",")[1]!), (ch) => ch.charCodeAt(0));
          const img = await doc.embedPng(raw);
          page.drawImage(img, { x: rect.x, y: rect.y, width: rect.w, height: rect.h });
        } else {
          page.drawRectangle({ ...rect, width: rect.w, height: rect.h, color: rgb(1, 1, 1) });
        }

        if (!f) continue;
        const ink = it.bold ? rgb(0, 0, 0) : rgb(0.07, 0.07, 0.07);
        page.drawText(it.value, { x: it.x, y: it.baseline, size, font: f, color: ink });
        if (it.bold) {
          // Faux-bold: redraw with tiny offsets so the stroke matches the PDF's own heavy fonts.
          const strength = Math.max(1, Math.min(3, it.weight ?? 1));
          const step = size * 0.022 * strength;
          const passes: Array<[number, number]> = [
            [step, 0],
            [step * 0.5, step * 0.35],
            [step * 0.5, -step * 0.35],
          ];
          for (let p = 0; p < (strength >= 2 ? passes.length : 1); p++) {
            const [dx, dy] = passes[p]!;
            page.drawText(it.value, { x: it.x + dx, y: it.baseline + dy, size, font: f, color: ink });
          }
        }
      }



      for (const o of objs) {
        const page = docPages[o.page];
        if (!page) continue;
        const { height } = page.getSize();
        if (o.type === "text") {
          const c = hexToRgb(o.color || "#111111");
          page.drawText(o.text || "", {
            x: o.x,
            y: height - o.y - (o.size || 14),
            size: o.size || 14,
            font,
            color: rgb(c.r, c.g, c.b),
          });
        } else if (o.type === "whiteout") {
          page.drawRectangle({
            x: o.x,
            y: height - o.y - (o.h || 24),
            width: o.w || 160,
            height: o.h || 24,
            color: rgb(1, 1, 1),
          });
        } else if (o.type === "image" && o.dataUrl) {
          const isPng = o.dataUrl.startsWith("data:image/png");
          const b64 = o.dataUrl.split(",")[1];
          const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
          const img = isPng ? await doc.embedPng(raw) : await doc.embedJpg(raw);
          page.drawImage(img, {
            x: o.x,
            y: height - o.y - (o.h || 120),
            width: o.w || 120,
            height: o.h || 120,
          });
        }
      }

      doc.setTitle(meta.title || "");
      doc.setAuthor(meta.author || "");
      doc.setSubject(meta.subject || "");
      doc.setKeywords(meta.keywords ? meta.keywords.split(",").map((k) => k.trim()) : []);
      doc.setCreator(meta.creator || "");
      doc.setProducer(meta.producer || "");
      doc.setModificationDate(new Date());

      const out = await doc.save();
      const blob = new Blob([out as unknown as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, "") + "-edited.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(err?.message || "Could not save the PDF");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onUp() {
      drag.current = null;
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Open a PDF</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="file"
              accept="application/pdf"
              className="cursor-pointer"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void openPdf(f);
              }}
            />
            {fileName && <p className="truncate text-xs text-muted-foreground">{fileName}</p>}
            {busy && <p className="text-xs text-muted-foreground">Working…</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={tool === "edit" ? "default" : "outline"} onClick={() => setTool("edit")}>
                <Pencil className="mr-2 h-4 w-4" /> Edit text
              </Button>
              <Button size="sm" variant={tool === "text" ? "default" : "outline"} onClick={() => setTool("text")}>
                <Type className="mr-2 h-4 w-4" /> Text
              </Button>
              <Button size="sm" variant={tool === "whiteout" ? "default" : "outline"} onClick={() => setTool("whiteout")}>
                <Eraser className="mr-2 h-4 w-4" /> Cover
              </Button>
              <Button size="sm" variant={tool === "image" ? "default" : "outline"} onClick={() => setTool("image")}>
                <ImageIcon className="mr-2 h-4 w-4" /> Image
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {tool === "edit"
                ? "Click any existing line on the page and retype it — the look and place stay the same."
                : "Pick a tool, then click on the page to place it. Drag anything to move it."}
            </p>

            {tool === "edit" && (
              <div className="grid gap-2">
                {!items.length ? (
                  <p className="text-xs text-muted-foreground">
                    This PDF has no selectable text (it may be a scan), so use the Text and Cover tools instead.
                  </p>
                ) : editItem ? (
                  <>
                    <Label className="text-xs text-muted-foreground">Selected line</Label>
                    <Input
                      autoFocus
                      value={editItem.value}
                      onChange={(e) => updateItem(editItem.key, e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Was: {editItem.original}</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <Button
                        size="sm"
                        variant={editItem.bold ? "default" : "outline"}
                        onClick={() =>
                          patchItem(editItem.key, { bold: !editItem.bold, weight: editItem.bold ? 1 : 2 })
                        }
                      >
                        <span className="font-bold">B</span>
                      </Button>
                      {editItem.bold && (
                        <div className="flex items-center gap-1">
                          {[1, 2, 3].map((w) => (
                            <Button
                              key={w}
                              size="sm"
                              variant={(editItem.weight ?? 1) === w ? "default" : "outline"}
                              onClick={() => patchItem(editItem.key, { weight: w })}
                              title={`Bold thickness ${w}`}
                            >
                              <span style={{ fontWeight: 500 + w * 100 }}>B{w}</span>
                            </Button>
                          ))}
                        </div>
                      )}

                      <Button
                        size="sm"
                        variant={editItem.italic ? "default" : "outline"}
                        onClick={() => patchItem(editItem.key, { italic: !editItem.italic })}
                      >
                        <span className="italic">I</span>
                      </Button>
                      <Button
                        size="sm"
                        variant={editItem.serif ? "default" : "outline"}
                        onClick={() => patchItem(editItem.key, { serif: !editItem.serif, mono: false })}
                      >
                        <span style={{ fontFamily: "Times, serif" }}>Serif</span>
                      </Button>
                      <div className="w-20">
                        <Label className="text-xs text-muted-foreground">Size</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={Math.round(editItem.size * 10) / 10}
                          onChange={(e) => patchItem(editItem.key, { size: Number(e.target.value) || editItem.size })}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => updateItem(editItem.key, editItem.original)}>
                        <RotateCcw className="mr-2 h-4 w-4" /> Undo this line
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingKey(null)}>
                        Done
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Click a line on the page to change it.</p>
                )}
                {changedCount > 0 && (
                  <p className="text-xs text-muted-foreground">{changedCount} line(s) changed</p>
                )}
              </div>
            )}


            {tool === "text" && (
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">Text to place</Label>
                <Input value={textValue} onChange={(e) => setTextValue(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Size</Label>
                    <Input type="number" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value) || 14)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Colour</Label>
                    <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 p-1" />
                  </div>
                </div>
              </div>
            )}

            {tool === "image" && (
              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">Image (PNG or JPG)</Label>
                <Input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="cursor-pointer"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const fr = new FileReader();
                    fr.onload = () => {
                      pendingImage.current = String(fr.result);
                      toast.success("Image ready — click on the page to place it");
                    };
                    fr.readAsDataURL(f);
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {sel && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Selected item</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sel.type === "text" && (
                <>
                  <div>
                    <Label className="text-xs text-muted-foreground">Text</Label>
                    <Input value={sel.text ?? ""} onChange={(e) => updateSel({ text: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Size</Label>
                      <Input
                        type="number"
                        value={sel.size ?? 14}
                        onChange={(e) => updateSel({ size: Number(e.target.value) || 14 })}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Colour</Label>
                      <Input
                        type="color"
                        className="h-9 p-1"
                        value={sel.color ?? "#111111"}
                        onChange={(e) => updateSel({ color: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}
              {(sel.type === "whiteout" || sel.type === "image") && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Width</Label>
                    <Input
                      type="number"
                      value={sel.w ?? 100}
                      onChange={(e) => updateSel({ w: Number(e.target.value) || 1 })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Height</Label>
                    <Input
                      type="number"
                      value={sel.h ?? 100}
                      onChange={(e) => updateSel({ h: Number(e.target.value) || 1 })}
                    />
                  </div>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setObjs((o) => o.filter((x) => x.id !== sel.id));
                  setSelected(null);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive" /> Remove item
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">File information (metadata)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {(
              [
                ["title", "Title"],
                ["author", "Author"],
                ["subject", "Subject"],
                ["keywords", "Keywords (comma separated)"],
                ["creator", "Created with"],
                ["producer", "Producer"],
              ] as [keyof PdfMeta, string][]
            ).map(([k, label]) => (
              <div key={k}>
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <Input value={meta[k]} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Button className="w-full" disabled={!bytes || busy} onClick={() => void exportPdf()}>
          <Download className="mr-2 h-4 w-4" /> Download edited PDF
        </Button>
      </div>

      <div className="space-y-4">
        {!pages.length ? (
          <Card>
            <CardContent className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Upload className="h-6 w-6" />
              Open a PDF to start editing.
            </CardContent>
          </Card>
        ) : (
          pages.map((p, idx) => {
            const scale = DISPLAY_W / p.width;
            return (
              <div
                key={idx}
                className="relative mx-auto select-none overflow-hidden rounded border bg-white shadow-sm"
                style={{ width: DISPLAY_W, height: p.height * scale }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d) return;
                  const box = e.currentTarget.getBoundingClientRect();
                  const x = (e.clientX - box.left) / scale - d.dx;
                  const y = (e.clientY - box.top) / scale - d.dy;
                  setObjs((o) => o.map((x2) => (x2.id === d.id ? { ...x2, x, y } : x2)));
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).dataset.obj) return;
                  const box = e.currentTarget.getBoundingClientRect();
                  addObject(idx, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale);
                }}
              >
                <img src={p.png} alt={`Page ${idx + 1}`} className="pointer-events-none block w-full" />
                {items
                  .filter((it) => it.page === idx && (tool === "edit" || it.value !== it.original || it.dirty))
                  .map((it) => {
                    const changed = it.value !== it.original || !!it.dirty;
                    return (
                      <div
                        key={it.key}
                        data-obj="1"
                        title={it.original}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (tool !== "edit") return;
                          setEditingKey(it.key);
                          setSelected(null);
                        }}
                        style={{
                          position: "absolute",
                          left: it.x * scale,
                          top: (p.height - it.baseline - it.size * 0.78) * scale,
                          width: Math.max(it.w, 2) * scale,
                          height: it.size * 1.05 * scale,
                          cursor: tool === "edit" ? "text" : "default",
                          display: "flex",
                          alignItems: "center",
                          overflow: "hidden",
                          whiteSpace: "pre",
                          fontFamily: it.mono
                            ? "Courier, monospace"
                            : it.serif
                              ? "Times, serif"
                              : "Helvetica, Arial, sans-serif",
                          fontWeight: it.bold ? ((it.weight ?? 1) >= 3 ? 900 : 800) : 400,
                          fontStyle: it.italic ? "italic" : "normal",
                          fontSize: it.size * 0.95 * scale,
                          color: "#111",
                          background: changed ? it.bg || "#fff" : "transparent",
                          outline:
                            editingKey === it.key
                              ? "2px solid #2563eb"
                              : tool === "edit"
                                ? "1px dashed rgba(37,99,235,0.35)"
                                : "none",
                        }}
                      >
                        {changed ? it.value : ""}
                      </div>
                    );
                  })}
                {objs
                  .filter((o) => o.page === idx)
                  .map((o) => (
                    <div
                      key={o.id}
                      data-obj="1"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelected(o.id);
                        const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                        drag.current = {
                          id: o.id,
                          dx: (e.clientX - box.left) / scale - o.x,
                          dy: (e.clientY - box.top) / scale - o.y,
                          scale,
                        };
                      }}
                      style={{
                        position: "absolute",
                        left: o.x * scale,
                        top: o.y * scale,
                        cursor: "move",
                        outline: selected === o.id ? "2px solid #2563eb" : "1px dashed rgba(0,0,0,0.25)",
                        ...(o.type === "text"
                          ? {
                              fontFamily: "Helvetica, Arial, sans-serif",
                              fontSize: (o.size || 14) * scale,
                              color: o.color || "#111",
                              lineHeight: 1,
                              whiteSpace: "pre",
                              padding: 1,
                            }
                          : {
                              width: (o.w || 100) * scale,
                              height: (o.h || 100) * scale,
                              background: o.type === "whiteout" ? "#fff" : undefined,
                            }),
                      }}
                    >
                      {o.type === "text" ? (
                        o.text
                      ) : o.type === "image" ? (
                        <img src={o.dataUrl} alt="" className="pointer-events-none h-full w-full object-contain" />
                      ) : null}
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
