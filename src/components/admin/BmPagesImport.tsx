import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { bmPages } from "@/lib/bmPages.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function BmPagesImport() {
  const call = useServerFn(bmPages);
  const qc = useQueryClient();
  const [bm, setBm] = useState("");
  const [client, setClient] = useState("");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<{ id: string; name: string; link: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { data } = useQuery({ queryKey: ["bm-page-import-options"], queryFn: async () => {
    const db = supabase as any;
    const results = await Promise.all([
      db.from("business_managers").select("id,name,bm_id").order("name"),
      db.from("profiles").select("user_id,full_name,email").order("full_name").limit(2000),
    ]);
    for (const r of results) if (r.error) throw new Error(r.error.message);
    return { bms: results[0].data ?? [], clients: results[1].data ?? [] };
  } });
  const load = async () => {
    if (!bm) return;
    setBusy("load"); setError(""); setLoaded(false); setPages([]);
    try { const r = await call({ data: { action: "list", bmDbId: bm } }); setPages(r.pages ?? []); setLoaded(true); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  };
  const add = async (id: string) => {
    setBusy(id); setError("");
    try {
      await call({ data: { action: "import", bmDbId: bm, pageId: id, clientId: client } });
      toast.success("Page ক্লায়েন্টকে দেওয়া হয়েছে — তার সব ad account থেকে ব্যবহার করা যাবে");
      void qc.invalidateQueries({ queryKey: ["managed-ads-list"] });
      void qc.invalidateQueries({ queryKey: ["my-ads-client-pages"] });
      void qc.invalidateQueries({ queryKey: ["managed-ads-pages"] });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  };
  return <section className="space-y-3 border-b pb-6">
    <h2 className="text-lg font-semibold">BM থেকে Page আনুন</h2>
    <div className="flex flex-wrap gap-2">
      <Select value={bm} disabled={!!busy} onValueChange={v => { setBm(v); setPages([]); setLoaded(false); setError(""); }}>
        <SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="Business Manager বাছুন" /></SelectTrigger>
        <SelectContent>{(data?.bms ?? []).map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name} ({b.bm_id})</SelectItem>)}</SelectContent>
      </Select>
      <Button onClick={load} disabled={!bm || !!busy}>{busy === "load" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Page আনুন</Button>
    </div>
    <Select value={client} disabled={!!busy} onValueChange={setClient}><SelectTrigger className="w-full sm:w-96"><SelectValue placeholder="ক্লায়েন্ট বাছুন" /></SelectTrigger><SelectContent>{(data?.clients ?? []).map((c: any) => <SelectItem key={c.user_id} value={c.user_id}>{c.full_name || c.email}</SelectItem>)}</SelectContent></Select>
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    {loaded && <>
      <Input aria-label="BM Page খুঁজুন" placeholder="Page নাম বা ID দিয়ে খুঁজুন" value={search} onChange={e => setSearch(e.target.value)} />
      {!pages.length && <p className="text-sm text-muted-foreground">এই BM-এ অনুমোদিত Page পাওয়া যায়নি।</p>}
      <div className="max-h-96 overflow-auto divide-y">{pages.filter(p => `${p.name} ${p.id}`.toLowerCase().includes(search.trim().toLowerCase())).map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0"><p className="font-medium break-words">{p.name}</p><p className="text-xs text-muted-foreground">Page ID: {p.id}</p></div>
        <Button size="sm" disabled={!client || !!busy} onClick={() => add(p.id)}>{busy === p.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}ক্লায়েন্টকে দিন</Button>
      </div>)}</div>
    </>}
  </section>;
}
