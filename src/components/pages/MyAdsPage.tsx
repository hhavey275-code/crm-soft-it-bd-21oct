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
  const allPages: any[] = data?.allPages ?? pages;
  const accounts: any[] = data?.accounts ?? [];

  if (creating) {
    return (
      <DashboardLayout>
        <ManagedCreateWizard
          accounts={accounts}
          allPages={allPages}
          walletBalance={Number(data?.walletBalance ?? 0)}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refetch(); }}
        />
      </DashboardLayout>
    );
  }

  const sel = tab === "campaign" ? selCampaigns : selAdsets;
  const setSel = tab === "campaign" ? setSelCampaigns : setSelAdsets;
  const rowTotals = rows.reduce((t, r) => {
    t.spend += Number(r.insights?.spend || 0); t.impr += Number(r.insights?.impressions || 0);
    t.reach += Number(r.insights?.reach || 0); t.results += resultOf(r.insights).count; return t;
  }, { spend: 0, impr: 0, reach: 0, results: 0 });
  const levelName = tab === "campaign" ? "campaigns" : tab === "adset" ? "ad sets" : "ads";
  const rangeLabel = range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days";
  const updatedAgo = data?.fetchedAt ? Math.round((now - new Date(data.fetchedAt).getTime()) / 60000) : null;
  const th = "px-3 py-2 text-left text-[13px] font-semibold text-fb-text border-r border-fb-border whitespace-nowrap align-top";
  const td = "px-3 py-2 border-r border-fb-border align-top whitespace-nowrap";
  const sub = "block text-[11px] text-fb-muted";
  const tbBtn = "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-fb-border bg-background text-[13px] text-fb-text hover:bg-fb-bg disabled:opacity-50";

  return (
    <DashboardLayout>
      <div className="-m-4 md:-m-6 min-h-full bg-fb-bg p-3 text-fb-text font-[system-ui,-apple-system,'Segoe_UI',Helvetica,Arial,sans-serif]">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-t-lg bg-background px-4 py-3 border border-fb-border">
          <h1 className="text-lg font-bold">Campaigns</h1>
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-fb-border text-[13px] max-w-[260px]">
            <Megaphone className="h-4 w-4 text-fb-muted shrink-0" />
            <span className="truncate">{allPages.length ? allPages.map((p) => p.page_name).join(", ") : "No page"}</span>
          </div>
          <div className="text-[13px] text-fb-muted">Wallet: <b className="text-fb-text">{money(data?.walletBalance ?? 0)}</b></div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[13px] text-fb-muted">
              {isFetching ? "Updating…" : updatedAgo == null ? "" : updatedAgo < 1 ? "Updated just now" : `Updated ${updatedAgo} min ago`}
            </span>
            <button className={tbBtn} disabled={isFetching || cooldownLeft > 0} onClick={manualRefresh} title="Refresh">
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              {cooldownLeft > 0 && <span>{Math.ceil(cooldownLeft / 1000)}s</span>}
            </button>
          </div>
        </div>

        {/* Filter chips + search */}
        <div className="bg-background border-x border-fb-border px-4 pb-3 space-y-3">
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border-2 border-fb-blue bg-fb-blue-soft text-[13px] font-semibold text-fb-blue">All ads</span>
            <span className={tbBtn}>Active ads</span>
            <span className={tbBtn}>Had delivery</span>
          </div>
          <Input className="h-10 border-fb-border" placeholder="Search to filter by: name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {(error || (data?.errors ?? []).length > 0 || (data && Number(data.walletBalance) <= Number(data.lowBalanceAlert ?? 10)) || (!isFetching && data && accounts.length === 0)) && (
          <div className="bg-background border-x border-fb-border px-4 pb-3 space-y-2 text-[13px]">
                        {!isFetching && data && accounts.length === 0 && <div className="rounded-md bg-fb-bg p-3">{allPages.length === 0 ? "আগে \"My Pages\" থেকে page যুক্ত করুন।" : "এখনো কোনো ad account দেওয়া হয়নি — admin আপনাকে একটি shared ad account দিলে Create চালু হবে।"}</div>}
            {data && Number(data.walletBalance) <= Number(data.pauseThreshold ?? 1) && <div className="rounded-md border border-destructive p-3 text-destructive">Wallet-এ ব্যালেন্স শেষ — আপনার ad গুলো বন্ধ রাখা হয়েছে। Top-up করলে আবার চালু করতে পারবেন।</div>}
            {data && Number(data.walletBalance) > Number(data.pauseThreshold ?? 1) && Number(data.walletBalance) <= Number(data.lowBalanceAlert ?? 10) && <div className="rounded-md border border-primary p-3">আপনার wallet-এ ${Number(data.walletBalance).toFixed(2)} বাকি — শেষ হলে ad নিজে থেকেই বন্ধ হয়ে যাবে।</div>}
            {error && <p className="text-destructive">{(error as Error).message}</p>}
            {(data?.errors ?? []).map((e: string, i: number) => <p key={i} className="text-destructive">{e}</p>)}
          </div>
        )}

        {/* Level tabs */}
        <div className="flex items-end gap-1 bg-background border-x border-fb-border px-4 pt-2">
          {([["campaign", "Campaigns"], ["adset", "Ad sets"], ["ad", "Ads"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("flex-1 max-w-[300px] h-11 px-4 text-left text-[15px] font-semibold rounded-t-lg border border-b-0 border-fb-border",
                tab === k ? "bg-background text-fb-blue border-t-2 border-t-fb-blue" : "bg-fb-bg text-fb-text")}>
              {l}
              {k === "adset" && selCampaigns.length > 0 && <span className="ml-2 text-xs font-normal text-fb-blue">for {selCampaigns.length} campaign</span>}
              {k === "ad" && (selCampaigns.length + selAdsets.length) > 0 && <span className="ml-2 text-xs font-normal text-fb-blue">filtered</span>}
            </button>
          ))}
          <div className="ml-auto pb-1">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-9 w-auto gap-2 border-fb-border text-[13px]"><SelectValue>{rangeLabel}: {dates.dateFrom} – {dates.dateTo}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Action toolbar */}
        <div className="flex flex-wrap items-center gap-2 bg-background border border-fb-border px-4 py-2">
          <button disabled={!accounts.length || !allPages.length} onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-fb-green text-[13px] font-semibold text-background hover:opacity-90 disabled:opacity-50">
            <Plus className="h-4 w-4" />Create
          </button>
          <button className={tbBtn} disabled={!(tab === "adset" && sel.length === 1)}
            onClick={() => { const r = adsets.find((x) => String(x.id) === sel[0]); if (r) editBudget(r); }}>
            <Pencil className="h-4 w-4" />Edit
          </button>
          {sel.length > 0 && <button className={tbBtn} onClick={() => setSel([])}>Clear {sel.length} selected</button>}
          <div className="ml-auto flex gap-2">
            <span className={tbBtn}>Columns: Performance</span>
            <span className={tbBtn}>Breakdown</span>
          </div>
        </div>

        {/* Table */}
        <div className="bg-background border-x border-b border-fb-border rounded-b-lg overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="border-b border-fb-border">
              <tr>
                {tab !== "ad" && <th className={cn(th, "w-10")} />}
                <th className={cn(th, "w-16")}>Off / On</th>
                <th className={cn(th, "min-w-[240px]")}>{tab === "campaign" ? "Campaign" : tab === "adset" ? "Ad set" : "Ad"}</th>
                <th className={cn(th, "text-fb-blue")}>Delivery</th>
                <th className={th}>Attribution setting</th>
                <th className={cn(th, "text-right")}>Results</th>
                <th className={cn(th, "text-right")}>Cost per result</th>
                {tab !== "ad" && <th className={cn(th, "text-right")}>Budget</th>}
                <th className={cn(th, "text-right")}>Amount spent</th>
                <th className={cn(th, "text-right")}>Impressions</th>
                <th className={cn(th, "text-right")}>Reach</th>
                <th className={cn(th, "text-right")}>CTR</th>
              </tr>
            </thead>
            <tbody>
              {isFetching && !data && <tr><td colSpan={12} className="py-10 text-center text-fb-muted">Loading…</td></tr>}
              {data && rows.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-fb-muted">No {levelName} yet. Click Create to start.</td></tr>}
              {rows.map((r, i) => {
                const res = resultOf(r.insights);
                const on = r.status === "ACTIVE";
                const eff = String(r.effective_status || r.status || "").toUpperCase();
                const deliv = eff === "ACTIVE" ? "Active" : eff.includes("PAUSED") ? "Off" : eff.includes("REVIEW") || eff === "PENDING_REVIEW" ? "In review" : eff.includes("DISAPPROVED") ? "Rejected" : eff.toLowerCase().replace(/_/g, " ") || "—";
                const dot = eff === "ACTIVE" ? "bg-fb-green" : eff.includes("DISAPPROVED") ? "bg-destructive" : "bg-fb-muted";
                const canBudget = tab === "adset" && (r.daily_budget || r.lifetime_budget);
                return (
                  <tr key={r.id} className={cn("border-b border-fb-border hover:bg-fb-blue-soft/50", i % 2 && "bg-fb-bg/50")}>
                    {tab !== "ad" && (
                      <td className={td}>
                        <input type="checkbox" className="h-4 w-4 accent-fb-blue" checked={sel.includes(String(r.id))}
                          onChange={(e) => setSel((s) => e.target.checked ? [...s, String(r.id)] : s.filter((x) => x !== String(r.id)))} />
                      </td>
                    )}
                    <td className={td}><Switch checked={on} disabled={busy === r.id} onCheckedChange={(v) => toggle(tab, r, v)} className="data-[state=checked]:bg-fb-blue" /></td>
                    <td className={cn(td, "whitespace-normal")}>
                      <div className="flex items-center gap-2">
                        {tab === "ad" && r.thumbnail_url && <img src={r.thumbnail_url} alt="" className="h-9 w-9 rounded object-cover" />}
                        <button className="text-left text-fb-blue hover:underline"
                          onClick={() => {
                            if (tab === "campaign") { setSelCampaigns([String(r.id)]); setSelAdsets([]); setTab("adset"); }
                            else if (tab === "adset") { setSelAdsets([String(r.id)]); setTab("ad"); }
                          }}>{r.name}</button>
                      </div>
                    </td>
                    <td className={td}><span className="inline-flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", dot)} />{deliv}</span></td>
                    <td className={td}>7-day click or 1-day view<span className={sub}>All conversions</span></td>
                    <td className={cn(td, "text-right")}>{res.count ? num(res.count) : "—"}<span className={sub}>Results</span></td>
                    <td className={cn(td, "text-right")}>{res.cost != null ? money(res.cost) : "—"}<span className={sub}>Per result</span></td>
                    {tab !== "ad" && (
                      <td className={cn(td, "text-right")}>
                        <span className="inline-flex items-center gap-1">
                          {r.daily_budget ? money(Number(r.daily_budget) / 100) : r.lifetime_budget ? money(Number(r.lifetime_budget) / 100) : "Using ad set budget"}
                          {canBudget && <button onClick={() => editBudget(r)} className="text-fb-muted hover:text-fb-blue"><Pencil className="h-3 w-3" /></button>}
                        </span>
                        {(r.daily_budget || r.lifetime_budget) && <span className={sub}>{r.daily_budget ? "Daily" : "Lifetime"}</span>}
                      </td>
                    )}
                    <td className={cn(td, "text-right")}>{money(r.insights?.spend)}</td>
                    <td className={cn(td, "text-right")}>{num(r.insights?.impressions)}</td>
                    <td className={cn(td, "text-right")}>{num(r.insights?.reach)}</td>
                    <td className={cn(td, "text-right")}>{r.insights?.ctr ? `${Number(r.insights.ctr).toFixed(2)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  {tab !== "ad" && <td className={td} />}
                  <td className={td} />
                  <td className={td}>Results from {rows.length} {levelName}</td>
                  <td className={td} />
                  <td className={td}>Multiple attribution settings</td>
                  <td className={cn(td, "text-right")}>{num(rowTotals.results)}<span className={sub}>Results</span></td>
                  <td className={cn(td, "text-right")}>{rowTotals.results ? money(rowTotals.spend / rowTotals.results) : "—"}<span className={sub}>Per result</span></td>
                  {tab !== "ad" && <td className={td} />}
                  <td className={cn(td, "text-right")}>{money(rowTotals.spend)}<span className={sub}>Total spent</span></td>
                  <td className={cn(td, "text-right")}>{num(rowTotals.impr)}<span className={sub}>Total</span></td>
                  <td className={cn(td, "text-right")}>{rowTotals.reach ? num(rowTotals.reach) : "—"}<span className={sub}>Accounts Center accounts</span></td>
                  <td className={td} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="mt-2 text-[11px] text-fb-muted">Ad-এর খরচ প্রতি ১৫ মিনিটে wallet থেকে কাটা হয় (Transactions-এ "Ad spend")।</p>
      </div>
    </DashboardLayout>
  );
}
