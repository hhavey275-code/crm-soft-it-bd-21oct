import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { Megaphone, Plus, RefreshCw, Pencil, Trash2, Film } from "lucide-react";
import { VideoLibrary } from "@/components/ads-manager/VideoLibrary";
import { AccountPicker } from "@/components/ads-manager/AccountPicker";
import { listDrafts, deleteDraft, type CampaignDraft } from "@/lib/campaignDrafts";
import { useAuth } from "@/contexts/AuthContext";
import { adDelivery, adsetDelivery, campaignDelivery } from "@/lib/adDelivery";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { managedAds, resultOf, salesOf } from "@/lib/managedAdsApi";
import { getCampaignStatusConfig } from "@/components/ads-manager/types";
import { ManagedCreateWizard } from "@/components/ads-manager/ManagedCreateWizard";
import { EditObjectDialog } from "@/components/ads-manager/EditObjectDialog";
import { ColumnsPicker, fmtCol, totalCol, useExtraColumns } from "@/components/ads-manager/fbColumns";
import { FbCampaignEditor } from "@/components/ads-manager/FbCampaignEditor";
import { FbDateRangePicker, makeRange, type FbRange } from "@/components/ads-manager/FbDateRangePicker";
import { FacebookConnectButton } from "@/components/client/FacebookConnectButton";
import { LinkPageByUrl } from "@/components/client/LinkPageByUrl";
import { useIsMobile } from "@/hooks/use-mobile";
import { myAdsAvailability } from "@/lib/myAdsAvailability";
import { MetaLoading } from "@/components/ads-manager/MetaLoading";
import { matchesAdsFilter, removeAdsObject } from "@/lib/myAdsRows";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";

type Level = "campaign" | "adset" | "ad";
const COOLDOWN_MS = 2 * 60_000;
const RANGES: Record<string, number> = { today: 0, "7d": 6, "30d": 29 };

const money = (v: any) => (v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`);
const num = (v: any) => (v == null || v === "" ? "—" : Number(v).toLocaleString());
const budget = (o: any) =>
  o.daily_budget ? `${money(Number(o.daily_budget) / 100)}/দিন` : o.lifetime_budget ? `${money(Number(o.lifetime_budget) / 100)} মোট` : "—";

export default function MyAdsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  const [tab, setTab] = useState<Level>("campaign");
  // Default to the last 7 days like Facebook Ads Manager, so results/spend are not empty on "today".
  const [range, setRange] = useState<FbRange>(() => makeRange("7d"));
  const extra = useExtraColumns();
  const [editCampaign, setEditCampaign] = useState<any | null>(null);
  const [selCampaigns, setSelCampaigns] = useState<string[]>([]);
  const [selAdsets, setSelAdsets] = useState<string[]>([]);
  const [selAds, setSelAds] = useState<string[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<"all" | "active" | "delivery">("all");
  const [sortBy, setSortBy] = useState<"fb" | "results" | "cost" | "spend" | "newest">("fb");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ level: Level; objects: any[] } | null>(null);
  const [lastManual, setLastManual] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [accSel, setAccSel] = useState<string | undefined>(undefined);
  const isMobile = useIsMobile();
  const [mobileStep, setMobileStepRaw] = useState<"accounts" | "campaigns">("accounts");
  const setMobileStep = (v: "accounts" | "campaigns") => { setMobileStepRaw(v); sessionStorage.setItem("myads-mobile-step", v); };
  const [newDraftId, setNewDraftId] = useState<string | undefined>(undefined);
  const [accSearch, setAccSearch] = useState("");
  // One-time cleanup: these caches used to be shared across logins on the same device,
  // so one client could see another client's accounts/campaigns. Now every key is per-user.
  useEffect(() => {
    try {
      localStorage.removeItem("myads-account");
      localStorage.removeItem("myads-accounts-cache");
      localStorage.removeItem("myads-drafts-v2");
      Object.keys(localStorage).filter((k) => k.startsWith("myads-list:")).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (!uid) return; const v = localStorage.getItem(`myads-account:${uid}`); if (v) setAccSel(v); }, [uid]);
  const [drafts, setDrafts] = useState<CampaignDraft[]>([]);
  const [openDraftObj, setOpenDraftObj] = useState<CampaignDraft | undefined>(undefined);
  useEffect(() => {
    const load = () => setDrafts(listDrafts(uid));
    load(); window.addEventListener("myads-drafts", load);
    return () => window.removeEventListener("myads-drafts", load);
  }, [uid]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const dates = useMemo(() => ({ dateFrom: range.from, dateTo: range.to }), [range]);

  const onAccountPicker = isMobile && mobileStep === "accounts";
  const forceFresh = useRef(false);
  const { data, isFetching, error, refetch: refetchQuery } = useQuery({
    queryKey: ["managed-ads-list", dates, accSel],
    queryFn: async () => {
      const ck = `myads-list:${uid}:${dates.dateFrom}:${dates.dateTo}:${accSel ?? ""}`;
      // Saved result for this account + date range opens instantly; only an explicit refresh asks Facebook.
      if (!forceFresh.current && uid) {
        const saved = await cacheGet(ck);
        if (saved) return saved as any;
      }
      forceFresh.current = false;
      const r: any = await managedAds({ action: "list", ...dates, ...(accSel ? { adAccountDbId: accSel } : {}) });
      if (uid) {
        void cacheSet(ck, r);
        try { localStorage.setItem(ck, JSON.stringify(r)); } catch { /* too big for localStorage; IndexedDB keeps it */ }
      }
      return r;
    },
    // The cache key carries the user id, so another user on this device never sees it.
    initialData: () => { try { if (!uid) return undefined; const c = localStorage.getItem(`myads-list:${uid}:${dates.dateFrom}:${dates.dateTo}:${accSel ?? ""}`); return c ? JSON.parse(c) : undefined; } catch { return undefined; } },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: !!uid && !onAccountPicker,
  });
  const refetch = () => { forceFresh.current = true; return refetchQuery(); };
  // On each fresh login, pull the latest data from Facebook once automatically;
  // after that the cached list stays until the client presses "Update now".
  useEffect(() => {
    if (!uid || onAccountPicker) return;
    const key = `myads-session-fetched:${uid}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* ignore */ }
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, onAccountPicker]);
  // Fast CRM-only account list (no Facebook calls), cached on the device for instant display.
  const { data: fastAccounts, isFetching: fastLoading } = useQuery({
    queryKey: ["managed-ads-accounts", uid],
    queryFn: async () => {
      const r = await managedAds<{ accounts: any[] }>({ action: "accounts" });
      try { if (uid) localStorage.setItem(`myads-accounts-cache:${uid}`, JSON.stringify(r.accounts)); } catch { /* ignore */ }
      return r.accounts;
    },
    initialData: () => { try { if (!uid) return undefined; const c = localStorage.getItem(`myads-accounts-cache:${uid}`); return c ? JSON.parse(c) : undefined; } catch { return undefined; } },
    initialDataUpdatedAt: 0,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  });

  const cooldownLeft = Math.max(0, lastManual + COOLDOWN_MS - now);
  const manualRefresh = () => {
    setLastManual(Date.now());
    refetch();
    qc.invalidateQueries({ queryKey: ["managed-ads-cur-summary"] });
    qc.invalidateQueries({ queryKey: ["managed-ads-acc-summary"] });
  };

  // Facebook order: switched-on items first, then newest first.
  const fbOrder = (list: any[]) => [...list].sort((a, b) => {
    const ra = a.status === "ACTIVE" ? 0 : 1, rb = b.status === "ACTIVE" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return String(b.created_time || b.updated_time || "").localeCompare(String(a.created_time || a.updated_time || "")) || String(b.id).localeCompare(String(a.id));
  });
  const campaigns: any[] = fbOrder(data?.campaigns ?? []);
  const adsets: any[] = fbOrder((data?.adsets ?? []).filter((s: any) => !selCampaigns.length || selCampaigns.includes(String(s.campaign_id))));
  const ads: any[] = fbOrder((data?.ads ?? []).filter((a: any) =>
    (!selCampaigns.length || selCampaigns.includes(String(a.campaign_id))) && (!selAdsets.length || selAdsets.includes(String(a.adset_id))),
  ));
  // Optional re-ordering on top of the Facebook order: best results / lowest cost per result first, etc.
  const sortRows = (list: any[]) => {
    if (sortBy === "fb") return list;
    const metric = (r: any) => {
      const res = resultOf(r.insights);
      return { res: res.count, cost: res.cost, spend: Number(r.insights?.spend || 0), t: String(r.created_time || r.updated_time || "") };
    };
    return [...list].sort((a, b) => {
      const A = metric(a), B = metric(b);
      if (sortBy === "results") return B.res - A.res || B.spend - A.spend;
      if (sortBy === "cost") {
        if (A.cost == null && B.cost == null) return B.spend - A.spend;
        if (A.cost == null) return 1;
        if (B.cost == null) return -1;
        return A.cost - B.cost;
      }
      if (sortBy === "spend") return B.spend - A.spend;
      return B.t.localeCompare(A.t);
    });
  };
  const rows = sortRows((tab === "campaign" ? campaigns : tab === "adset" ? adsets : ads).filter((r) =>
    matchesAdsFilter(r, quick) &&
    (!search.trim() || r.name?.toLowerCase().includes(search.trim().toLowerCase())),
  ));

  const totals = useMemo(() => campaigns.reduce((t, c) => {
    t.spend += Number(c.insights?.spend || 0); t.impr += Number(c.insights?.impressions || 0); t.clicks += Number(c.insights?.clicks || 0);
    t.results += resultOf(c.insights).count; return t;
  }, { spend: 0, impr: 0, clicks: 0, results: 0 }), [campaigns]);

  const toggle = async (level: Level, o: any, on: boolean) => {
    setBusy(o.id);
    try {
      await managedAds({ action: "set_status", level, objectId: String(o.id), status: on ? "ACTIVE" : "PAUSED", adAccountDbId: o.ad_account_db_id });
      toast.success(on ? "চালু হয়েছে" : "বন্ধ হয়েছে");
      qc.setQueryData(["managed-ads-list", dates, accSel], (old: any) => {
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
      await managedAds({ action: "set_budget", objectId: String(o.id), budgetType: type, amount, adAccountDbId: o.ad_account_db_id });
      toast.success("Budget আপডেট হয়েছে");
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const pages: any[] = data?.pages ?? [];
  const allPages: any[] = data?.allPages ?? pages;
  const accounts: any[] = (data?.accounts?.length ? data.accounts : fastAccounts) ?? [];
  const currentAccId: string | undefined = accSel ?? data?.selectedAccountId ?? accounts[0]?.id;
  const currentAcc = accounts.find((a) => a.id === currentAccId);
  const isShared = currentAcc?.kind === "shared";
  const pickAccount = (id: string) => { setAccSel(id); if (uid) localStorage.setItem(`myads-account:${uid}`, id); setSelCampaigns([]); setSelAdsets([]); setSelAds([]); };
  const orderedAccounts = currentAcc ? [currentAcc, ...accounts.filter((a) => a.id !== currentAcc.id)] : accounts;
  const summaryIds = accounts
    .filter((a) => !accSearch.trim() || `${a.name} ${a.account_id}`.toLowerCase().includes(accSearch.trim().toLowerCase()))
    .slice(0, 60).map((a) => a.id as string);
  const { data: accSummary } = useQuery({
    queryKey: ["managed-ads-acc-summary", summaryIds.join(",")],
    queryFn: async () => (await managedAds<{ summary: Record<string, any> }>({ action: "account_summary", ids: summaryIds })).summary,
    enabled: isMobile && mobileStep === "accounts" && summaryIds.length > 0,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: curSummary, error: curSummaryError } = useQuery({
    queryKey: ["managed-ads-cur-summary", currentAcc?.id],
    queryFn: async () => {
      if (!currentAcc?.id) return {};
      return (await managedAds<{ summary: Record<string, any> }>({ action: "account_summary", ids: [currentAcc.id] })).summary;
    },
    enabled: !!currentAcc?.id,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const curSm: any = currentAcc ? (curSummary?.[currentAcc.id] ?? accSummary?.[currentAcc.id]) : null;
  const availability = myAdsAvailability(curSm, curSummaryError?.message);
  const createDisabled = !currentAcc || !availability.canCreate;
  const blockedInfo = curSm && !curSm.error ? accountStatusInfo(curSm) : null;
  const blockedBanner = currentAcc && createDisabled && (
    <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-[13px] text-destructive">
      <p className="font-bold">{availability.title}</p>
      <p className="mt-1">{availability.instruction}</p>
      {blockedInfo?.billing && <p className="mt-1 text-[12px]">{blockedInfo.billing}</p>}
    </div>
  );
  const openDraft = (d: CampaignDraft) => { setOpenDraftObj(d); setCreating(true); sessionStorage.setItem("myads-wizard", d.id); };
  const startNew = () => {
    if (createDisabled) { toast.error(currentAcc ? availability.title : "আগে ad account বেছে নিন"); return; }
    const id = crypto.randomUUID(); setNewDraftId(id); setOpenDraftObj(undefined); setCreating(true); sessionStorage.setItem("myads-wizard", id);
  };
  const closeWizard = () => { setCreating(false); setOpenDraftObj(undefined); sessionStorage.removeItem("myads-wizard"); };
  // Restore view + open wizard if the page was reloaded/remounted (e.g. on mobile)
  useEffect(() => {
    const st = sessionStorage.getItem("myads-mobile-step");
    // Returning client with a saved account goes straight to campaigns — no re-selecting.
    if (st === "campaigns" || (!st && !!uid && !!localStorage.getItem(`myads-account:${uid}`))) setMobileStepRaw("campaigns");
    const wid = sessionStorage.getItem("myads-wizard");
    if (wid) {
      const d = listDrafts(uid).find((x) => x.id === wid);
      if (d) setOpenDraftObj(d); else setNewDraftId(wid);
      setCreating(true);
    }
  }, [uid]);
  const [libOpen, setLibOpen] = useState(false);
  const wizard = creating && (
        <ManagedCreateWizard
          key={openDraftObj?.id ?? newDraftId ?? "new"}
          newDraftId={newDraftId}
          accounts={orderedAccounts}
          allPages={allPages}
          walletBalance={Number(data?.walletBalance ?? 0)}
          draft={openDraftObj}
          userId={uid}
          onClose={closeWizard}
          onCreated={() => { closeWizard(); refetch(); }}
        />
  );

  const sel = tab === "campaign" ? selCampaigns : tab === "adset" ? selAdsets : selAds;
  const setSel = tab === "campaign" ? setSelCampaigns : tab === "adset" ? setSelAdsets : setSelAds;
  const summed = rows.reduce((t, r) => {
    t.spend += Number(r.insights?.spend || 0); t.impr += Number(r.insights?.impressions || 0);
    t.reach += Number(r.insights?.reach || 0); t.results += resultOf(r.insights).count; return t;
  }, { spend: 0, impr: 0, reach: 0, results: 0 });
  // Reach is de-duplicated by Meta, so unfiltered totals come from the account-level read.
  const acct = (data as any)?.accountTotals;
  const rowTotals = acct && quick === "all" && !search.trim()
    ? { ...summed, spend: Number(acct.spend || 0), impr: Number(acct.impressions || 0), reach: Number(acct.reach || 0) }
    : summed;
  const deleteObjects = async () => {
    if (!deleteTarget || busy) return;
    const { level, objects } = deleteTarget;
    const queryKey = ["managed-ads-list", dates, accSel];
    setBusy("deleting");
    const failed: any[] = [];
    let deleted = 0;
    for (const object of objects) {
      try {
        await managedAds({ action: "delete", level, objectId: String(object.id), adAccountDbId: object.ad_account_db_id });
        qc.setQueryData(queryKey, (old: any) => old ? removeAdsObject(old, level, String(object.id)) : old);
        deleted += 1;
      } catch (error: any) {
        failed.push(object);
        toast.error(`${object.name}: ${error.message}`);
      }
    }
    // Failed objects remain available to retry; successful ones disappear only after Meta confirms.
    const failedIds = failed.map(object => String(object.id));
    if (level === "campaign") { setSelCampaigns(failedIds); setSelAdsets([]); setSelAds([]); }
    else if (level === "adset") { setSelAdsets(failedIds); setSelAds([]); }
    else setSelAds(failedIds);
    setDeleteTarget(failed.length ? { level, objects: failed } : null);
    setBusy(null);
    if (deleted) toast.success(`${deleted}টি ${level === "campaign" ? "campaign" : level === "adset" ? "ad set" : "ad"} মুছে ফেলা হয়েছে`);
    if (deleted) {
      qc.invalidateQueries({ queryKey: ["managed-ads-list"] });
      qc.invalidateQueries({ queryKey: ["managed-ads-cur-summary"] });
      qc.invalidateQueries({ queryKey: ["managed-ads-acc-summary"] });
    }
  };
  const deleteDialog = (
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !busy) setDeleteTarget(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {deleteTarget?.level === "campaign" ? "campaign" : deleteTarget?.level === "adset" ? "ad set" : "ad"}?</AlertDialogTitle>
          <AlertDialogDescription>
            {deleteTarget?.objects.map(object => object.name).join(", ")} — Facebook থেকেও মুছে যাবে।
            {deleteTarget?.level !== "ad" && " এর নিচের বিজ্ঞাপনগুলোও মুছে যাবে।"} এটি ফিরিয়ে আনা যাবে না।
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!!busy} onClick={deleteObjects}><Trash2 className="h-4 w-4" />{busy === "deleting" ? "Deleting…" : "Delete"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const quickFilters = (
    <div className="flex flex-wrap gap-2 pt-1">
      {([["all", "All ads"], ["active", "Active ads"], ["delivery", "Had delivery"]] as const).map(([key, label]) => (
        <Button key={key} variant="outline" aria-pressed={quick === key} onClick={() => setQuick(key)} className={cn("h-9 px-3 text-[13px]", quick === key && "border-fb-blue bg-fb-blue-soft text-fb-blue")}>{label}</Button>
      ))}
    </div>
  );
  const sortPicker = (
    <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
      <SelectTrigger className="h-9 w-full border-fb-border text-[13px] sm:w-[240px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="fb">Facebook order (Active আগে)</SelectItem>
        <SelectItem value="results">বেশি result আগে</SelectItem>
        <SelectItem value="cost">কম খরচে result আগে</SelectItem>
        <SelectItem value="spend">বেশি খরচ আগে</SelectItem>
        <SelectItem value="newest">নতুন আগে</SelectItem>
      </SelectContent>
    </Select>
  );
  const levelName = tab === "campaign" ? "campaigns" : tab === "adset" ? "ad sets" : "ads";
  const updatedAgo = data?.fetchedAt ? Math.round((now - new Date(data.fetchedAt).getTime()) / 60000) : null;
  const th = "px-3 py-2 text-left text-[13px] font-bold text-fb-text border-r border-fb-border whitespace-nowrap align-top";
  const td = "px-3 py-2 font-medium border-r border-fb-border align-top whitespace-nowrap";
  const sub = "block text-[11px] text-fb-muted";
  const tbBtn = "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-fb-border bg-background text-[13px] text-fb-text hover:bg-fb-bg disabled:opacity-50";

  if (isMobile) {
    const startCreate = startNew;
    if (mobileStep === "accounts") {
      const q = accSearch.trim().toLowerCase();
      const list = accounts.filter((a) => !q || `${a.name} ${a.account_id}`.toLowerCase().includes(q));
      return (
        <DashboardLayout fullBleed hideChat>
          {wizard}
          {fastLoading && !accounts.length && <MetaLoading />}
          <div className="fb-font min-h-[calc(100dvh-3.5rem)] bg-background text-fb-text">
            <div className="sticky top-0 z-10 border-b border-fb-border bg-background px-4 py-3">
              <h1 className="text-center text-lg font-bold">Select account</h1>
              <Input className="mt-3 h-11 rounded-full border-fb-border px-4" placeholder="Search accounts" value={accSearch} onChange={(e) => setAccSearch(e.target.value)} />
            </div>
            {data && list.length === 0 && <p className="py-10 text-center text-fb-muted">কোনো ad account পাওয়া যায়নি।</p>}
            <div className="divide-y divide-fb-border">
              {list.map((a) => {
                const selected = a.id === currentAccId;
                const s = accSummary?.[a.id];
                const st = s ? accountStatusInfo(s) : null;
                return (
                  <button key={a.id} onClick={() => { pickAccount(a.id); setMobileStep("campaigns"); }} className="flex w-full items-center gap-4 px-4 py-4 text-left active:bg-fb-bg">
                    <span className={cn("h-6 w-6 shrink-0 rounded-full border-2", selected ? "border-[7px] border-fb-blue" : "border-fb-border")} />
                    <span className="min-w-0">
                      <span className="block truncate text-[16px] font-bold">{a.name}</span>
                      <span className="block text-[15px]">{String(a.account_id).replace(/^act_/, "")} · {s?.currency || "USD"}{a.kind === "shared" ? " · Shared (wallet)" : ""}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-fb-muted">
                        {!s ? <span>Loading status…</span> : st && (
                          <>
                            <span className={cn("inline-flex items-center gap-1.5 font-semibold", st.tone)}>
                              <span className={cn("h-2 w-2 rounded-full", st.dot)} />{st.label}
                            </span>
                            {s.active != null && <span>· {s.active ? `${s.active} active campaign${s.active > 1 ? "s" : ""}` : "No active campaigns"}</span>}
                          </>
                        )}
                      </span>
                      {st?.billing && <span className="mt-0.5 block text-[12px] font-medium text-destructive">{st.billing}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </DashboardLayout>
      );
    }
    const activeCount = campaigns.filter((c) => c.effective_status === "ACTIVE").length;
    const mcamps = sortRows(campaigns.filter((c) => matchesAdsFilter(c, quick) && (!search.trim() || c.name?.toLowerCase().includes(search.trim().toLowerCase()))));
    return (
      <DashboardLayout fullBleed hideChat>
        {wizard}
        {deleteDialog}
        {isFetching && !data && <MetaLoading />}
        {editCampaign && <FbCampaignEditor campaign={editCampaign} adsets={data?.adsets ?? []} ads={data?.ads ?? []} onClose={() => setEditCampaign(null)} onSaved={() => refetch()} />}
        <div className="fb-font min-h-[calc(100dvh-3.5rem)] bg-fb-bg pb-6 text-fb-text">
          <div className="sticky top-0 z-10 space-y-3 bg-fb-bg px-3 pb-2 pt-3">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <button onClick={() => setMobileStep("accounts")} className="min-w-0 text-left">
                <span className="flex items-center gap-1"><span className="truncate text-xl font-bold">{currentAcc?.name ?? "Ad account বাছুন"}</span><span className="text-sm">▾</span></span>
                <span className="flex items-center gap-1.5 text-[13px] text-fb-muted"><span className={cn("h-2 w-2 rounded-full", activeCount ? "bg-fb-green" : "bg-fb-muted")} />{activeCount ? `${activeCount} active campaign` : "No active campaigns"}</span>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <button className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-fb-border bg-background disabled:opacity-50" disabled={isFetching || cooldownLeft > 0} onClick={manualRefresh} title="Refresh">
                  <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                </button>
                <Button onClick={startCreate} disabled={createDisabled} title={createDisabled ? availability.title : undefined} className="inline-flex h-9 items-center gap-1 rounded-full bg-fb-green px-3 text-[13px] font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:blur-[1px]">
                  <Plus className="h-4 w-4" />Create
                </Button>
              </div>
            </div>
            <FbDateRangePicker value={range} onChange={setRange} />
          </div>
          <div className="space-y-3 px-3">
            {blockedBanner}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-fb-border bg-background p-4">
              <div><p className="text-[13px] text-fb-muted">Total amount spent</p><p className="text-2xl font-bold">{money(totals.spend)}</p></div>
              {isShared ? (
                <div><p className="text-[13px] text-fb-muted">Wallet balance</p><p className="text-2xl font-bold">{money(data?.walletBalance ?? 0)}</p></div>
              ) : (() => {
                const sm: any = currentAcc ? (curSummary?.[currentAcc.id] ?? accSummary?.[currentAcc.id]) : null;
                if (!sm) return <div><p className="text-[13px] text-fb-muted">Spend limit</p><p className="text-sm text-fb-muted">Loading…</p></div>;
                const cap = Number(sm.spendCap || 0);
                if (!cap) return <div><p className="text-[13px] text-fb-muted">Spend limit</p><p className="text-2xl font-bold">No limit</p></div>;
                const left = Math.max(cap - Number(sm.amountSpent || 0), 0);
                const pct = (left / cap) * 100;
                const bar = pct <= 20 ? "bg-destructive" : pct <= 50 ? "bg-yellow-500" : "bg-fb-blue";
                return (
                  <div className="min-w-0">
                    <p className="text-[13px] text-fb-muted">Spend limit {money(cap)}</p>
                    <p className="text-2xl font-bold">{money(left)}</p>
                    <p className="text-[11px] text-fb-muted">remaining</p>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.min(pct, 100)}%` }} /></div>
                  </div>
                );
              })()}
            </div>
            {(error || (data?.errors ?? []).length > 0) && (
              <div className="rounded-lg bg-background p-3 text-[13px] text-destructive">
                {error && <p>{(error as Error).message}</p>}
                {(data?.errors ?? []).map((e: string, i: number) => <p key={i}>{e}</p>)}
              </div>
            )}
            {!allPages.length && <FacebookConnectButton label="Connect Facebook" onDone={() => qc.invalidateQueries({ queryKey: ["managed-ads-list"] })} />}
            <LinkPageByUrl pages={allPages} adAccountDbId={currentAccId} onDone={() => qc.invalidateQueries({ queryKey: ["managed-ads-list"] })} />
            <div className="flex items-center justify-between pt-1">
              <h2 className="text-2xl font-bold">Campaigns</h2>
            </div>
            {quickFilters}
            <Input className="h-10 border-fb-border bg-background" placeholder="Search campaigns" value={search} onChange={(e) => setSearch(e.target.value)} />
            {sortPicker}
            {(quick === "all" ? drafts : []).map((d) => (
              <div key={d.id} className="rounded-lg border border-fb-border bg-background p-4">
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => openDraft(d)}>
                    <p className="truncate text-[17px]">{d.data.campaignName || "Untitled campaign"}</p>
                    <p className="text-[13px] text-fb-muted">In draft · {d.data.amount ? money(Number(d.data.amount)) : "—"}</p>
                  </button>
                  <button className="p-1 text-fb-muted" onClick={() => { if (confirm("এই draft মুছে ফেলবেন?")) deleteDraft(d.id, uid); }}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            {data && mcamps.length === 0 && !drafts.length && <p className="py-8 text-center text-fb-muted">এখনো কোনো campaign নেই। উপরের Create চাপুন।</p>}
            {mcamps.map((c) => {
              const res = resultOf(c.insights);
              const dv = campaignDelivery(c, data?.adsets ?? [], data?.ads ?? []);
              const dot = { green: "bg-fb-green", red: "bg-destructive", grey: "bg-fb-muted", blue: "bg-fb-blue", amber: "bg-primary" }[dv.tone];
              const on = c.status === "ACTIVE";
              return (
                <div key={c.id} className="rounded-lg border border-fb-border bg-background p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button className="min-w-0 text-left" onClick={() => setEditCampaign(c)}>
                      <p className="text-[17px] leading-snug">{c.name}</p>
                      <p className="flex items-center gap-1.5 text-[13px]"><span className={cn("h-2.5 w-2.5 rounded-full", dot)} /><span className={dv.tone === "green" ? "text-fb-green" : "text-fb-muted"}>{dv.label}</span><span className="text-fb-muted">{String(c.objective || "").replace("OUTCOME_", "").toLowerCase()}</span></p>
                    </button>
                    <Button variant="ghost" size="icon" title="Delete campaign" aria-label={`Delete ${c.name}`} disabled={!!busy || isFetching} onClick={() => setDeleteTarget({ level: "campaign", objects: [c] })}><Trash2 className="h-4 w-4" /></Button>
                    <Switch checked={on} disabled={!!busy} onCheckedChange={(v) => toggle("campaign", c, v)} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 divide-x divide-fb-border">
                    <div className="pr-2"><p className="text-lg font-bold">{res.count ? num(res.count) : "—"}</p><p className="text-[12px] text-fb-muted">Results</p></div>
                    <div className="px-2"><p className="text-lg font-bold">{res.cost != null ? money(res.cost) : "—"}</p><p className="text-[12px] text-fb-muted">Cost per result</p></div>
                    <div className="pl-2"><p className="text-lg font-bold">{money(c.insights?.spend ?? 0)}</p><p className="text-[12px] text-fb-muted">Spent</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout fullBleed hideChat>
      {wizard}
      {deleteDialog}
      {isFetching && !data && <MetaLoading />}
      {editCampaign && <FbCampaignEditor campaign={editCampaign} adsets={data?.adsets ?? []} ads={data?.ads ?? []} onClose={() => setEditCampaign(null)} onSaved={() => refetch()} />}
      <div className="fb-font flex h-[calc(100dvh-3.5rem)] flex-col bg-fb-bg p-1 text-fb-text sm:p-2">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-t-lg bg-background px-3 py-2 border border-fb-border sm:gap-3 sm:px-4 sm:py-3">
          <h1 className="text-lg font-bold">Campaigns</h1>
          <div className="ml-auto flex items-center gap-2 sm:order-last">
            <span className="hidden text-[13px] text-fb-muted sm:inline">
              {isFetching ? "Updating…" : updatedAgo == null ? "" : updatedAgo < 1 ? "Updated just now" : `Updated ${updatedAgo} min ago`}
            </span>
            <button className={tbBtn} onClick={() => setLibOpen(true)} title="Video library"><Film className="h-4 w-4" /><span className="hidden sm:inline">Video library</span></button>
            <VideoLibrary open={libOpen} onClose={() => setLibOpen(false)} accId={currentAccId} />
            <button className={tbBtn} disabled={isFetching || cooldownLeft > 0} onClick={manualRefresh} title="Refresh">
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              {cooldownLeft > 0 ? <span>{Math.ceil(cooldownLeft / 1000)}s</span> : <span className="hidden sm:inline">Update now</span>}
            </button>
          </div>
          <AccountPicker accounts={accounts} value={currentAccId} onChange={pickAccount} />
          <div className="hidden items-center gap-2 h-9 px-3 rounded-md border border-fb-border text-[13px] max-w-[260px] sm:flex">
            <Megaphone className="h-4 w-4 text-fb-muted shrink-0" />
            <span className="truncate">{allPages.length ? allPages.map((p) => p.page_name).join(", ") : "No page"}</span>
          </div>
          <FacebookConnectButton label={allPages.length ? "Facebook আবার connect" : "Connect Facebook"} onDone={() => qc.invalidateQueries({ queryKey: ["managed-ads-list"] })} />
          <LinkPageByUrl pages={allPages} adAccountDbId={currentAccId} onDone={() => qc.invalidateQueries({ queryKey: ["managed-ads-list"] })} />
          {currentAcc?.kind === "shared" && <div className="text-[13px] text-fb-muted">Wallet: <b className="text-fb-text">{money(data?.walletBalance ?? 0)}</b></div>}
        </div>

        {/* Filter chips + search */}
        <div className="bg-background border-x border-fb-border px-3 pb-2 space-y-2 sm:px-4 sm:pb-3 sm:space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {quickFilters}
            {sortPicker}
          </div>
          <Input className="h-10 border-fb-border" placeholder="Search to filter by: name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {(error || (data?.errors ?? []).length > 0 || (isShared && data && Number(data.walletBalance) <= Number(data.lowBalanceAlert ?? 10)) || (!isFetching && data && accounts.length === 0)) && (
          <div className="max-h-32 overflow-auto bg-background border-x border-fb-border px-3 pb-3 space-y-2 text-[13px] sm:max-h-none sm:px-4">
                        {!isFetching && data && accounts.length === 0 && <div className="rounded-md bg-fb-bg p-3">এখনো আপনার কোনো ad account CRM-এ যুক্ত নেই।</div>}
            {isShared && data && Number(data.walletBalance) <= Number(data.pauseThreshold ?? 1) && <div className="rounded-md border border-destructive p-3 text-destructive">Wallet-এ ব্যালেন্স শেষ — আপনার ad গুলো বন্ধ রাখা হয়েছে। Top-up করলে আবার চালু করতে পারবেন।</div>}
            {isShared && data && Number(data.walletBalance) > Number(data.pauseThreshold ?? 1) && Number(data.walletBalance) <= Number(data.lowBalanceAlert ?? 10) && <div className="rounded-md border border-primary p-3">আপনার wallet-এ ${Number(data.walletBalance).toFixed(2)} বাকি — শেষ হলে ad নিজে থেকেই বন্ধ হয়ে যাবে।</div>}
            {error && <p className="text-destructive">{(error as Error).message}</p>}
            {(data?.errors ?? []).map((e: string, i: number) => <p key={i} className="text-destructive">{e}</p>)}
          </div>
        )}

        {/* Level tabs */}
        <div className="flex flex-wrap items-end gap-1 bg-background border-x border-fb-border px-2 pt-2 sm:flex-nowrap sm:px-4">
          {([["campaign", "Campaigns"], ["adset", "Ad sets"], ["ad", "Ads"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("flex-1 sm:max-w-[300px] h-10 px-2 text-center text-[13px] font-semibold rounded-t-lg border border-b-0 border-fb-border sm:h-11 sm:px-4 sm:text-left sm:text-[15px]",
                tab === k ? "bg-background text-fb-blue border-t-2 border-t-fb-blue" : "bg-fb-bg text-fb-text")}>
              {l}
              {k === "adset" && selCampaigns.length > 0 && <span className="ml-2 hidden text-xs font-normal text-fb-blue sm:inline">for {selCampaigns.length} campaign</span>}
              {k === "ad" && (selCampaigns.length + selAdsets.length) > 0 && <span className="ml-2 hidden text-xs font-normal text-fb-blue sm:inline">filtered</span>}
            </button>
          ))}
          <div className="order-first w-full pb-1 sm:order-none sm:ml-auto sm:w-auto">
            <FbDateRangePicker value={range} onChange={setRange} />
          </div>
        </div>

        <EditObjectDialog level={tab} obj={editing} adAccountDbId={editing?.ad_account_db_id} onClose={() => setEditing(null)} onSaved={() => { setSel([]); refetch(); }} />
        {blockedBanner && <div className="bg-background border-x border-t border-fb-border px-2 pt-2 sm:px-4">{blockedBanner}</div>}
        {/* Action toolbar */}
        <div className="flex flex-wrap items-center gap-2 bg-background border border-fb-border px-2 py-2 sm:px-4">
          <Button onClick={startNew} disabled={createDisabled} title={createDisabled ? availability.title : undefined}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-fb-green text-[13px] font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:blur-[1px]">
            <Plus className="h-4 w-4" />Create
          </Button>
          <button className={tbBtn} disabled={sel.length !== 1}
            onClick={() => {
              const r = (tab === "campaign" ? campaigns : tab === "adset" ? adsets : ads).find((x) => String(x.id) === sel[0]); if (!r) return;
              const c = campaigns.find((x) => String(x.id) === String(tab === "campaign" ? r.id : r.campaign_id));
              if (c) setEditCampaign(c); else setEditing(r);
            }}>
            <Pencil className="h-4 w-4" />Edit
          </button>
          <Button variant="outline" className={tbBtn} title="Delete selected" disabled={!sel.length || !!busy || isFetching}
            onClick={() => { const objects = rows.filter(row => sel.includes(String(row.id))); if (objects.length) setDeleteTarget({ level: tab, objects }); }}>
            <Trash2 className="h-4 w-4" />Delete
          </Button>
          {sel.length > 0 && <button className={tbBtn} onClick={() => setSel([])}>Clear {sel.length}</button>}
          <div className="ml-auto flex gap-2">
            <ColumnsPicker keys={extra.keys} toggle={extra.toggle} className={tbBtn} />
            <span className={cn(tbBtn, "hidden sm:inline-flex")}>Breakdown</span>
          </div>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto bg-background border-x border-b border-fb-border rounded-b-lg">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--color-fb-border)]">
              <tr>
                <th className={cn(th, "w-10")} />
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
                <th className={cn(th, "text-right")}>Purchases</th><th className={cn(th, "text-right")}>Cost per purchase</th><th className={cn(th, "text-right")}>Purchase value</th><th className={cn(th, "text-right")}>ROAS</th>
                {extra.cols.map((c) => <th key={c.key} className={cn(th, "text-right max-w-[140px] whitespace-normal")}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data && rows.length === 0 && !(tab === "campaign" && drafts.length) && <tr><td colSpan={16} className="py-10 text-center text-fb-muted">No {levelName} yet. Click Create to start.</td></tr>}
              {tab === "campaign" && quick === "all" && drafts.filter((d) => !search.trim() || String(d.data.campaignName || "").toLowerCase().includes(search.trim().toLowerCase())).map((d) => (
                <tr key={d.id} className="border-b border-fb-border hover:bg-fb-blue-soft/50">
                  <td className={td} />
                  <td className={td}><Switch checked={false} disabled /></td>
                  <td className={cn(td, "whitespace-normal")}>
                    <div className="flex items-center gap-2">
                      <button className="text-left text-fb-blue hover:underline" onClick={() => openDraft(d)}>{d.data.campaignName || "Untitled campaign"}</button>
                      <button title="Edit" className="text-fb-muted hover:text-fb-blue" onClick={() => openDraft(d)}><Pencil className="h-3 w-3" /></button>
                      <button title="Draft মুছুন" className="text-fb-muted hover:text-destructive" onClick={() => { if (confirm("এই draft মুছে ফেলবেন?")) deleteDraft(d.id, uid); }}><Trash2 className="h-3 w-3" /></button>
                    </div>
                    <span className={sub}>Edited {new Date(d.updatedAt).toLocaleString()}</span>
                  </td>
                  <td className={td}><span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-fb-muted" />In draft</span></td>
                  <td className={td}>—</td><td className={cn(td, "text-right")}>—</td><td className={cn(td, "text-right")}>—</td>
                  <td className={cn(td, "text-right")}>{d.data.amount ? money(Number(d.data.amount)) : "—"}<span className={sub}>{d.data.budgetType === "lifetime" ? "Lifetime" : "Daily"}</span></td>
                  <td className={cn(td, "text-right")}>—</td><td className={cn(td, "text-right")}>—</td><td className={cn(td, "text-right")}>—</td><td className={cn(td, "text-right")}>—</td>
                  <td className={cn(td, "text-right")}>—</td><td className={cn(td, "text-right")}>—</td><td className={cn(td, "text-right")}>—</td><td className={cn(td, "text-right")}>—</td>
                  {extra.cols.map((c) => <td key={c.key} className={cn(td, "text-right")}>—</td>)}
                </tr>
              ))}
              {rows.map((r, i) => {
                const res = resultOf(r.insights);
                const on = r.status === "ACTIVE";
                const dv = tab === "campaign" ? campaignDelivery(r, data?.adsets ?? [], data?.ads ?? []) : tab === "adset" ? adsetDelivery(r, data?.ads ?? []) : adDelivery(r);
                const deliv = dv.label;
                const dot = { green: "bg-fb-green", red: "bg-destructive", grey: "bg-fb-muted", blue: "bg-fb-blue", amber: "bg-primary" }[dv.tone];
                const canBudget = tab === "adset" && (r.daily_budget || r.lifetime_budget);
                return (
                  <tr key={r.id} className={cn("border-b border-fb-border hover:bg-fb-blue-soft/50", i % 2 && "bg-fb-bg/50")}>
                    <td className={td}>
                        <input type="checkbox" className="h-4 w-4 accent-fb-blue" checked={sel.includes(String(r.id))}
                          onChange={(e) => setSel((s) => e.target.checked ? [...s, String(r.id)] : s.filter((x) => x !== String(r.id)))} />
                      </td>
                    <td className={td}><Switch checked={on} disabled={!!busy} onCheckedChange={(v) => toggle(tab, r, v)} className="data-[state=checked]:bg-fb-blue" /></td>
                    <td className={cn(td, "whitespace-normal")}>
                      <div className="flex items-center gap-2">
                        {tab === "ad" && r.thumbnail_url && <img src={r.thumbnail_url} alt="" className="h-9 w-9 rounded object-cover" />}
                        <button className="text-left text-fb-blue hover:underline"
                          onClick={() => {
                            if (tab === "campaign") { setSelCampaigns([String(r.id)]); setSelAdsets([]); setTab("adset"); }
                            else if (tab === "adset") { setSelAdsets([String(r.id)]); setTab("ad"); }
                          }}>{r.name}</button>
                        <button title="Edit" className="text-fb-muted hover:text-fb-blue" onClick={() => { const c = campaigns.find((x) => String(x.id) === String(tab === "campaign" ? r.id : r.campaign_id)); if (c) setEditCampaign(c); }}><Pencil className="h-3 w-3" /></button>
                        <Button variant="ghost" size="icon" title="Delete" aria-label={`Delete ${r.name}`} disabled={!!busy || isFetching} onClick={() => setDeleteTarget({ level: tab, objects: [r] })} className="h-7 w-7 text-fb-muted hover:text-destructive"><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </td>
                    <td className={td}><span className="inline-flex items-center gap-2"><span className={cn("h-3 w-3 rounded-full", dot)} />{deliv}</span></td>
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
                    {(() => { const s = salesOf(r.insights); return (<>
                      <td className={cn(td, "text-right")}>{s.purchases || "—"}</td>
                      <td className={cn(td, "text-right")}>{s.cpp != null ? money(s.cpp) : "—"}</td>
                      <td className={cn(td, "text-right")}>{s.value ? money(s.value) : "—"}</td>
                      <td className={cn(td, "text-right")}>{s.roas ? s.roas.toFixed(2) : "—"}</td>
                    </>); })()}
                    {extra.cols.map((c) => <td key={c.key} className={cn(td, "text-right")}>{fmtCol(c, c.get(r.insights))}</td>)}
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 bg-background shadow-[0_-1px_0_var(--color-fb-border)]">
                <tr className="font-semibold">
                  <td className={td} />
                  <td className={td} />
                  <td className={td}>Results from {rows.length} {levelName}</td>
                  <td className={td} />
                  <td className={td}>Multiple attribution settings</td>
                  <td className={cn(td, "text-right")}>{num(rowTotals.results)}<span className={sub}>Results</span></td>
                  <td className={cn(td, "text-right")}>{rowTotals.results ? money(rowTotals.spend / rowTotals.results) : "—"}<span className={sub}>Per result</span></td>
                  <td className={td} />
                  <td className={cn(td, "text-right")}>{money(rowTotals.spend)}<span className={sub}>Total spent</span></td>
                  <td className={cn(td, "text-right")}>{num(rowTotals.impr)}<span className={sub}>Total</span></td>
                  <td className={cn(td, "text-right")}>{rowTotals.reach ? num(rowTotals.reach) : "—"}<span className={sub}>Accounts Center accounts</span></td>
                  <td className={td} />
                  {(() => { const t = rows.reduce((a: any, r: any) => { const s = salesOf(r.insights); a.p += s.purchases; a.v += s.value; a.sp += Number(r.insights?.spend || 0); return a; }, { p: 0, v: 0, sp: 0 }); return (<>
                    <td className={cn(td, "text-right")}>{t.p || "—"}</td>
                    <td className={cn(td, "text-right")}>{t.p ? money(t.sp / t.p) : "—"}</td>
                    <td className={cn(td, "text-right")}>{t.v ? money(t.v) : "—"}</td>
                    <td className={cn(td, "text-right")}>{t.v && t.sp ? (t.v / t.sp).toFixed(2) : "—"}</td>
                  </>); })()}
                  {extra.cols.map((c) => <td key={c.key} className={cn(td, "text-right")}>{fmtCol(c, totalCol(c, rows))}<span className={sub}>{c.sub}</span></td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {isShared && <p className="mt-1 shrink-0 text-[11px] text-fb-muted">Ad-এর খরচ প্রতি ১৫ মিনিটে wallet থেকে কাটা হয় (Transactions-এ "Ad spend")।</p>}
      </div>
    </DashboardLayout>
  );
}

// Meta account_status / disable_reason → label shown under each account in the picker.
function accountStatusInfo(s: any): { label: string; tone: string; dot: string; billing?: string } {
  if (s.error) return { label: "Status পাওয়া যায়নি", tone: "text-fb-muted", dot: "bg-fb-muted" };
  const reasons: Record<number, string> = { 1: "Policy violation", 2: "Policy review", 3: "Payment problem (risk payment)", 4: "Account shut down", 5: "Under review", 6: "Business verification", 7: "Permanently closed", 8: "Unused account" };
  const bad = (label: string, billing?: string) => ({ label, tone: "text-destructive", dot: "bg-destructive", billing });
  const warn = (label: string, billing?: string) => ({ label, tone: "text-amber-600", dot: "bg-amber-500", billing });
  const due = s.balance > 0 ? ` — বকেয়া ${s.currency} ${s.balance.toFixed(2)}` : "";
  switch (s.status) {
    case 1: return { label: "Active", tone: "text-fb-green", dot: "bg-fb-green", billing: s.balance > 0 ? `Billing: unpaid balance ${s.currency} ${s.balance.toFixed(2)}` : undefined };
    case 2: return bad("Disabled", s.disableReason ? `Reason: ${reasons[s.disableReason] ?? s.disableReason}` : undefined);
    case 3: return bad("Unsettled", `Billing: payment failed${due} — payment method ঠিক করে Pay now দিন`);
    case 7: return warn("Pending risk review");
    case 8: return warn("Pending settlement", `Billing: payment processing${due}`);
    case 9: return warn("In grace period", `Billing: payment due${due}`);
    case 100: return bad("Pending closure");
    case 101: return bad("Closed");
    default: return { label: `Status ${s.status}`, tone: "text-fb-muted", dot: "bg-fb-muted" };
  }
}
