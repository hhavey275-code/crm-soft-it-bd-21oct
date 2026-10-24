import { useEffect, useState } from "react";
import { Loader2, Upload, Check, X, Film } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type LibraryVideo = { path: string; name: string; url?: string };

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i;

/** Pretty name from stored file name like 1700000000000-my_video.mp4 */
function displayName(file: string) {
  return file.replace(/^\d{10,}-/, "").replace(/^[0-9a-f-]{36}\./, "video.");
}

export async function uploadLibraryVideo(f: File): Promise<LibraryVideo> {
  if (f.size > 1024 * 1024 * 1024) throw new Error("Video ১GB-এর কম হতে হবে");
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("আবার লগইন করুন");
  const base = f.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 60) || "video";
  const ext = (f.name.split(".").pop() || "mp4").replace(/[^\w]/g, "").slice(0, 5) || "mp4";
  const path = `${u.user.id}/${Date.now()}-${base}.${ext}`;
  const { error } = await supabase.storage.from("ad-media").upload(path, f, { contentType: f.type || "video/mp4" });
  if (error) throw error;
  return { path, name: f.name };
}

/** Client's saved videos. Pick one with onPick, or just upload to keep for later. */
export function VideoLibrary({ open, onClose, onPick, selected }: { open: boolean; onClose: () => void; onPick?: (v: LibraryVideo) => void; selected?: string }) {
  const [items, setItems] = useState<LibraryVideo[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setItems(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return setItems([]);
    const { data, error } = await supabase.storage.from("ad-media").list(u.user.id, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
    if (error) { toast.error(error.message); return setItems([]); }
    const vids = (data ?? []).filter((f) => VIDEO_EXT.test(f.name));
    const paths = vids.map((f) => `${u.user!.id}/${f.name}`);
    const { data: signed } = paths.length ? await supabase.storage.from("ad-media").createSignedUrls(paths, 3600) : { data: [] as any[] };
    setItems(vids.map((f, i) => ({ path: paths[i], name: displayName(f.name), url: signed?.[i]?.signedUrl })));
  };
  useEffect(() => { if (open) load(); }, [open]);

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) await uploadLibraryVideo(f);
      toast.success("Video library-তে রাখা হয়েছে");
      await load();
    } catch (e: any) { toast.error(e.message || "Upload হয়নি"); } finally { setBusy(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-3">
          <p className="flex items-center gap-2 font-semibold"><Film className="h-4 w-4" />Video library</p>
          <div className="flex items-center gap-2">
            <label className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-semibold hover:bg-muted", busy && "pointer-events-none opacity-60")}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload video
              <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
            </label>
            <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="overflow-auto p-3">
          {items === null ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">এখনো কোনো video নেই — "Upload video" চেপে রেখে দিন, পরে ad বানানোর সময় বাছতে পারবেন।</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {items.map((v) => (
                <div key={v.path} className={cn("relative overflow-hidden rounded-md border", selected === v.path && "ring-2 ring-primary")}>
                  {v.url ? <video src={v.url} className="aspect-video w-full bg-muted object-cover" controls preload="metadata" /> : <div className="aspect-video bg-muted" />}
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="truncate text-xs">{v.name}</span>
                    {onPick && (
                      <button className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground" onClick={() => { onPick(v); onClose(); }}>
                        {selected === v.path ? <Check className="h-3.5 w-3.5" /> : "Select"}
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
