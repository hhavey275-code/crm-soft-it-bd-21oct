import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { cacheGet, cacheSet, cacheTransform } from "@/lib/myAdsCache";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { Megaphone, Plus, RefreshCw, Pencil, Trash2, Film, ArrowUp, ArrowDown, ArrowUpDown, Check, X, Copy } from "lucide-react";
import { VideoLibrary } from "@/components/ads-manager/VideoLibrary";
import { AccountPicker } from "@/components/ads-manager/AccountPicker";
import { listDrafts, deleteDraft, saveDraft, type CampaignDraft } from "@/lib/campaignDrafts";
import { draftFromCampaign } from "@/lib/draftFromCampaign";
import { useAuth } from "@/contexts/AuthContext";
import { adDelivery, adsetDelivery, campaignDelivery } from "@/lib/adDelivery";
import { DashboardLayout as FullLayout } from "@/components/DashboardLayout";
import { createContext, useContext } from "react";
// Inside admin Client Details the page is already in a layout; nesting it duplicates header/realtime.
const EmbeddedCtx = createContext(false);
function DashboardLayout({ children, ...rest }: any) {
  return useContext(EmbeddedCtx) ? <div className="min-h-[70vh]">{children}</div> : <FullLayout {...rest}>{children}</FullLayout>;
}
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { managedAds, resultOf, salesOf, setManagedAdsViewAs } from "@/lib/managedAdsApi";
import { getCampaignStatusConfig } from "@/components/ads-manager/types";
import { ManagedCreateWizard } from "@/components/ads-manager/ManagedCreateWizard";
import { AdsAgent } from "@/components/ads-manager/AdsAgent";
import { EditObjectDialog } from "@/components/ads-manager/EditObjectDialog";
import { ColumnsPicker, EXTRA_COLUMNS, METRIC_COLUMNS, fmtCol, totalCol, useMetricColumns } from "@/components/ads-manager/fbColumns";
import { FbCampaignEditor } from "@/components/ads-manager/FbCampaignEditor";
import { FbDateRangePicker, makeRange, type FbRange } from "@/components/ads-manager/FbDateRangePicker";
import { FacebookConnectButton } from "@/components/client/FacebookConnectButton";
import { LinkPageByUrl } from "@/components/client/LinkPageByUrl";
import { useIsMobile } from "@/hooks/use-mobile";
import { myAdsAvailability, myAdsAvailabilityPresentation } from "@/lib/myAdsAvailability";
import { MetaLoading } from "@/components/ads-manager/MetaLoading";
import { matchesAdsFilter, removeAdsObject, updateAdsStatus } from "@/lib/myAdsRows";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";

type Level = "campaign" | "adset" | "ad";
const COOLDOWN_MS = 2 * 60_000;
const RANGES: Record<string, number> = { today: 0, "7d": 6, "30d": 29 };

const money = (v: any) => (v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`);
const num = (v: any) => (v == null || v === "" ? "—" : Number(v).toLocaleString());
const budget = (o: any) =>
  o.daily_budget ? `${money(Number(o.daily_budget) / 100)}/দিন` : o.lifetime_budget ? `${money(Number(o.lifetime_budget) / 100)} মোট` : "—";

export default function MyAdsPage(props: { asUserId?: string } = {}) {
  return <EmbeddedCtx.Provider value={!!props.asUserId}><MyAdsInner {...props} /></EmbeddedCtx.Provider>;
}

function MyAdsInner({ asUserId }: { asUserId?: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  // Set synchronously so the very first requests already target the client.
  setManagedAdsViewAs(asUserId ?? null);
  useEffect(() => () => setManagedAdsViewAs(null), []);
  const uid = asUserId ?? user?.id;
  const [tab, setTab] = useState<Level>("campaign");
  // Default to the last 7 days like Facebook Ads Manager, so results/spend are not empty on "today".
  const [range, setRange] = useState<FbRange>(() => makeRange("today"));
  const columns = useMetricColumns(uid);
  const visibleMetricKeys = columns.keys.filter(key => tab !== "ad" || key !== "budget");
  const [editCampaign, setEditCampaign] = useState<any | null>(null);
  const [selCampaigns, setSelCampaigns] = useState<string[]>([]);
  const [selAdsets, setSelAdsets] = useState<string[]>([]);
  const [selAds, setSelAds] = useState<string[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState<"all" | "active" | "delivery">("all");
  const [sortBy, setSortBy] = useState<"fb" | "results" | "cost" | "spend" | "newest">("fb");
  type ColKey = "results" | "cost" | "budget" | "spend" | "impressions" | "reach" | "ctr";
  const [colSort, setColSort] = useState<{ key: ColKey; dir: "asc" | "desc" } | null>(null);
  // Click a column header: big→small, then small→big, then back to the normal order.
  const toggleCol = (key: ColKey) => setColSort((c) => (!c || c.key !== key ? { key, dir: "desc" } : c.dir === "desc" ? { key, dir: "asc" } : null));
  const [creating, setCreating] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<any | null>(null);
  const [copyName, setCopyName] = useState("");
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
      Object.keys(localStorage).filter((k) => k.startsWith("myads-list")).forEach((k) => localStorage.removeItem(k));
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
    queryKey: ["managed-ads-list", uid, dates, accSel],
    queryFn: async () => {
      const ck = `myads-list2:${uid}:${dates.dateFrom}:${dates.dateTo}:${accSel ?? ""}`;
      // Saved result for this account + date range opens instantly; only an explicit refresh asks Facebook.
      if (!forceFresh.current && uid) {
        const saved = await cacheGet(ck);
        if (saved) return saved as any;
      }
      forceFresh.current = false;
      const r: any = await managedAds({ action: "list", ...dates, ...(accSel ? { adAccountDbId: accSel } : {}) });
      // Facebook limits how often one ad account can be read. Then keep the last saved numbers on screen
      // and never overwrite them with an empty answer.
      const limited = (r?.errors ?? []).some((m: string) => /too many (api )?calls|#17\b|#80004|#613|#4\b|request limit/i.test(String(m)));
      if (limited) {
        const msg = "Facebook এই ad account থেকে অল্প সময়ে অনেক বার তথ্য চাওয়ায় সাময়িক বিরতি দিয়েছে। ১০–১৫ মিনিট পরে Update now চাপুন।";
        const saved: any = uid ? await cacheGet(ck) : undefined;
        if (saved) return { ...saved, errors: [msg + " এখন শেষবার সেভ করা তথ্য দেখানো হচ্ছে।"] };
        return { ...r, errors: [msg] };
      }
      if (uid) {
        void cacheSet(ck, r);
        try { localStorage.setItem(ck, JSON.stringify(r)); } catch { /* too big for localStorage; IndexedDB keeps it */ }
      }
      return r;
    },
    // The cache key carries the user id, so another user on this device never sees it.
    initialData: () => { try { if (!uid) return undefined; const c = localStorage.getItem(`myads-list2:${uid}:${dates.dateFrom}:${dates.dateTo}:${accSel ?? ""}`); return c ? JSON.parse(c) : undefined; } catch { return undefined; } },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Date changes keep the same account's rows on screen (only the thin bar shows); an account switch clears them so the full loader appears.
    placeholderData: (prev: any, prevQuery: any) => (prevQuery?.queryKey?.[1] === uid && prevQuery?.queryKey?.[3] === accSel ? prev : undefined),
    enabled: !!uid && !onAccountPicker,
  });
  const refetch = () => { forceFresh.current = true; return refetchQuery(); };
  // Only once per login (keyed by the login time) pull fresh data from Facebook;
  // every reload / new tab after that shows the saved data until "Update now".
  const loginStamp = (user as any)?.last_sign_in_at ?? "";
  useEffect(() => {
    if (!uid || onAccountPicker) return;
    const key = `myads-login-fetched:${uid}`;
    try {
      if (localStorage.getItem(key) === loginStamp) return;
      localStorage.setItem(key, loginStamp);
    } catch { /* ignore */ }
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, onAccountPicker, loginStamp]);
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

  // Facebook order: switched-on items first, then the most recently published / switched on / edited
  // on top, so a campaign just published never gets lost further down the list.
  const recent = (o: any) => Math.max(Date.parse(o.updated_time || "") || 0, Date.parse(o.created_time || "") || 0, Number(o._touched || 0));
  const fbOrder = (list: any[]) => [...list].sort((a, b) => {
    const ra = a.status === "ACTIVE" ? 0 : 1, rb = b.status === "ACTIVE" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return recent(b) - recent(a) || String(b.id).localeCompare(String(a.id));
  });
  const campaigns: any[] = fbOrder(data?.campaigns ?? []);
  const adsets: any[] = fbOrder((data?.adsets ?? []).filter((s: any) => !selCampaigns.length || selCampaigns.includes(String(s.campaign_id))));
  const ads: any[] = fbOrder((data?.ads ?? []).filter((a: any) =>
    (!selCampaigns.length || selCampaigns.includes(String(a.campaign_id))) && (!selAdsets.length || selAdsets.includes(String(a.adset_id))),
  ));
  // Results follow each row's campaign objective (Sales → purchases only, not link clicks).
  const campObj = new Map<string, string>((data?.campaigns ?? []).map((c: any) => [String(c.id), String(c.objective || "")]));
  const setGoal = new Map<string, string>((data?.adsets ?? []).map((s: any) => [String(s.id), String(s.optimization_goal || "")]));
  const baseResult = (r: any) => resultOf(r?.insights, {
    objective: r?.objective ?? campObj.get(String(r?.campaign_id)),
    goal: r?.optimization_goal ?? (r?.adset_id ? setGoal.get(String(r.adset_id)) : undefined),
  });
  // Like Ads Manager, a campaign's Results add up each ad set's own goal result.
  const setsByCamp = new Map<string, any[]>();
  for (const s of data?.adsets ?? []) { const k = String(s.campaign_id); if (!setsByCamp.has(k)) setsByCamp.set(k, []); setsByCamp.get(k)?.push(s); }
  const rowResult = (r: any) => {
    const isCamp = r && r.objective !== undefined && r.campaign_id === undefined;
    const sets = isCamp ? (setsByCamp.get(String(r.id)) ?? []).filter((s: any) => s.insights) : [];
    if (!sets.length) return baseResult(r);
    const count = sets.reduce((t: number, s: any) => t + baseResult(s).count, 0);
    const spend = Number(r.insights?.spend || 0);
    return { count, cost: count ? spend / count : null };
  };
  // Optional re-ordering on top of the Facebook order: best results / lowest cost per result first, etc.
  const sortRows = (list: any[]) => {
    if (colSort) {
      const val = (r: any): number | null => {
        const i = r.insights || {};
        if (colSort.key === "results") return rowResult(r).count;
        if (colSort.key === "cost") return rowResult(r).cost ?? null;
        if (colSort.key === "budget") { const b = Number(r.daily_budget || r.lifetime_budget || 0); return b ? b / 100 : null; }
        if (colSort.key === "spend") return Number(i.spend || 0);
        if (colSort.key === "impressions") return Number(i.impressions || 0);
        if (colSort.key === "reach") return Number(i.reach || 0);
        const imp = Number(i.impressions || 0); return imp ? Number(i.clicks || 0) / imp : null;
      };
      const m = colSort.dir === "asc" ? 1 : -1;
      return [...list].sort((a, b) => {
        const A = val(a), B = val(b);
        if (A == null && B == null) return 0;
        if (A == null) return 1;
        if (B == null) return -1;
        return (A - B) * m;
      });
    }
    if (sortBy === "fb") return list;
    const metric = (r: any) => {
      const res = rowResult(r);
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
  // "Active ads" = what the Delivery column shows as running, not just the switch being on.
  const isLive = (level: "campaign" | "adset" | "ad", r: any) => {
    const d = level === "campaign" ? campaignDelivery(r, data?.adsets ?? [], data?.ads ?? []) : level === "adset" ? adsetDelivery(r, data?.ads ?? []) : adDelivery(r);
    return d.label === "Active" || d.label === "Preparing" || d.label === "Learning" || d.label === "Learning limited";
  };
  const rows = sortRows((tab === "campaign" ? campaigns : tab === "adset" ? adsets : ads).filter((r) =>
    matchesAdsFilter(r, quick) && (quick !== "active" || isLive(tab, r)) &&
    (!search.trim() || r.name?.toLowerCase().includes(search.trim().toLowerCase())),
  ));

  const totals = useMemo(() => campaigns.reduce((t, c) => {
    t.spend += Number(c.insights?.spend || 0); t.impr += Number(c.insights?.impressions || 0); t.clicks += Number(c.insights?.clicks || 0);
    t.results += resultOf(c.insights).count; return t;
  }, { spend: 0, impr: 0, clicks: 0, results: 0 }), [campaigns]);

  const persistMutation = async (transform: (old: any) => any) => {
    qc.setQueriesData({ queryKey: ["managed-ads-list", uid] }, (old: any) => old ? transform(old) : old);
    if (uid) await cacheTransform(uid, transform);
  };
  // The list only carries running ad sets/ads (plus anything that spent in the dates). When an off
  // campaign is opened or selected, its ad sets/ads are fetched once and merged into the same data.
  const treeAsked = useRef(new Set<string>());
  useEffect(() => { treeAsked.current.clear(); }, [data?.fetchedAt, accSel]);
  useEffect(() => {
    if (!data) return;
    const want = new Set<string>([...(editCampaign ? [String(editCampaign.id)] : []), ...selCampaigns.map(String)]);
    const byAcc = new Map<string, string[]>();
    for (const id of want) {
      if (treeAsked.current.has(id) || (data.adsets ?? []).some((s: any) => String(s.campaign_id) === id)) continue;
      const c = (data.campaigns ?? []).find((x: any) => String(x.id) === id);
      if (!c?.ad_account_db_id) continue;
      treeAsked.current.add(id);
      byAcc.set(c.ad_account_db_id, [...(byAcc.get(c.ad_account_db_id) ?? []), id]);
    }
    for (const [acc, ids] of byAcc) {
      managedAds({ action: "tree", adAccountDbId: acc, campaignIds: ids.slice(0, 50) }).then((r: any) => {
        const add = (cur: any[], extra: any[]) => [...cur, ...extra.filter((x) => !cur.some((y) => String(y.id) === String(x.id)))];
        return persistMutation((old) => ({ ...old, adsets: add(old.adsets ?? [], r.adsets ?? []), ads: add(old.ads ?? [], r.ads ?? []) }));
      }).catch(() => { ids.forEach((id) => treeAsked.current.delete(id)); });
    }
  }, [editCampaign, selCampaigns, data]);

  const toggle = async (level: Level, o: any, on: boolean) => {
    if (busy) return;
    setBusy(o.id);
    try {
      const result = await managedAds({ action: "set_status", level, objectId: String(o.id), status: on ? "ACTIVE" : "PAUSED", adAccountDbId: o.ad_account_db_id });
      const key = level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads";
      await persistMutation(old => {
        const next = updateAdsStatus(old, level, String(o.id), result.object);
        return on ? { ...next, [key]: (next[key] ?? []).map((x: any) => (String(x.id) === String(o.id) ? { ...x, _touched: Date.now() } : x)) } : next;
      });
      toast.success(on ? "Enabled" : "Paused");
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  // Duplicate = an instant CRM copy: the campaign (with its ad sets and ads) becomes a draft and opens
  // in the full Create wizard, so every option can be changed before Publish. No Facebook copy call.
  const startDuplicate = async (campaign: any) => {
    if (busy) return;
    let sets = (data?.adsets ?? []).filter((x: any) => String(x.campaign_id) === String(campaign.id));
    let adsList = data?.ads ?? [];
    if (!sets.length) {
      setBusy("duplicating");
      try {
        const r: any = await managedAds({ action: "tree", adAccountDbId: campaign.ad_account_db_id, campaignIds: [String(campaign.id)] });
        sets = r.adsets ?? []; adsList = [...adsList, ...(r.ads ?? [])];
      } catch (e: any) { toast.error(e.message); return; } finally { setBusy(null); }
    }
    const d = { id: crypto.randomUUID(), updatedAt: Date.now(), data: draftFromCampaign(campaign, sets, adsList, allPages) };
    saveDraft(d.id, d.data, uid);
    openDraft(d);
  };
  const duplicateCampaign = async () => {
    if (!duplicateTarget || busy || !copyName.trim()) return;
    setBusy("duplicating");
    try {
      const result = await managedAds({ action: "duplicate", level: "campaign", objectId: String(duplicateTarget.id), adAccountDbId: duplicateTarget.ad_account_db_id, name: copyName.trim() });
      await persistMutation(old => ({ ...old, campaigns: old.campaigns.some((c: any) => String(c.id) === result.campaignId) ? old.campaigns : [...old.campaigns, result.campaign] }));
      setDuplicateTarget(null);
      toast.success("Campaign and all ad sets/ads copied — paused");
      if (result.warning) toast.warning(result.warning);
      await refetch();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const [budgetEdit, setBudgetEdit] = useState<{ id: string; type: string; value: string; adAccountDbId: any } | null>(null);
  const startBudgetEdit = (o: any) => {
    const type = o.lifetime_budget ? "lifetime" : "daily";
    const cur = Number(o[`${type}_budget`] || 0) / 100;
    setBudgetEdit({ id: String(o.id), type, value: cur ? cur.toFixed(2) : "", adAccountDbId: o.ad_account_db_id });
  };
  const saveBudget = async () => {
    if (!budgetEdit) return;
    const { id, type, value, adAccountDbId } = budgetEdit;
    const amount = Number(value);
    if (!(amount > 0)) { toast.error("সঠিক পরিমাণ দিন"); return; }
    setBusy(id);
    try {
      await managedAds({ action: "set_budget", objectId: id, budgetType: type, amount, adAccountDbId });
      toast.success("Budget আপডেট হয়েছে");
      setBudgetEdit(null);
      refetch();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  // Read client Page assignments independently of the saved Meta campaign report.
  const { data: liveClientPages } = useQuery({
    queryKey: ["my-ads-client-pages", uid],
    enabled: !!uid,
    queryFn: async () => {
      if (!uid) return [];
      const { data: rows, error } = await (await import("@/integrations/supabase/client")).supabase
        .from("client_facebook_pages").select("id,page_id,page_name,ad_account_id,status").eq("user_id", uid).neq("status", "rejected");
      if (error) throw error;
      return rows ?? [];
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const pages: any[] = liveClientPages ?? data?.pages ?? [];
  const allPages: any[] = liveClientPages ?? data?.allPages ?? pages;
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
  const availabilityPresentation = myAdsAvailabilityPresentation(availability);
  const createDisabled = !currentAcc || !availability.canCreate;
  const blockedInfo = curSm && !curSm.error ? accountStatusInfo(curSm) : null;
  const blockedBanner = currentAcc && availabilityPresentation.showWarning && (
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
    t.reach += Number(r.insights?.reach || 0); t.results += rowResult(r).count; return t;
  }, { spend: 0, impr: 0, reach: 0, results: 0 });
  // Reach is de-duplicated by Meta, so unfiltered totals come from the account-level read.
  const acct = (data as any)?.accountTotals;
  const rowTotals = acct && quick === "all" && !search.trim()
    ? { ...summed, spend: Number(acct.spend || 0), impr: Number(acct.impressions || 0), reach: Number(acct.reach || 0) }
    : summed;
  const deleteObjects = async () => {
    if (!deleteTarget || busy) return;
    const { level, objects } = deleteTarget;
    setBusy("deleting");
    const failed: any[] = [];
    let deleted = 0;
    for (const object of objects) {
      try {
        await managedAds({ action: "delete", level, objectId: String(object.id), adAccountDbId: object.ad_account_db_id });
        await persistMutation(old => removeAdsObject(old, level, String(object.id)));
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
      await refetch();
      qc.invalidateQueries({ queryKey: ["managed-ads-cur-summary"] });
      qc.invalidateQueries({ queryKey: ["managed-ads-acc-summary"] });
    }
  };
  const duplicateDialog = (
    <AlertDialog open={!!duplicateTarget} onOpenChange={open => { if (!open && !busy) setDuplicateTarget(null); }}>
      <AlertDialogContent className="ads-controls">
        <AlertDialogHeader><AlertDialogTitle>Duplicate campaign</AlertDialogTitle><AlertDialogDescription>All ad sets and ads will be copied. The new campaign stays paused.</AlertDialogDescription></AlertDialogHeader>
        <Input aria-label="Copied campaign name" maxLength={200} value={copyName} onChange={e => setCopyName(e.target.value)} />
        <AlertDialogFooter><AlertDialogCancel disabled={!!busy}>Cancel</AlertDialogCancel><Button variant="ads-copy" disabled={!!busy || !copyName.trim()} onClick={duplicateCampaign}><Copy />{busy === "duplicating" ? "Copying…" : "Duplicate"}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const deleteDialog = (
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !busy) setDeleteTarget(null); }}>
      <AlertDialogContent className="ads-controls">
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
  const sortTh = (key: ColKey, label: string) => (
    <th className={cn(th, "text-right")}>
      <button type="button" onClick={() => toggleCol(key)} className={cn("inline-flex items-center gap-1 hover:text-fb-blue", colSort?.key === key && "text-fb-blue")} title="ছোট থেকে বড় / বড় থেকে ছোট">
        {label}
        {colSort?.key === key ? (colSort.dir === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
      </button>
    </th>
  );
  const th = "px-2 py-1.5 text-left text-[13px] font-bold text-fb-text border-r border-fb-border whitespace-nowrap align-middle";
  const td = "px-2 py-1 font-medium border-r border-fb-border align-top whitespace-nowrap leading-tight";
  const sub = "block text-[11px] leading-tight text-fb-muted";
  const tbBtn = "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-fb-border bg-background text-[13px] text-fb-text hover:bg-fb-bg disabled:opacity-50";


  const metricHeader = (key: string) => {
    const sortable: ColKey[] = ["results", "cost", "budget", "spend", "impressions", "reach", "ctr"];
    const column = METRIC_COLUMNS.find(c => c.key === key);
    if (sortable.includes(key as ColKey)) return sortTh(key as ColKey, column?.label ?? key);
    return <th className={cn(th, "text-right max-w-[180px] whitespace-normal")}>{column?.label ?? key}</th>;
  };
  const metricContent = (r: any, key: string, draft = false) => {
    if (draft) return key === "budget" ? <>{r.data.amount ? money(Number(r.data.amount)) : "—"}<span className={sub}>{r.data.budgetType === "lifetime" ? "Lifetime" : "Daily"}</span></> : "—";
    const res = rowResult(r);
    const sales = salesOf(r.insights);
    switch (key) {
      case "attribution": return <>7-day click or 1-day view<span className={sub}>All conversions</span></>;
      case "results": return <>{res.count ? num(res.count) : "—"}<span className={sub}>Results</span></>;
      case "cost": return <>{res.cost != null ? money(res.cost) : "—"}<span className={sub}>Per result</span></>;
      case "budget": return budgetEdit?.id === String(r.id) ? (
        <div className="flex items-center justify-end gap-1">
          <input autoFocus inputMode="decimal" className="h-7 w-[72px] rounded-md border border-fb-border bg-background px-1.5 text-right text-xs tabular-nums" value={budgetEdit.value}
            onChange={(e) => setBudgetEdit({ ...budgetEdit, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") saveBudget(); if (e.key === "Escape") setBudgetEdit(null); }} />
          <Button size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy === budgetEdit.id} onClick={saveBudget}><Check className="h-3 w-3" />Publish</Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setBudgetEdit(null)}><X className="h-3 w-3" /></Button>
        </div>
      ) : <><span className="inline-flex items-center gap-1">{r.daily_budget ? money(Number(r.daily_budget) / 100) : r.lifetime_budget ? money(Number(r.lifetime_budget) / 100) : "Using ad set budget"}{tab === "adset" && (r.daily_budget || r.lifetime_budget) && <Button variant="ghost" size="icon" className="h-6 w-6" title="Edit budget" onClick={() => startBudgetEdit(r)}><Pencil className="h-3 w-3" /></Button>}</span>{(r.daily_budget || r.lifetime_budget) && <span className={sub}>{r.daily_budget ? "Daily" : "Lifetime"}</span>}</>;
      case "spend": return money(r.insights?.spend);
      case "impressions": return num(r.insights?.impressions);
      case "reach": return num(r.insights?.reach);
      case "ctr": return r.insights?.ctr ? `${Number(r.insights.ctr).toFixed(2)}%` : "—";
      case "purchases": return sales.purchases || "—";
      case "cost_purchase": return sales.cpp != null ? money(sales.cpp) : "—";
      case "purchase_value": return sales.value ? money(sales.value) : "—";
      case "roas": return sales.roas ? sales.roas.toFixed(2) : "—";
      default: { const col = EXTRA_COLUMNS.find(c => c.key === key); return col ? fmtCol(col, col.get(r.insights)) : "—"; }
    }
  };
  const salesTotals = rows.reduce((a, r) => { const sales = salesOf(r.insights); return { purchases: a.purchases + sales.purchases, value: a.value + sales.value, spend: a.spend + Number(r.insights?.spend || 0) }; }, { purchases: 0, value: 0, spend: 0 });
  const metricTotal = (key: string) => {
    switch (key) {
      case "attribution": return "Multiple attribution settings";
      case "results": return <>{num(rowTotals.results)}<span className={sub}>Results</span></>;
      case "cost": return <>{rowTotals.results ? money(rowTotals.spend / rowTotals.results) : "—"}<span className={sub}>Per result</span></>;
      case "spend": return <>{money(rowTotals.spend)}<span className={sub}>Total spent</span></>;
      case "impressions": return num(rowTotals.impr);
      case "reach": return <>{rowTotals.reach ? num(rowTotals.reach) : "—"}<span className={sub}>Accounts Center accounts</span></>;
      case "budget": case "ctr": return "—";
      case "purchases": return salesTotals.purchases || "—";
      case "cost_purchase": return salesTotals.purchases ? money(salesTotals.spend / salesTotals.purchases) : "—";
      case "purchase_value": return salesTotals.value ? money(salesTotals.value) : "—";
      case "roas": return salesTotals.value && salesTotals.spend ? (salesTotals.value / salesTotals.spend).toFixed(2) : "—";
      default: { const col = EXTRA_COLUMNS.find(c => c.key === key); return col ? <>{fmtCol(col, totalCol(col, rows))}<span className={sub}>{col.sub}</span></> : "—"; }
    }
  };

  if (isMobile) {
    const startCreate = startNew;
    if (mobileStep === "accounts") {
      const q = accSearch.trim().toLowerCase();
      const list = accounts.filter((a) => !q || `${a.name} ${a.account_id}`.toLowerCase().includes(q));
      return (
        <DashboardLayout fullBleed hideChat>
          {wizard}
        <AdsAgent account={currentAcc} userId={uid} asUserId={asUserId} onChanged={() => refetch()} />
          {fastLoading && !accounts.length && <MetaLoading />}
          <div className="ads-controls fb-font min-h-[calc(100dvh-3.5rem)] bg-background text-fb-text">
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
    const mcamps = sortRows(campaigns.filter((c) => matchesAdsFilter(c, quick) && (quick !== "active" || isLive("campaign", c)) && (!search.trim() || c.name?.toLowerCase().includes(search.trim().toLowerCase()))));
    return (
      <DashboardLayout fullBleed hideChat>
        {wizard}
        <AdsAgent account={currentAcc} userId={uid} asUserId={asUserId} onChanged={() => refetch()} />
        {deleteDialog}
        {duplicateDialog}
        {isFetching && !data && <MetaLoading />}
        {editCampaign && <FbCampaignEditor campaign={editCampaign} adsets={data?.adsets ?? []} ads={data?.ads ?? []} onClose={() => setEditCampaign(null)} onSaved={() => refetch()} />}
        <div className="ads-controls fb-font min-h-[calc(100dvh-3.5rem)] bg-fb-bg pb-6 text-fb-text">
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
                <Button onClick={startCreate} disabled={createDisabled} title={availabilityPresentation.showWarning ? availability.title : undefined} variant="ads-publish" className={cn("inline-flex h-9 items-center gap-1 rounded-full bg-fb-green px-3 text-[13px] font-semibold text-background disabled:cursor-not-allowed", availabilityPresentation.blurCreate ? "disabled:opacity-40 disabled:blur-[1px]" : "disabled:opacity-100")}>
                  <Plus className="h-4 w-4" />Create
                </Button>
              </div>
            </div>
            <FbDateRangePicker value={range} onChange={setRange} />
            {isFetching && data && <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-primary/15" role="progressbar" aria-label="Loading"><div className="h-full w-1/3 bg-primary animate-[myads-bar_1.1s_ease-in-out_infinite]" /></div>}
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
            <div className="flex flex-wrap items-center gap-2">{sortPicker}<ColumnsPicker {...columns} className={tbBtn} /></div>
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
              const dot = { green: "bg-fb-green", red: "bg-destructive", grey: "bg-fb-muted", blue: "border-[1.5px] border-fb-text/70 bg-transparent", amber: "bg-primary" }[dv.tone];
              const on = c.status === "ACTIVE";
              return (
                <div key={c.id} className="rounded-lg border border-fb-border bg-background p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button className="min-w-0 text-left" onClick={() => setEditCampaign(c)}>
                      <p className="text-[17px] leading-snug">{c.name}</p>
                      <p className="flex items-center gap-1.5 text-[13px]"><span className={cn("h-2.5 w-2.5 rounded-full", dot)} /><span className={dv.tone === "green" ? "text-fb-green" : "text-fb-muted"}>{dv.label}</span><span className="text-fb-muted">{String(c.objective || "").replace("OUTCOME_", "").toLowerCase()}</span></p>
                    </button>
                    <Button variant="ads-copy" size="icon" title="Duplicate campaign" aria-label={`Duplicate ${c.name}`} disabled={!!busy || isFetching} onClick={() => startDuplicate(c)}><Copy /></Button>
                    <Button variant="destructive" size="icon" title="Delete campaign" aria-label={`Delete ${c.name}`} disabled={!!busy || isFetching} onClick={() => setDeleteTarget({ level: "campaign", objects: [c] })}><Trash2 className="h-4 w-4" /></Button>
                    <Switch checked={on} disabled={!!busy} onCheckedChange={(v) => toggle("campaign", c, v)} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {columns.keys.filter(key => key !== "attribution").map(key => <div key={key} className="min-w-0"><div className="break-words text-base font-bold">{metricContent(c, key)}</div><p className="text-[12px] text-fb-muted">{METRIC_COLUMNS.find(col => col.key === key)?.label}</p></div>)}
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
        {duplicateDialog}
      <AdsAgent account={currentAcc} userId={uid} asUserId={asUserId} onChanged={() => refetch()} />
      {isFetching && !data && <MetaLoading />}
      {editCampaign && <FbCampaignEditor campaign={editCampaign} adsets={data?.adsets ?? []} ads={data?.ads ?? []} onClose={() => setEditCampaign(null)} onSaved={() => refetch()} />}
      <div className="ads-controls fb-font flex h-[calc(100dvh-3.5rem)] flex-col bg-fb-bg p-1 text-fb-text sm:p-2">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-t-lg bg-background px-3 py-2 border border-fb-border sm:px-4">
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

        {/* Filter chips + search (one row on PC) */}
        <div className="flex flex-col gap-2 bg-background border-x border-fb-border px-3 pb-2 sm:px-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            {quickFilters}
            {sortPicker}
          </div>
          <Input className="h-8 border-fb-border lg:flex-1" placeholder="Search to filter by: name" value={search} onChange={(e) => setSearch(e.target.value)} />
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
              className={cn("flex-1 sm:max-w-[300px] h-9 px-2 text-center text-[13px] font-semibold rounded-t-lg border border-b-0 border-fb-border sm:h-9 sm:px-4 sm:text-left sm:text-[15px]",
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
        <div className="relative flex flex-wrap items-center gap-2 bg-background border border-fb-border px-2 py-1.5 sm:px-4">
          {isFetching && data && <div className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-primary/15" role="progressbar" aria-label="Loading"><div className="h-full w-1/3 bg-primary animate-[myads-bar_1.1s_ease-in-out_infinite]" /></div>}
          <Button variant="ads-publish" onClick={startNew} disabled={createDisabled} title={availabilityPresentation.showWarning ? availability.title : undefined}
            className={cn("inline-flex items-center gap-1.5 h-8 px-4 rounded-md bg-fb-green text-[13px] font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed", availabilityPresentation.blurCreate ? "disabled:opacity-40 disabled:blur-[1px]" : "disabled:opacity-100")}>
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
          <Button variant="destructive" className="rounded-full" title="Delete selected" disabled={!sel.length || !!busy || isFetching}
            onClick={() => { const objects = rows.filter(row => sel.includes(String(row.id))); if (objects.length) setDeleteTarget({ level: tab, objects }); }}>
            <Trash2 className="h-4 w-4" />Delete
          </Button>
          {tab === "campaign" && <Button variant="ads-copy" disabled={sel.length !== 1 || !!busy || isFetching} onClick={() => { const c = campaigns.find(c => String(c.id) === sel[0]); if (c) startDuplicate(c); }}><Copy />Duplicate</Button>}
          {sel.length > 0 && <button className={tbBtn} onClick={() => setSel([])}>Clear {sel.length}</button>}
          <div className="ml-auto flex gap-2">
            <ColumnsPicker {...columns} className={tbBtn} />
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
                <th className={cn(th, "min-w-[320px]")}>{tab === "campaign" ? "Campaign" : tab === "adset" ? "Ad set" : "Ad"}</th>
                <th className={cn(th, "text-fb-blue")}>Delivery</th>
                {visibleMetricKeys.map(key => <Fragment key={key}>{metricHeader(key)}</Fragment>)}
              </tr>
            </thead>
            <tbody>
              {data && rows.length === 0 && !(tab === "campaign" && drafts.length) && <tr><td colSpan={4 + visibleMetricKeys.length} className="py-10 text-center text-fb-muted">No {levelName} yet. Click Create to start.</td></tr>}
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
                  {visibleMetricKeys.map(key => <td key={key} className={cn(td, "text-right")}>{metricContent(d, key, true)}</td>)}
                </tr>
              ))}
              {rows.map((r, i) => {
                const res = resultOf(r.insights);
                const on = r.status === "ACTIVE";
                const dv = tab === "campaign" ? campaignDelivery(r, data?.adsets ?? [], data?.ads ?? []) : tab === "adset" ? adsetDelivery(r, data?.ads ?? []) : adDelivery(r);
                const deliv = dv.label;
                const dot = { green: "bg-fb-green", red: "bg-destructive", grey: "bg-fb-muted", blue: "border-[1.5px] border-fb-text/70 bg-transparent", amber: "bg-primary" }[dv.tone];
                const canBudget = tab === "adset" && (r.daily_budget || r.lifetime_budget);
                return (
                  <tr key={r.id} className={cn("border-b border-fb-border hover:bg-fb-blue-soft/50", i % 2 && "bg-fb-bg/50")}>
                    <td className={td}>
                        <input type="checkbox" className="h-4 w-4 accent-fb-blue" checked={sel.includes(String(r.id))}
                          onChange={(e) => setSel((s) => e.target.checked ? [...s, String(r.id)] : s.filter((x) => x !== String(r.id)))} />
                      </td>
                    <td className={td}><Switch checked={on} disabled={!!busy} onCheckedChange={(v) => toggle(tab, r, v)} className="scale-75 origin-left data-[state=checked]:bg-fb-blue" /></td>
                    <td className={cn(td, "whitespace-normal")}>
                      <div className="flex items-center gap-2">
                        {tab === "ad" && r.thumbnail_url && <img src={r.thumbnail_url} alt="" className="h-9 w-9 rounded object-cover" />}
                        <button className="text-left text-fb-blue hover:underline"
                          onClick={() => {
                            if (tab === "campaign") { setSelCampaigns([String(r.id)]); setSelAdsets([]); setTab("adset"); }
                            else if (tab === "adset") { setSelAdsets([String(r.id)]); setTab("ad"); }
                          }}>{r.name}</button>
                        <button title="Edit" className="text-fb-muted hover:text-fb-blue" onClick={() => { const c = campaigns.find((x) => String(x.id) === String(tab === "campaign" ? r.id : r.campaign_id)); if (c) setEditCampaign(c); }}><Pencil className="h-3 w-3" /></button>
                      </div>
                    </td>
                    <td className={td}><span className="inline-flex items-center gap-2"><span className={cn("h-3 w-3 rounded-full", dot)} />{deliv}</span></td>
                    {visibleMetricKeys.map(key => <td key={key} className={cn(td, "text-right")}>{metricContent(r, key)}</td>)}
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
                  {visibleMetricKeys.map(key => <td key={key} className={cn(td, "text-right")}>{metricTotal(key)}</td>)}
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
