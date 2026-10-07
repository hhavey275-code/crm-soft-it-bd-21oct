import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Facebook, Loader2 } from "lucide-react";
import { call } from "@/components/client/FacebookPagesConnect";

/** One-click Facebook login: pages are added automatically and shared with our Business Managers. */
export function FacebookConnectButton({ onDone, label = "Connect Facebook" }: { onDone?: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("fbPagesResult");
    if (!raw) return;
    sessionStorage.removeItem("fbPagesResult");
    try {
      const r = JSON.parse(raw);
      if (r.error) toast.error(r.error);
      else if (!r.pages?.length) toast.info("এই Facebook profile-এ কোনো page পাওয়া যায়নি");
      else if (r.signedIn === false) toast.error("CRM লগইন পাওয়া যায়নি — আবার লগইন করে Connect দিন");
      else toast.success(`${r.pages.length}টি page যুক্ত হয়েছে — এখন ad বানানোর সময় page বাছতে পারবেন`);
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
        scope: "pages_show_list,pages_read_engagement,pages_manage_ads,pages_manage_metadata,business_management",
        auth_type: "rerequest", state: crypto.randomUUID(),
      })}`;
    } catch (e: any) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  return (
    <button onClick={connect} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-fb-blue text-primary-foreground text-[13px] font-semibold disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Facebook className="h-4 w-4" />}
      {label}
    </button>
  );
}
