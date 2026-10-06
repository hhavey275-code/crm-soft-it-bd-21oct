import { useState } from "react";
import { toast } from "sonner";
import { Facebook, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type FbPage = { id: string; name: string; link: string; picture: string | null };

async function call(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch("/api/fb-pages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  if (res.status === 401) throw new Error("লগইন সেশন শেষ — আবার লগইন করে চেষ্টা করুন");
  if (res.status === 404) throw new Error("Facebook connect সার্ভিস এই সাইটে পাওয়া যায়নি — সাইট আবার deploy করতে হবে");
  if (!res.ok || j?.error) throw new Error(j?.error || j?.message || `সার্ভার সমস্যা (${res.status})`);
  return j;
}

function waitForCode(popup: Window) {
  return new Promise<string>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "fbPagesOAuth") return;
      cleanup();
      e.data.code ? resolve(e.data.code) : reject(new Error(e.data.error || "বাতিল হয়েছে"));
    };
    const poll = window.setInterval(() => { if (popup.closed) { cleanup(); reject(new Error("Window বন্ধ হয়ে গেছে")); } }, 700);
    const cleanup = () => { window.removeEventListener("message", onMsg); window.clearInterval(poll); };
    window.addEventListener("message", onMsg);
  });
}

export function FacebookPagesConnect({ userId, existingIds, onImported }: { userId: string; existingIds: string[]; onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<FbPage[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);

  const connect = async () => {
    const popup = window.open("", "fb-pages", "width=600,height=720");
    if (!popup) return toast.error("Popup বন্ধ আছে — popup allow করুন");
    setBusy(true);
    try {
      const { appId } = await call({ action: "config" });
      const redirectUri = `${window.location.origin}/fb-pages-callback`;
      const wait = waitForCode(popup);
      popup.location.href = `https://www.facebook.com/v25.0/dialog/oauth?${new URLSearchParams({
        client_id: appId, redirect_uri: redirectUri, response_type: "code",
        scope: "pages_show_list", state: crypto.randomUUID(),
      })}`;
      const code = await wait;
      const { pages } = await call({ action: "pages", code, redirectUri });
      setPages(pages);
      setSel([]);
      if (!pages.length) toast.info("এই profile-এ কোনো page পাওয়া যায়নি");
    } catch (e: any) {
      popup.close();
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const importSel = async () => {
    const rows = (pages ?? []).filter((p) => sel.includes(p.id)).map((p) => ({
      user_id: userId, page_id: p.id, page_name: p.name, page_url: p.link,
    }));
    if (!rows.length) return toast.error("অন্তত একটি page বাছুন");
    setBusy(true);
    const { error } = await (supabase as any).from("client_facebook_pages").insert(rows);
    setBusy(false);
    if (error) return toast.error(error.code === "23505" ? "কিছু page আগেই যুক্ত আছে" : error.message);
    toast.success(`${rows.length}টি page জমা হয়েছে — admin অনুমোদন দিলে চালু হবে`);
    setPages(null);
    onImported();
  };

  return (
    <div className="space-y-3">
      <Button onClick={connect} disabled={busy} className="gap-2">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
        Facebook দিয়ে কানেক্ট করুন
      </Button>
      {pages && pages.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">যে page-এ ad চালাতে চান সেগুলো বাছুন:</p>
          {pages.map((p) => {
            const added = existingIds.includes(p.id);
            return (
              <label key={p.id} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted">
                <Checkbox
                  disabled={added}
                  checked={added || sel.includes(p.id)}
                  onCheckedChange={(v) => setSel((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))}
                />
                {p.picture && <img src={p.picture} alt="" className="h-8 w-8 rounded-full" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{added ? "আগেই যুক্ত" : `ID: ${p.id}`}</p>
                </div>
              </label>
            );
          })}
          <Button size="sm" onClick={importSel} disabled={busy || !sel.length}>বাছাই করা page জমা দিন</Button>
        </div>
      )}
    </div>
  );
}
