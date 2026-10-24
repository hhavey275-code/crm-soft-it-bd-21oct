import { useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { managedAds } from "@/lib/managedAdsApi";
import { FacebookConnectButton } from "@/components/client/FacebookConnectButton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PageOption = { page_id: string; page_name: string; status?: string };

export function LinkPageByUrl({ adAccountDbId, onDone, pages = [] }: { adAccountDbId?: string; onDone: () => void; pages?: PageOption[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [selectedPageId, setSelectedPageId] = useState("");
  const availablePages = Array.from(new Map(pages.filter((p) => p.status !== "rejected").map((p) => [String(p.page_id), p])).values());
  const copyId = async () => {
    try { await navigator.clipboard.writeText(selectedPageId); toast.success("Page ID কপি হয়েছে"); }
    catch { toast.error("কপি করা যায়নি — নিচের ঘর থেকে Page ID কপি করুন"); }
  };

  const send = async () => {
    if (!adAccountDbId) return toast.error("আগে উপরে একটি ad account বাছুন");
    if (url.trim().length < 3) return toast.error("Page বাছুন অথবা Page-এর লিংক / ID দিন");
    setBusy(true);
    try {
      const r = await managedAds({ action: "link_page", pageUrl: url.trim(), adAccountDbId });
      setRes(r);
      onDone();
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setRes(null); setUrl(""); setSelectedPageId(""); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2"><Link2 className="h-4 w-4" />Page লিংক দিয়ে যুক্ত</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Page লিংক দিয়ে যুক্ত করুন</DialogTitle></DialogHeader>
        {!res ? (
          <div className="space-y-3">
            <FacebookConnectButton label="Facebook থেকে Page ও ID আনুন" onDone={onDone} />
            <Select value={selectedPageId} onValueChange={(id) => { setSelectedPageId(id); setUrl(id); }} disabled={!availablePages.length || busy}>
              <SelectTrigger aria-label="আপনার Facebook Page বাছুন"><SelectValue placeholder="আপনার Facebook Page বাছুন" /></SelectTrigger>
              <SelectContent>
                {availablePages.map((p) => <SelectItem key={p.page_id} value={String(p.page_id)}><span className="block break-words">{p.page_name}<span className="block text-xs text-muted-foreground">Page ID: {p.page_id}</span></span></SelectItem>)}
              </SelectContent>
            </Select>
            {selectedPageId && <div className="flex items-center justify-between gap-2"><span className="min-w-0 break-all text-sm">Page ID: {selectedPageId}</span><Button variant="ghost" size="icon" aria-label="Page ID কপি করুন" title="Page ID কপি করুন" onClick={copyId}><Copy className="h-4 w-4" /></Button></div>}
            <Input aria-label="Page লিংক বা ID" placeholder="Page লিংক অথবা Page ID" value={url} onChange={(e) => { setUrl(e.target.value); setSelectedPageId(""); }} disabled={busy} />
            <Button className="w-full" onClick={send} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Request পাঠান
            </Button>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{res.already ? "এই Page-এ access আগেই আছে ✅" : "Request পাঠানো হয়েছে ✅"}</p>
            <p>Page: <b>{res.pageName || res.pageId}</b></p>
            <p className="break-all text-muted-foreground">Page ID: {res.pageId}</p>
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
