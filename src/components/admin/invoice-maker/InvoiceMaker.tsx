import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, Plus, Save, Trash2, FilePlus2, Copy, Image as ImageIcon, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InvoiceTemplate,
  TEMPLATES,
  PAYMENT_STATUSES,
  money,
  totals,
  type InvoiceDraft,
  type InvoiceItem,
} from "./templates";

const emptyItem: InvoiceItem = { description: "", qty: 1, rate: 0 };

const DEFAULT_TERMS = [
  "Payment is due on or before the due date shown above.",
  "Please use the invoice number as the payment reference.",
  "Bank charges or transfer fees, if any, are payable by the client.",
  "Services may be paused on invoices left unpaid for more than 7 days after the due date.",
].join("\n");



function blankDraft(): InvoiceDraft {
  return {
    invoice_number: `INV-${format(new Date(), "yyyyMM")}-${Math.floor(Math.random() * 9000 + 1000)}`,
    template: "classic",
    currency: "USD",
    issue_date: format(new Date(), "yyyy-MM-dd"),
    due_date: "",
    logo_url: "",
    from_name: "",
    from_address: "",
    from_email: "",
    from_phone: "",
    from_extra: "",
    bank_details: "",
    to_name: "",
    to_address: "",
    to_email: "",
    to_phone: "",
    items: [{ ...emptyItem }],
    tax_percent: 0,
    discount: 0,
    notes: "",
    terms: DEFAULT_TERMS,
    payment_status: "unpaid",
    amount_paid: 0,
  };
}

const LS_KEY = "invoice_maker_company_profile";
const DRAFT_KEY = "invoice_maker_open_draft";

export function InvoiceMaker() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<InvoiceDraft>(blankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [captureTemplate, setCaptureTemplate] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

  // Restore the in-progress draft first, else pre-fill company/bank details
  useEffect(() => {
    try {
      const d = localStorage.getItem(DRAFT_KEY);
      if (d) {
        const parsed = JSON.parse(d);
        if (parsed?.draft) {
          setDraft({ ...blankDraft(), ...parsed.draft });
          setEditingId(parsed.editingId ?? null);
          setRestored(true);
          return;
        }
      }
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        setDraft((d2) => ({ ...d2, ...p }));
      }
    } catch {
      /* ignore */
    } finally {
      setRestored(true);
    }
  }, []);

  // Keep the current draft so a page reload never loses the work
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, editingId }));
    } catch {
      /* ignore */
    }
  }, [draft, editingId, restored]);

  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));


  const t = useMemo(() => totals(draft), [draft]);

  const { data: saved } = useQuery({
    queryKey: ["custom-invoices"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("custom_invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  async function handleLogo(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Logo is too large (max 4 MB)");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("Could not read the file"));
      fr.readAsDataURL(file);
    });
    // Downscale so the stored logo stays small and the PDF stays light
    const img = new Image();
    img.src = dataUrl;
    await new Promise((res) => {
      img.onload = res;
      img.onerror = res;
    });
    const maxW = 320;
    const scale = img.width > maxW ? maxW / img.width : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx || !img.width) {
      set("logo_url", dataUrl);
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    set("logo_url", canvas.toDataURL("image/png"));
  }

  async function save() {
    if (!user) return;
    if (!draft.invoice_number.trim()) {
      toast.error("Invoice number is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        created_by: user.id,
        invoice_number: draft.invoice_number,
        template: draft.template,
        currency: draft.currency,
        issue_date: draft.issue_date || null,
        due_date: draft.due_date || null,
        logo_url: draft.logo_url || null,
        from_name: draft.from_name,
        from_address: draft.from_address,
        from_email: draft.from_email,
        from_phone: draft.from_phone,
        from_extra: draft.from_extra,
        bank_details: draft.bank_details,
        to_name: draft.to_name,
        to_address: draft.to_address,
        to_email: draft.to_email,
        to_phone: draft.to_phone,
        items: draft.items,
        tax_percent: Number(draft.tax_percent) || 0,
        discount: Number(draft.discount) || 0,
        notes: draft.notes,
        terms: draft.terms,
        payment_status: draft.payment_status,
        amount_paid: Number(draft.amount_paid) || 0,
      };
      if (editingId) {
        const { error } = await (supabase as any)
          .from("custom_invoices")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast.success("Invoice updated");
      } else {
        const { data, error } = await (supabase as any)
          .from("custom_invoices")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        setEditingId(data.id);
        toast.success("Invoice saved");
      }
      try {
        localStorage.setItem(
          LS_KEY,
          JSON.stringify({
            logo_url: draft.logo_url,
            from_name: draft.from_name,
            from_address: draft.from_address,
            from_email: draft.from_email,
            from_phone: draft.from_phone,
            from_extra: draft.from_extra,
            bank_details: draft.bank_details,
          }),
        );
      } catch {
        /* ignore */
      }
      qc.invalidateQueries({ queryKey: ["custom-invoices"] });
    } catch (err: any) {
      toast.error(err?.message || "Could not save the invoice");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this invoice?")) return;
    const { error } = await (supabase as any).from("custom_invoices").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (editingId === id) {
      setEditingId(null);
      setDraft(blankDraft());
    }
    qc.invalidateQueries({ queryKey: ["custom-invoices"] });
    toast.success("Deleted");
  }

  function load(row: any) {
    setEditingId(row.id);
    setDraft({
      invoice_number: row.invoice_number ?? "",
      template: row.template ?? "classic",
      currency: row.currency ?? "USD",
      issue_date: row.issue_date ?? "",
      due_date: row.due_date ?? "",
      logo_url: row.logo_url ?? "",
      from_name: row.from_name ?? "",
      from_address: row.from_address ?? "",
      from_email: row.from_email ?? "",
      from_phone: row.from_phone ?? "",
      from_extra: row.from_extra ?? "",
      bank_details: row.bank_details ?? "",
      to_name: row.to_name ?? "",
      to_address: row.to_address ?? "",
      to_email: row.to_email ?? "",
      to_phone: row.to_phone ?? "",
      items: Array.isArray(row.items) && row.items.length ? row.items : [{ ...emptyItem }],
      tax_percent: Number(row.tax_percent) || 0,
      discount: Number(row.discount) || 0,
      notes: row.notes ?? "",
      terms: row.terms ?? "",
      payment_status: (row.payment_status ?? "unpaid") as InvoiceDraft["payment_status"],
      amount_paid: Number(row.amount_paid) || 0,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function download(templateId: string) {
    setDownloading(templateId);
    setCaptureTemplate(templateId);
    try {
      // let the hidden sheet render with the requested design
      await new Promise((r) => setTimeout(r, 250));
      const el = captureRef.current;
      if (!el) throw new Error("Nothing to export");
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: 794,
      });
      let quality = 0.9;
      let imgData = canvas.toDataURL("image/jpeg", quality);
      const MAX_BYTES = 900 * 1024;
      while (imgData.length * 0.75 > MAX_BYTES && quality > 0.4) {
        quality -= 0.1;
        imgData = canvas.toDataURL("image/jpeg", quality);
      }
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH, undefined, "FAST");
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pageW, imgH, undefined, "FAST");
        heightLeft -= pageH;
      }
      pdf.save(`${draft.invoice_number || "invoice"}-${templateId}.pdf`);
    } catch (err: any) {
      toast.error(err?.message || "Could not create the PDF");
    } finally {
      setCaptureTemplate(null);
      setDownloading(null);
    }
  }

  const captureDraft = { ...draft, template: captureTemplate ?? draft.template };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoice Maker</h1>
          <p className="text-sm text-muted-foreground">
            Build a custom invoice for a client or a bank, then download it in any design.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setEditingId(null);
              const b = blankDraft();
              try {
                localStorage.removeItem(DRAFT_KEY);
                const raw = localStorage.getItem(LS_KEY);
                setDraft(raw ? { ...b, ...JSON.parse(raw) } : b);
              } catch {
                setDraft(b);
              }
            }}
          >
            <FilePlus2 className="mr-2 h-4 w-4" /> New invoice
          </Button>
          <Button onClick={save} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : editingId ? "Update" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- form ---------------- */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Invoice details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Invoice number">
                <Input value={draft.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} />
              </Field>
              <Field label="Currency">
                <Select value={draft.currency} onValueChange={(v) => set("currency", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD ($)</SelectItem>
                    <SelectItem value="BDT">BDT (৳)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Issue date">
                <Input type="date" value={draft.issue_date} onChange={(e) => set("issue_date", e.target.value)} />
              </Field>
              <Field label="Due date">
                <Input type="date" value={draft.due_date} onChange={(e) => set("due_date", e.target.value)} />
              </Field>
              <Field label="Design">
                <Select value={draft.template} onValueChange={(v) => set("template", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATES.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>{tpl.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Logo">
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*"
                    className="cursor-pointer"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleLogo(f);
                    }}
                  />
                  {draft.logo_url ? (
                    <div className="relative shrink-0">
                      <img src={draft.logo_url} alt="Logo" className="h-9 w-9 rounded border object-contain" />
                      <button
                        type="button"
                        onClick={() => set("logo_url", "")}
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                        aria-label="Remove logo"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                </div>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your company (From)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Company name"><Input value={draft.from_name} onChange={(e) => set("from_name", e.target.value)} /></Field>
              <Field label="Email"><Input value={draft.from_email} onChange={(e) => set("from_email", e.target.value)} /></Field>
              <Field label="Phone"><Input value={draft.from_phone} onChange={(e) => set("from_phone", e.target.value)} /></Field>
              <Field label="Extra line (VAT / BIN / Reg. no.)"><Input value={draft.from_extra} onChange={(e) => set("from_extra", e.target.value)} /></Field>
              <Field label="Address" full><Textarea rows={3} value={draft.from_address} onChange={(e) => set("from_address", e.target.value)} /></Field>
              <Field label="Bank details (for bank submission)" full>
                <Textarea rows={4} placeholder={"Bank name\nAccount name\nAccount no.\nRouting / SWIFT\nBranch"} value={draft.bank_details} onChange={(e) => set("bank_details", e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Client (Bill to)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Client name"><Input value={draft.to_name} onChange={(e) => set("to_name", e.target.value)} /></Field>
              <Field label="Email"><Input value={draft.to_email} onChange={(e) => set("to_email", e.target.value)} /></Field>
              <Field label="Phone"><Input value={draft.to_phone} onChange={(e) => set("to_phone", e.target.value)} /></Field>
              <Field label="Address" full><Textarea rows={3} value={draft.to_address} onChange={(e) => set("to_address", e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {draft.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-12 sm:col-span-6">
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <Input
                      value={item.description}
                      onChange={(e) => {
                        const items = [...draft.items];
                        items[idx] = { ...item, description: e.target.value };
                        set("items", items);
                      }}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Label className="text-xs text-muted-foreground">Qty</Label>
                    <Input
                      type="number"
                      value={item.qty}
                      onChange={(e) => {
                        const items = [...draft.items];
                        items[idx] = { ...item, qty: Number(e.target.value) };
                        set("items", items);
                      }}
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <Label className="text-xs text-muted-foreground">Rate</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.rate}
                      onChange={(e) => {
                        const items = [...draft.items];
                        items[idx] = { ...item, rate: Number(e.target.value) };
                        set("items", items);
                      }}
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const items = draft.items.filter((_, i) => i !== idx);
                        set("items", items.length ? items : [{ ...emptyItem }]);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => set("items", [...draft.items, { ...emptyItem }])}>
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>

              <div className="grid gap-3 sm:grid-cols-2 pt-2">
                <Field label="Tax (%)">
                  <Input type="number" step="0.01" value={draft.tax_percent} onChange={(e) => set("tax_percent", Number(e.target.value))} />
                </Field>
                <Field label="Discount amount">
                  <Input type="number" step="0.01" value={draft.discount} onChange={(e) => set("discount", Number(e.target.value))} />
                </Field>
                <Field label="Payment status (seal)">
                  <Select value={draft.payment_status} onValueChange={(v) => set("payment_status", v as InvoiceDraft["payment_status"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_STATUSES.map((ps) => (
                        <SelectItem key={ps.id} value={ps.id}>{ps.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {draft.payment_status === "partial" && (
                  <Field label="Amount already paid">
                    <Input type="number" step="0.01" value={draft.amount_paid} onChange={(e) => set("amount_paid", Number(e.target.value))} />
                  </Field>
                )}
              </div>
              <div className="rounded-md bg-muted p-3 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{money(draft.currency, t.subtotal)}</span></div>
                <div className="flex justify-between"><span>Tax</span><span>{money(draft.currency, t.tax)}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>- {money(draft.currency, t.discount)}</span></div>
                <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Total</span><span>{money(draft.currency, t.total)}</span></div>
                <div className="flex justify-between"><span>Paid</span><span>{money(draft.currency, t.paid)}</span></div>
                <div className="flex justify-between font-semibold"><span>Balance due</span><span>{money(draft.currency, t.balance)}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notes & terms</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field label="Notes"><Textarea rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
              <Field label="Terms"><Textarea rows={3} value={draft.terms} onChange={(e) => set("terms", e.target.value)} /></Field>
            </CardContent>
          </Card>
        </div>

        {/* ---------------- preview ---------------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Download</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Same invoice, different look — pick any design to download as PDF.
              </p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((tpl) => (
                  <Button
                    key={tpl.id}
                    variant={tpl.id === draft.template ? "default" : "outline"}
                    size="sm"
                    disabled={!!downloading}
                    onClick={() => void download(tpl.id)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {downloading === tpl.id ? "Preparing..." : tpl.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded border bg-muted/30 p-2">
                <div style={{ width: 794, transform: "scale(0.62)", transformOrigin: "top left", height: 700 }}>
                  <InvoiceTemplate data={draft} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Saved invoices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!saved?.length && <p className="text-sm text-muted-foreground">No invoices saved yet.</p>}
              {saved?.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.invoice_number}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {row.to_name || "—"} · {row.currency} · {row.issue_date || ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => load(row)}>Open</Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Duplicate"
                      onClick={() => {
                        load(row);
                        setEditingId(null);
                        setDraft((d) => ({
                          ...d,
                          invoice_number: `${row.invoice_number}-COPY`,
                        }));
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => void remove(row.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* hidden, full-size sheet used for PDF capture */}
      <div style={{ position: "fixed", left: -10000, top: 0, width: 794 }} aria-hidden>
        <div ref={captureRef}>
          <InvoiceTemplate data={captureDraft} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2 space-y-1" : "space-y-1"}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
