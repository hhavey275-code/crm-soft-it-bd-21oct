import { useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { managedAds } from "@/lib/managedAdsApi";

export function LinkPageByUrl({ adAccountDbId, onDone }: { adAccountDbId?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);

  const send = async () => {
    if (!adAccountDbId) return toast.error("আগে উপরে একটি ad account বাছুন");
    if (url.trim().length < 3) return toast.error("Page-এর লিংক দিন");
    setBusy(true);
    try {
      const r = await managedAds({ action: "link_page", pageUrl: url.trim(), adAccountDbId });
      setRes(r);
      onDone();
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setRes(null); setUrl(""); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2"><Link2 className="h-4 w-4" />Page লিংক দিয়ে যুক্ত</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Page লিংক দিয়ে যুক্ত করুন</DialogTitle></DialogHeader>
        {!res ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">আপনার Facebook Page-এর লিংক দিন। আমরা Page-এ access request পাঠাবো — আপনি শুধু Facebook-এ Approve চাপবেন।</p>
            <Input placeholder="https://facebook.com/yourpage" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Button className="w-full" onClick={send} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Request পাঠান
            </Button>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{res.already ? "এই Page-এ access আগেই আছে ✅" : "Request পাঠানো হয়েছে ✅"}</p>
            <p>Page: <b>{res.pageName || res.pageId}</b></p>
            {!res.already && (
              <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
                <li>Facebook-এ notification দেখুন, অথবা Page → Settings → <b>Page access</b> / <b>Partner access</b> খুলুন।</li>
                <li><b>{res.bmName || "Business"}</b> (ID {res.bmId})-এর request-এ <b>Approve</b> চাপুন।</li>
                <li>এরপর এখানে এসে ad চালান।</li>
              </ol>
            )}
            <a className="text-primary underline" target="_blank" rel="noreferrer" href={`https://www.facebook.com/settings/?tab=business_tools`}>Facebook-এ খুলুন</a>
            <Button variant="outline" className="w-full mt-2" onClick={() => setOpen(false)}>ঠিক আছে</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
