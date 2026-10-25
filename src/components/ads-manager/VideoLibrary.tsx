import { useEffect, useState } from "react";
import { Loader2, Upload, Check, X, Film } from "lucide-react";
import { toast } from "sonner";
import { managedAds } from "@/lib/managedAdsApi";
import { cn } from "@/lib/utils";
import { cached } from "@/lib/adsCache";

export type LibraryVideo = { id: string; title: string; picture?: string | null; source?: string | null };

function toB64(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function putWithProgress(url: string, f: File, type: string, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", type);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Cloud upload ব্যর্থ (${x.status})`)));
    x.onerror = () => reject(new Error("Cloud upload ব্যর্থ — R2 bucket-এর CORS সেটিং দেখুন"));
    x.send(f);
  });
}

/** Uploads a video into the Meta ad account's library. Uses Cloudflare R2 (browser -> R2, Meta pulls by URL) when configured; else small pieces via our server. */
export async function uploadToAccount(accId: string, f: File, onProgress?: (pct: number) => void): Promise<LibraryVideo> {
  const type = f.type || "video/mp4";
  const title = f.name.replace(/\.[^.]+$/, "");
  const pre = await managedAds<{ enabled: boolean; uploadUrl?: string; publicUrl?: string }>({ action: "video_r2_presign", adAccountDbId: accId, fileName: f.name, contentType: type }).catch(() => ({ enabled: false } as { enabled: boolean; uploadUrl?: string; publicUrl?: string }));
  if (pre.enabled && pre.uploadUrl && pre.publicUrl) {
    await putWithProgress(pre.uploadUrl, f, type, onProgress);
    const r = await managedAds<{ videoId: string }>({ action: "video_from_url", adAccountDbId: accId, fileUrl: pre.publicUrl, title });
    onProgress?.(100);
    return { id: r.videoId, title: f.name };
  }
  const st = await managedAds<{ sessionId: string; videoId: string; start: number; end: number }>({ action: "video_start", adAccountDbId: accId, fileSize: f.size });
  let start = st.start, end = st.end;
  while (start < end) {
    const stop = Math.min(end, start + Math.floor(1.5 * 1024 * 1024));
    const chunk = await f.slice(start, stop).arrayBuffer();
    const r = await managedAds<{ start: number; end: number }>({ action: "video_chunk", adAccountDbId: accId, sessionId: st.sessionId, startOffset: start, chunkBase64: toB64(chunk) });
    start = r.start; end = r.end;
    onProgress?.(Math.round((start / f.size) * 100));
  }
  await managedAds({ action: "video_finish", adAccountDbId: accId, sessionId: st.sessionId, title: f.name.replace(/\.[^.]+$/, "") });
  return { id: st.videoId, title: f.name };
}

export function VideoLibrary({ open, onClose, onPick, selected, accId }: { open: boolean; onClose: () => void; onPick?: (v: LibraryVideo) => void; selected?: string; accId?: string }) {
  const [items, setItems] = useState<LibraryVideo[] | null>(null);
  const [pct, setPct] = useState<number | null>(null);

  const load = async (force = false) => {
    if (!accId) return setItems([]);
    setItems(null);
    try {
      const r = await cached(`videos:${accId}`, () => managedAds<{ videos: LibraryVideo[] }>({ action: "videos", adAccountDbId: accId }), force);
      setItems(r.videos);
    } catch (e: any) { toast.error(e.message); setItems([]); }
  };
  useEffect(() => { if (open) load(); }, [open, accId]);

  const onUpload = async (files: FileList | null) => {
    if (!files?.length || !accId) return;
    setPct(0);
    try {
      for (const f of Array.from(files)) await uploadToAccount(accId, f, setPct);
      toast.success("Video ad account-এর library-তে চলে গেছে");
      await load(true);
    } catch (e: any) { toast.error(e.message || "Upload হয়নি"); } finally { setPct(null); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-3">
          <p className="flex items-center gap-2 font-semibold"><Film className="h-4 w-4" />Ad account video library</p>
          <div className="flex items-center gap-2">
            <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-semibold hover:bg-muted", (pct !== null || !accId) && "pointer-events-none opacity-60")}>
              {pct !== null ? <><Loader2 className="h-4 w-4 animate-spin" />{pct}%</> : <><Upload className="h-4 w-4" />Upload video</>}
              <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
            </label>
            <button onClick={() => load(true)} disabled={items === null} className="h-9 rounded-md border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-60">Update now</button>
            <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="overflow-auto p-3">
          {!accId ? (
            <p className="py-10 text-center text-sm text-muted-foreground">আগে একটি ad account বাছুন।</p>
          ) : items === null ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">এই ad account-এ এখনো কোনো video নেই — "Upload video" চেপে রেখে দিন।</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {items.map((v) => (
                <div key={v.id} className={cn("overflow-hidden rounded-md border", selected === v.id && "ring-2 ring-primary")}>
                  {v.picture ? <img src={v.picture} alt="" className="aspect-video w-full bg-muted object-cover" /> : <div className="aspect-video bg-muted" />}
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="truncate text-xs">{v.title}</span>
                    {onPick && (
                      <button className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground" onClick={() => { onPick(v); onClose(); }}>
                        {selected === v.id ? <Check className="h-3.5 w-3.5" /> : "Select"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
