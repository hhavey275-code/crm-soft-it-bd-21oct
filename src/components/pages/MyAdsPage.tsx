import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { Megaphone, Plus, RefreshCw, Pencil } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { managedAds, resultOf } from "@/lib/managedAdsApi";
import { getCampaignStatusConfig } from "@/components/ads-manager/types";
import { ManagedCreateWizard } from "@/components/ads-manager/ManagedCreateWizard";

type Level = "campaign" | "adset" | "ad";
const COOLDOWN_MS = 2 * 60_000;
const RANGES: Record<string, number> = { today: 0, "7d": 6, "30d": 29 };

const money = (v: any) => (v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`);
const num = (v: any) => (v == null || v === "" ? "—" : Number(v).toLocaleString());
const budget = (o: any) =>
  o.daily_budget ? `${money(Number(o.daily_budget) / 100)}/দিন` : o.lifetime_budget ? `${money(Number(o.lifetime_budget) / 100)} মোট` : "—";

export default function MyAdsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Level>("campaign");
  const [range, setRange] = useState("7d");
  const [selCampaigns, setSelCampaigns] = useState<string[]>([]);
  const [selAdsets, setSelAdsets] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [lastManual, setLastManual] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const dates = useMemo(() => {
    const to = new Date();
    return { dateFrom: format(subDays(to, RANGES[range]), "yyyy-MM-dd"), dateTo: format(to, "yyyy-MM-dd") };
  }, [range]);

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["managed-ads-list", dates],
    queryFn: () => managedAds({ action: "list", ...dates }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const cooldownLeft = Math.max(0, lastManual + COOLDOWN_MS - now);
  const manualRefresh = () => { setLastManual(Date.now()); refetch(); };

  const campaigns: any[] = data?.campaigns ?? [];
  const adsets: any[] = (data?.adsets ?? []).filter((s: any) => !selCampaigns.length || selCampaigns.includes(String(s.campaign_id)));
  const ads: any[] = (data?.ads ?? []).filter((a: any) =>
    (!selCampaigns.length || selCampaigns.includes(String(a.campaign_id))) && (!selAdsets.length || selAdsets.includes(String(a.adset_id))),
  );
  const rows = (tab === "campaign" ? campaigns : tab === "adset" ? adsets : ads).filter((r) =>
    !search.trim() || r.name?.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const totals = useMemo(() => campaigns.reduce((t, c) => {
    t.spend += Number(c.insights?.spend || 0); t.impr += Number(c.insights?.impressions || 0); t.clicks += Number(c.insights?.clicks || 0);
    t.results += resultOf(c.insights).count; return t;
  }, { spend: 0, impr: 0, clicks: 0, results: 0 }), [campaigns]);

  const toggle = async (level: Level, o: any, on: boolean) => {
    setBusy(o.id);
    try {
      await managedAds({ action: "set_status", level, objectId: String(o.id), status: on ? "ACTIVE" : "PAUSED" });
      toast.success(on ? "চালু হয়েছে" : "বন্ধ হয়েছে");
      qc.setQueryData(["managed-ads-list", dates], (old: any) => {
        if (!old) return old;
        const key = level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads";
        return { ...old, [key]: old[key].map((x: any) => x.id === o.id ? { ...x, status: on ? "ACTIVE" : "PAUSED", effective_status: on ? "ACTIVE" : "PAUSED" } : x) };
      });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const editBudget = async (o: any) => {
    const type = o.lifetime_budget ? "lifetime" : "daily";
    const cur = Number(o[`${type}_budget`] || 0) / 100;
    const v = window.prompt(`নতুন ${type === "daily" ? "daily" : "lifetime"} budget ($)`, cur ? cur.toFixed(2) : "");
    if (!v) return;
    const amount = Number(v);
    if (!(amount > 0)) return toast.error("সঠিক পরিমাণ দিন");
    setBusy(o.id);
    try {
      await managedAds({ action: "set_budget", objectId: String(o.id), budgetType: type, amount });
      toast.success("Budget আপডেট হয়েছে");
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const pages: any[] = data?.pages ?? [];

  if (creating) {
    return (
      <DashboardLayout>
        <ManagedCreateWizard
          pages={pages}
          walletBalance={Number(data?.walletBalance ?? 0)}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refetch(); }}
        />
      </DashboardLayout>
    );
  }

  const selectCount = tab === "campaign" ? selCampaigns.length : tab === "adset" ? selAdsets.length : 0;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" />Ads Manager</h1>
            <p className="text-sm text-muted-foreground">
              Wallet: <span className="font-semibold text-foreground">{money(data?.walletBalance ?? 0)}</span>
              {pages.length > 0 && <> · Page: {pages.map((p) => p.page_name).join(", ")}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">আজ</SelectItem>
                <SelectItem value="7d">শেষ ৭ দিন</SelectItem>
                <SelectItem value="30d">শেষ ৩০ দিন</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={isFetching || cooldownLeft > 0} onClick={manualRefresh}>
              <RefreshCw className={cn("h-4 w-4 mr-1", isFetching && "animate-spin")} />
              {cooldownLeft > 0 ? `${Math.ceil(cooldownLeft / 1000)}s` : "Refresh"}
            </Button>
            <Button size="sm" disabled={!pages.length} onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" />Create</Button>
          </div>
        </div>

        {!isFetching && pages.length === 0 && (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            আপনার কোনো অনুমোদিত page নেই। আগে "My Pages" থেকে page যুক্ত করুন।
          </CardContent></Card>
        )}
        {data && Number(data.walletBalance) <= Number(data.pauseThreshold ?? 1) && (
          <Card className="border-destructive"><CardContent className="p-4 text-sm text-destructive">
            Wallet-এ ব্যালেন্স শেষ — আপনার ad গুলো বন্ধ রাখা হয়েছে। Top-up করলে আবার চালু করতে পারবেন।
          </CardContent></Card>
        )}
        {data && Number(data.walletBalance) > Number(data.pauseThreshold ?? 1) && Number(data.walletBalance) <= Number(data.lowBalanceAlert ?? 10) && (
          <Card className="border-primary"><CardContent className="p-4 text-sm">
            আপনার wallet-এ ${Number(data.walletBalance).toFixed(2)} বাকি — শেষ হলে ad নিজে থেকেই বন্ধ হয়ে যাবে। এখনই top-up করুন।
          </CardContent></Card>
        )}
        <p className="text-xs text-muted-foreground">Ad-এর খরচ প্রতি ১৫ মিনিটে wallet থেকে কাটা হয় (Transactions-এ "Ad spend" নামে দেখবেন)।</p>
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {(data?.errors ?? []).map((e: string, i: number) => <p key={i} className="text-sm text-destructive">{e}</p>)}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["খরচ", money(totals.spend)], ["Results", num(totals.results)], ["Impressions", num(totals.impr)], ["Clicks", num(totals.clicks)]].map(([l, v]) => (
            <Card key={l}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-semibold">{v}</p></CardContent></Card>
          ))}
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-1 border-b p-2">
            {([["campaign", "Campaigns"], ["adset", "Ad Sets"], ["ad", "Ads"]] as const).map(([k, l]) => (
              <Button key={k} size="sm" variant={tab === k ? "secondary" : "ghost"} onClick={() => setTab(k)}>
                {l}
                {k === "adset" && selCampaigns.length > 0 && <Badge className="ml-1" variant="outline">{selCampaigns.length} বাছাই</Badge>}
                {k === "ad" && (selCampaigns.length + selAdsets.length) > 0 && <Badge className="ml-1" variant="outline">filter</Badge>}
              </Button>
            ))}
            {selectCount > 0 && (
              <Button size="sm" variant="link" onClick={() => tab === "campaign" ? setSelCampaigns([]) : setSelAdsets([])}>বাছাই মুছুন</Button>
            )}
            <Input className="ml-auto h-8 w-48" placeholder="নাম খুঁজুন" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {tab !== "ad" && <TableHead className="w-8" />}
                  <TableHead className="w-14">On/Off</TableHead>
                  <TableHead className="min-w-[200px]">নাম</TableHead>
                  <TableHead>Delivery</TableHead>
                  {tab !== "ad" && <TableHead>Budget</TableHead>}
                  <TableHead className="text-right">Results</TableHead>
                  <TableHead className="text-right">Cost/result</TableHead>
                  <TableHead className="text-right">খরচ</TableHead>
                  <TableHead className="text-right">Impr.</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">CPM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching && !data && <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">লোড হচ্ছে...</TableCell></TableRow>}
                {data && rows.length === 0 && <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">কিছু নেই</TableCell></TableRow>}
                {rows.map((r) => {
                  const st = getCampaignStatusConfig(r.effective_status);
                  const res = resultOf(r.insights);
                  const sel = tab === "campaign" ? selCampaigns : selAdsets;
                  const setSel = tab === "campaign" ? setSelCampaigns : setSelAdsets;
                  const canBudget = tab === "adset" && (r.daily_budget || r.lifetime_budget);
                  return (
                    <TableRow key={r.id}>
                      {tab !== "ad" && (
                        <TableCell>
                          <input type="checkbox" className="h-4 w-4 accent-primary" checked={sel.includes(String(r.id))}
                            onChange={(e) => setSel((s) => e.target.checked ? [...s, String(r.id)] : s.filter((x) => x !== String(r.id)))} />
                        </TableCell>
                      )}
                      <TableCell>
                        <Switch checked={r.status === "ACTIVE"} disabled={busy === r.id} onCheckedChange={(v) => toggle(tab, r, v)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {tab === "ad" && r.thumbnail_url && <img src={r.thumbnail_url} alt="" className="h-9 w-9 rounded object-cover" />}
                          <button
                            className="text-left font-medium text-primary hover:underline"
                            onClick={() => {
                              if (tab === "campaign") { setSelCampaigns([String(r.id)]); setSelAdsets([]); setTab("adset"); }
                              else if (tab === "adset") { setSelAdsets([String(r.id)]); setTab("ad"); }
                            }}
                          >{r.name}</button>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className={cn("font-medium", st.className)}>{st.label}</Badge></TableCell>
                      {tab !== "ad" && (
                        <TableCell className="whitespace-nowrap">
                          {budget(r)}
                          {canBudget && <Button size="icon" variant="ghost" className="h-6 w-6 ml-1" onClick={() => editBudget(r)}><Pencil className="h-3 w-3" /></Button>}
                        </TableCell>
                      )}
                      <TableCell className="text-right">{res.count ? num(res.count) : "—"}</TableCell>
                      <TableCell className="text-right">{res.cost != null ? money(res.cost) : "—"}</TableCell>
                      <TableCell className="text-right">{money(r.insights?.spend)}</TableCell>
                      <TableCell className="text-right">{num(r.insights?.impressions)}</TableCell>
                      <TableCell className="text-right">{num(r.insights?.clicks)}</TableCell>
                      <TableCell className="text-right">{r.insights?.ctr ? `${Number(r.insights.ctr).toFixed(2)}%` : "—"}</TableCell>
                      <TableCell className="text-right">{money(r.insights?.cpm)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {data?.fetchedAt && <p className="text-xs text-muted-foreground">শেষ আপডেট: {format(new Date(data.fetchedAt), "p")}</p>}
      </div>
    </DashboardLayout>
  );
}
