import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Facebook, Loader2, CheckCircle2 } from "lucide-react";
import { managedAds } from "@/lib/managedAdsApi";
import { call } from "@/components/client/FacebookPagesConnect";
import { FACEBOOK_CONNECT_SCOPES } from "@/lib/facebookPermissions";

/** One-click Facebook login: pages are added automatically and shared with our Business Managers. */
export function FacebookConnectButton({ onDone, label = "Connect Facebook" }: { onDone?: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ connected: boolean } | null>(null);
  useEffect(() => { managedAds<{ connected: boolean }>({ action: "fb_status" }).then(setStatus).catch(() => setStatus(null)); }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem("fbPagesResult");
    if (!raw) return;
    sessionStorage.removeItem("fbPagesResult");
    try {
      const r = JSON.parse(raw);
      if (r.error) toast.error(r.error);
      else if (!r.pages?.length) toast.info("এই Facebook profile-এ কোনো page পাওয়া যায়নি");
      else if (r.signedIn === false) toast.error("CRM লগইন পাওয়া যায়নি — আবার লগইন করে Connect দিন");
      else {
        toast.success(`${r.pages.length}টি page যুক্ত হয়েছে — এখন ad বানানোর সময় page বাছতে পারবেন`);
        if (r.bmShared) toast.success(`${r.bmShared}টি Page-এ Business Manager-এর access নিজে থেকে যুক্ত হয়েছে ✅`);
        if (r.bmRequested) toast.info(`${r.bmRequested}টি Page অন্য Business-এর মালিকানায় — access request পাঠানো হয়েছে, ওই Business-এর admin Settings → Requests থেকে Approve করবেন`, { duration: 10000 });
        if (r.noBm) toast.warning("আপনার কোনো ad account CRM-এ যুক্ত নেই, তাই Page access দেওয়া যায়নি");
        if (r.bmFailed?.length) toast.error(`${r.bmFailed.length}টি Page-এ access দেওয়া যায়নি: ${r.bmFailed[0].page} — ${r.bmFailed[0].message}`, { duration: 12000 });
      }
      onDone?.();
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const { appId } = await call({ action: "config" });
      sessionStorage.setItem("fbPagesReturn", window.location.pathname);
      window.location.href = `https://www.facebook.com/v25.0/dialog/oauth?${new URLSearchParams({
        client_id: appId, redirect_uri: `${window.location.origin}/fb-pages-callback`, response_type: "code",
        scope: FACEBOOK_CONNECT_SCOPES,
        auth_type: "rerequest", state: crypto.randomUUID(),
      })}`;
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  if (status?.connected && !busy) {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-fb-green/40 bg-fb-green/10 px-3 text-[13px] font-semibold text-fb-green">
        <CheckCircle2 className="h-4 w-4" />Facebook connected
        <button onClick={connect} className="ml-1 text-[11px] font-normal text-fb-muted underline">আবার connect</button>
      </span>
    );
  }
  return (
    <button onClick={connect} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-fb-blue text-primary-foreground text-[13px] font-semibold disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
      {status && !status.connected && label === "Connect Facebook" ? "Facebook আবার connect" : label}
    </button>
  );
}
