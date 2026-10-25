import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Loader2, X, Megaphone, MousePointer2, MessagesSquare, Filter, Users, ShoppingBag, Folder, LayoutGrid, FileText,
  CheckCircle2, AlertCircle, Pencil, Eye, Info, ChevronDown, ChevronUp, Sparkles, Check, ImagePlus, Wallet, MoreHorizontal,
  Plus, Trash2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { managedAds } from "@/lib/managedAdsApi";
import { supabase } from "@/integrations/supabase/client";
import { SalesAdsetOptions, SalesAdOptions, defaultSalesOpts, salesPayload, type SalesOpts } from "./SalesOptions";
import { VideoLibrary, uploadToAccount } from "./VideoLibrary";
import { cached } from "@/lib/adsCache";
import { saveDraft, deleteDraft, type CampaignDraft } from "@/lib/campaignDrafts";
import { PlacementPreview } from "./PlacementPreview";

type Obj = "AWARENESS" | "TRAFFIC" | "ENGAGEMENT" | "LEADS" | "APP" | "SALES";
const OBJECTIVES: { v: Obj; l: string; icon: any; d: string; good: string[] }[] = [
  { v: "AWARENESS", l: "Awareness", icon: Megaphone, d: "Show your ads to people who are most likely to remember them.", good: ["Reach", "Brand awareness", "Video views", "Store location awareness"] },
  { v: "TRAFFIC", l: "Traffic", icon: MousePointer2, d: "Send people to a destination, like your website.", good: ["Link clicks", "Landing page views", "Messenger, Instagram and WhatsApp"] },
  { v: "ENGAGEMENT", l: "Engagement", icon: MessagesSquare, d: "Get more messages, video views, post engagement or Page likes.", good: ["Messenger, Instagram and WhatsApp", "Video views", "Post engagement", "Conversions"] },
  { v: "LEADS", l: "Leads", icon: Filter, d: "Collect leads for your business or brand.", good: ["Website and instant forms", "Messenger, Instagram and WhatsApp", "Conversions", "Calls"] },
  { v: "APP", l: "App promotion", icon: Users, d: "Find new people to install your app and continue using it.", good: ["App installs", "App events"] },
  { v: "SALES", l: "Sales", icon: ShoppingBag, d: "Find people likely to purchase your product or service.", good: ["Conversions", "Catalog sales", "Messenger, Instagram and WhatsApp", "Calls"] },
];

const EVENTS = [
  ["PURCHASE", "Purchase"], ["ADD_TO_CART", "Add to cart"], ["INITIATE_CHECKOUT", "Initiate checkout"],
  ["LEAD", "Lead"], ["COMPLETE_REGISTRATION", "Complete registration"], ["CONTACT", "Contact"], ["VIEW_CONTENT", "View content"],
  ["ADD_PAYMENT_INFO", "Add payment info"], ["ADD_TO_WISHLIST", "Add to wishlist"], ["SEARCH", "Search"], ["START_TRIAL", "Start trial"], ["SUBSCRIBE", "Subscribe"],
  ["SUBMIT_APPLICATION", "Submit application"], ["SCHEDULE", "Schedule"], ["DONATE", "Donate"], ["FIND_LOCATION", "Find location"], ["CUSTOMIZE_PRODUCT", "Customize product"],
] as const;
const CTAS = [["SHOP_NOW", "Shop now"], ["ORDER_NOW", "Order now"], ["BUY_NOW", "Buy now"], ["LEARN_MORE", "Learn more"], ["SIGN_UP", "Sign up"], ["GET_OFFER", "Get offer"], ["CONTACT_US", "Contact us"], ["SEE_MORE", "See more"], ["BOOK_NOW", "Book now"], ["SUBSCRIBE", "Subscribe"], ["DOWNLOAD", "Download"], ["APPLY_NOW", "Apply now"], ["GET_QUOTE", "Get quote"], ["SEE_MENU", "See menu"], ["WATCH_MORE", "Watch more"], ["GET_STARTED", "Get started"], ["INQUIRE_NOW", "Inquire now"], ["REQUEST_TIME", "Request time"], ["DONATE_NOW", "Donate now"], ["NO_BUTTON", "No button"]] as const;
const SPECIAL = [["CREDIT", "Credit"], ["EMPLOYMENT", "Employment"], ["HOUSING", "Housing"], ["ISSUES_ELECTIONS_POLITICS", "Social issues, elections or politics"], ["FINANCIAL_PRODUCTS_SERVICES", "Financial products and services"]] as const;

interface Props {
  accounts: { id: string; account_id: string; name: string; kind: "shared" | "own" }[];
  allPages: any[];
  walletBalance: number;
  onClose: () => void;
  onCreated: () => void;
  draft?: CampaignDraft;
  newDraftId?: string;
  userId?: string;
}

// One ad inside an ad set.
interface AdDraft {
  adName: string;
  setup: "new" | "post";
  postId: string;
  message: string;
  headline: string;
  link: string;
  cta: string;
  postCta: string;
  image: { b64: string; url: string } | null;
  video: { id: string; name: string; picture?: string | null; src?: string | null } | null;
}

// One ad set with its own audience/budget/schedule and its ads.
interface AdsetDraft {
  adsetName: string;
  location: "WEBSITE" | "MESSAGING";
  pixelId: string;
  customEvent: string;
  so: SalesOpts;
  startTime: string;
  hasEnd: boolean;
  endTime: string;
  countries: string[];
  ageMin: string;
  ageMax: string;
  gender: string;
  interests: { id: string; name: string; type?: string }[];
  connections: "all" | "include" | "exclude";
  mainDest: "WEBSITE" | "CALL" | "BOTH";
  phone: string;
  engLoc: "ON_AD" | "MESSAGING" | "WEBSITE" | "CALLS" | "PAGE_LIKES" | "EVENT";
  destMode: "auto" | "manual";
  dests: ("MESSENGER" | "WHATSAPP")[];
  budgetType: "daily" | "lifetime";
  amount: string;
  bidStrategy: string;
  bidAmount: string;
  ads: AdDraft[];
}

// ---------- small Facebook-style building blocks ----------
const sel = "h-9 w-full rounded-md border border-fb-border bg-background px-3 text-[13px] text-fb-text focus:outline-none focus:ring-2 focus:ring-fb-blue/40";
const inp = sel;
function Section({ title, ok = true, children, right }: { title: string; ok?: boolean; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="rounded-lg border border-fb-border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        {ok ? <CheckCircle2 className="h-4 w-4 text-fb-green" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <div className="ml-auto">{right}</div>
      </div>
      <div className="space-y-3 text-[13px]">{children}</div>
    </div>
  );
}
function Field({ label, hint, req, children }: { label: string; hint?: string; req?: boolean; children: ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-[13px]">{req && "* "}{label} <Info className="inline h-3 w-3 text-fb-muted" /></p>
      {hint && <p className="mb-1 text-[12px] text-fb-muted">{hint}</p>}
      <div className={hint ? "" : "mt-1"}>{children}</div>
    </div>
  );
}
function Radio({ on, title, desc, onClick, disabled }: { on: boolean; title: string; desc?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-start gap-3 py-1.5 text-left disabled:opacity-50">
      <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2", on ? "border-fb-blue" : "border-fb-muted")}>
        {on && <span className="h-2 w-2 rounded-full bg-fb-blue" />}
      </span>
      <span><span className="block text-[13px]">{title}</span>{desc && <span className="block text-[12px] text-fb-muted">{desc}</span>}</span>
    </button>
  );
}
const Adv = () => <span className="inline-flex items-center gap-1 rounded-full bg-fb-green/10 px-2 py-0.5 text-[11px] font-semibold text-fb-green"><Sparkles className="h-3 w-3" />Advantage+ on</span>;

export function ManagedCreateWizard({ accounts, allPages, walletBalance, onClose, onCreated, draft, newDraftId, userId }: Props) {
  const pages = allPages.filter((p) => p.status !== "rejected");
  const [phase, setPhase] = useState<"objective" | "edit">("objective");
  const [pick, setPick] = useState<Obj | null>(null);
  const [objective, setObjective] = useState<Exclude<Obj, "APP">>("SALES");
  const [level, setLevel] = useState<0 | 1 | 2>(0);
  const [tab, setTab] = useState<"edit" | "review">("edit");
  const [saving, setSaving] = useState(false);

  const [accId, setAccId] = useState(accounts[0]?.id ?? "");
  const acc = accounts.find((a) => a.id === accId);
  const [pageDbId, setPageDbId] = useState(pages[0]?.id ?? "");
  const page = pages.find((p) => p.id === pageDbId);

  // campaign
  const [campaignName, setCampaignName] = useState("New Sales Campaign");
  const [budgetLevel, setBudgetLevel] = useState<"campaign" | "adset">("campaign");
  const [cBudgetType, setCBudgetType] = useState<"daily" | "lifetime">("daily");
  const [cAmount, setCAmount] = useState("5.00");
  const [cBidStrategy, setCBidStrategy] = useState("LOWEST_COST_WITHOUT_CAP");
  const [cBidAmount, setCBidAmount] = useState("");
  const [special, setSpecial] = useState<string[]>([]);
  const [showSpecial, setShowSpecial] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(true);
  // ad set (editing buffer for the selected ad set)
  const [adsetName, setAdsetName] = useState("New Sales Ad Set");
  const [location, setLocation] = useState<"WEBSITE" | "MESSAGING">("WEBSITE");
  const [pixels, setPixels] = useState<any[] | null>(null);
  const [pixelId, setPixelId] = useState("");
  const [customEvent, setCustomEvent] = useState("PURCHASE");
  const [so, setSoState] = useState<SalesOpts>(defaultSalesOpts);
  const setSo = (p: Partial<SalesOpts>) => setSoState((o) => ({ ...o, ...p }));
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [startTime, setStartTime] = useState(today);
  const [hasEnd, setHasEnd] = useState(false);
  const [endTime, setEndTime] = useState("");
  const [countries, setCountries] = useState<string[]>(["BD"]);
  const [cq, setCq] = useState("");
  const [ageMin, setAgeMin] = useState("18");
  const [ageMax, setAgeMax] = useState("65");
  const [gender, setGender] = useState("all");
  const [interests, setInterests] = useState<{ id: string; name: string; type?: string }[]>([]);
  const [reach, setReach] = useState<"loading" | "error" | { lower: number | null; upper: number | null } | null>(null);
  const reachKey = JSON.stringify([accId, pageDbId, countries, ageMin, ageMax, gender, interests.map((i) => i.id)]);
  useEffect(() => {
    if (level !== 1 || !accId || !pageDbId || !countries.length) return;
    let stop = false;
    setReach("loading");
    const t = setTimeout(() => {
      managedAds<{ lower: number | null; upper: number | null }>({ action: "reach_estimate", pageDbId, adAccountDbId: accId, countries, ageMin, ageMax, gender, interests })
        .then((r) => { if (!stop) setReach(r); })
        .catch(() => { if (!stop) setReach("error"); });
    }, 600);
    return () => { stop = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reachKey, level]);
  const [iq, setIq] = useState("");
  const [iResults, setIResults] = useState<any[]>([]);
  const [placements, setPlacements] = useState<"auto" | "manual">("auto");
  const [connections, setConnections] = useState<"all" | "include" | "exclude">("all");
  const [mainDest, setMainDest] = useState<"WEBSITE" | "CALL" | "BOTH">("WEBSITE");
  const [phone, setPhone] = useState("");
  const [engLoc, setEngLoc] = useState<"ON_AD" | "MESSAGING" | "WEBSITE" | "CALLS" | "PAGE_LIKES" | "EVENT">("MESSAGING");
  const [destMode, setDestMode] = useState<"auto" | "manual">("auto");
  const [dests, setDests] = useState<("MESSENGER" | "WHATSAPP")[]>(["MESSENGER"]);
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily");
  const [amount, setAmount] = useState("5.00");
  const [bidStrategy, setBidStrategy] = useState("LOWEST_COST_WITHOUT_CAP");
  const [bidAmount, setBidAmount] = useState("");
  // ad (editing buffer for the selected ad)
  const [adName, setAdName] = useState("New Sales Ad");
  const [setup, setSetup] = useState<"new" | "post">("new");
  const [postId, setPostId] = useState("");
  const [posts, setPosts] = useState<any[] | null>(null);
  const [postsNeedAccess, setPostsNeedAccess] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [link, setLink] = useState("");
  const [cta, setCta] = useState("SHOP_NOW");
  const [image, setImage] = useState<{ b64: string; url: string } | null>(null);
  const [video, setVideo] = useState<{ id: string; name: string; picture?: string | null; src?: string | null } | null>(null);
  const [postCta, setPostCta] = useState("");
  // shared
  const [force, setForce] = useState(0);
  const [videoBusy, setVideoBusy] = useState(false);
  const [pageInfo, setPageInfo] = useState<{ whatsappNumber: string | null; phone: string | null; picture: string | null; pageTokenMissing?: boolean } | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const [infoTick, setInfoTick] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoItems, setDemoItems] = useState<any[] | null>(null);
  const restored = useRef(false);

  // ---- multi ad set / multi ad store ----
  // The form fields above are the editing buffer for the SELECTED ad set/ad.
  // `adsets` holds a flushed copy of every ad set; navigation flushes the buffer first.
  const [adsets, setAdsets] = useState<AdsetDraft[]>([{
    adsetName: "New Sales Ad Set", location: "WEBSITE", pixelId: "", customEvent: "PURCHASE", so: defaultSalesOpts,
    startTime: today, hasEnd: false, endTime: "", countries: ["BD"], ageMin: "18", ageMax: "65", gender: "all",
    interests: [], connections: "all", mainDest: "WEBSITE", phone: "", engLoc: "MESSAGING", destMode: "auto", dests: ["MESSENGER"],
    budgetType: "daily", amount: "5.00", bidStrategy: "LOWEST_COST_WITHOUT_CAP", bidAmount: "",
    ads: [{ adName: "New Sales Ad", setup: "new", postId: "", message: "", headline: "", link: "", cta: "SHOP_NOW", postCta: "", image: null, video: null }],
  }]);
  const [selPos, setSelPos] = useState<{ a: number; d: number }>({ a: 0, d: 0 });

  const label = OBJECTIVES.find((o) => o.v === objective)?.l ?? "";
  const mkAd = (name: string): AdDraft => ({ adName: name, setup: "new", postId: "", message: "", headline: "", link: "", cta: objective === "LEADS" ? "SIGN_UP" : objective === "SALES" ? "SHOP_NOW" : "LEARN_MORE", postCta: "", image: null, video: null });
  const collectAd = (): AdDraft => ({
    adName, setup, postId, message, headline, link, cta, postCta, image,
    video: video ? { ...video, src: video.src?.startsWith("blob:") ? null : video.src } : null,
  });
  const collectAdset = (ads: AdDraft[]): AdsetDraft => ({
    adsetName, location, pixelId, customEvent, so, startTime, hasEnd, endTime, countries, ageMin, ageMax, gender,
    interests, connections, mainDest, phone, engLoc, destMode, dests, budgetType, amount, bidStrategy, bidAmount, ads,
  });
  // Every ad set with the current buffer merged in.
  const flushed = (): AdsetDraft[] =>
    adsets.map((s, i) => (i === selPos.a ? collectAdset(s.ads.map((ad, j) => (j === selPos.d ? collectAd() : ad))) : s));
  const loadAd = (a: AdDraft) => {
    setAdName(a.adName); setSetup(a.setup); setPostId(a.postId); setMessage(a.message); setHeadline(a.headline);
    setLink(a.link); setCta(a.cta); setPostCta(a.postCta); setImage(a.image); setVideo(a.video);
  };
  const loadAdset = (s: AdsetDraft, d: number) => {
    setAdsetName(s.adsetName); setLocation(s.location); setPixelId(s.pixelId); setCustomEvent(s.customEvent);
    setSoState(s.so); setStartTime(s.startTime); setHasEnd(s.hasEnd); setEndTime(s.endTime); setCountries(s.countries);
    setAgeMin(s.ageMin); setAgeMax(s.ageMax); setGender(s.gender); setInterests(s.interests); setConnections(s.connections);
    setMainDest(s.mainDest); setPhone(s.phone); setEngLoc(s.engLoc); setDestMode(s.destMode); setDests(s.dests);
    setBudgetType(s.budgetType); setAmount(s.amount); setBidStrategy(s.bidStrategy); setBidAmount(s.bidAmount);
    loadAd(s.ads[Math.max(0, Math.min(d, s.ads.length - 1))] ?? s.ads[0]);
  };
  const goto = (a: number, d: number) => {
    const f = flushed();
    setAdsets(f);
    const s = f[a];
    if (!s) return;
    const dd = d < 0 ? 0 : Math.min(d, s.ads.length - 1);
    loadAdset(s, dd);
    setSelPos({ a, d: dd });
    setLevel(d < 0 ? 1 : 2);
    setTab("edit");
  };
  const gotoCampaign = () => { setAdsets(flushed()); setLevel(0); setTab("edit"); };
  const addAdset = () => {
    const f = flushed();
    // Copy the current ad set's audience/budget so the new one starts from a sensible place.
    const cur = collectAdset([]);
    const nu: AdsetDraft = { ...cur, adsetName: `New ${label} Ad Set ${f.length + 1}`, ads: [mkAd(`New ${label} Ad 1`)] };
    const next = [...f, nu];
    setAdsets(next);
    loadAdset(nu, 0);
    setSelPos({ a: next.length - 1, d: 0 });
    setLevel(1);
    setTab("edit");
  };
  const addAd = () => {
    const f = flushed();
    const s = f[selPos.a];
    const nu = mkAd(`New ${label} Ad ${s.ads.length + 1}`);
    s.ads = [...s.ads, nu];
    setAdsets(f);
    loadAd(nu);
    setSelPos({ a: selPos.a, d: s.ads.length - 1 });
    setLevel(2);
    setTab("edit");
  };
  const removeAdset = (i: number) => {
    if (adsets.length <= 1) return;
    const f = flushed().filter((_, x) => x !== i);
    const ni = Math.min(i, f.length - 1);
    setAdsets(f);
    loadAdset(f[ni], 0);
    setSelPos({ a: ni, d: 0 });
  };
  const removeAd = (j: number) => {
    const f = flushed();
    const s = f[selPos.a];
    if (s.ads.length <= 1) return;
    s.ads = s.ads.filter((_, x) => x !== j);
    const nj = Math.min(j, s.ads.length - 1);
    setAdsets(f);
    loadAd(s.ads[nj]);
    setSelPos({ a: selPos.a, d: nj });
  };

  // ---- drafts: every new campaign gets its own draft; Edit on a draft reopens exactly that one ----
  const draftId = useRef(draft?.id ?? newDraftId ?? crypto.randomUUID()).current;
  const snapshot = {
    phase, pick, objective, level, selPos, pageDbId, accId, campaignName, budgetLevel,
    cBudgetType, cAmount, cBidStrategy, cBidAmount, special,
    // Images are too big for localStorage — keep everything else.
    adsets: flushed().map((s) => ({ ...s, ads: s.ads.map((a) => ({ ...a, image: null })) })),
  };
  useEffect(() => {
    try {
      const d = draft?.data;
      if (d) {
        if (d.phase) setPhase(d.phase);
        if (d.pick) setPick(d.pick);
        if (d.objective) setObjective(d.objective);
        if (d.level !== undefined) setLevel(d.level);
        if (d.campaignName !== undefined) setCampaignName(d.campaignName);
        if (d.budgetLevel) setBudgetLevel(d.budgetLevel);
        if (d.cBudgetType) setCBudgetType(d.cBudgetType);
        if (d.cAmount !== undefined) setCAmount(d.cAmount);
        if (d.cBidStrategy) setCBidStrategy(d.cBidStrategy);
        if (d.cBidAmount !== undefined) setCBidAmount(d.cBidAmount);
        if (d.special) setSpecial(d.special);
        let sets: AdsetDraft[] | null = null;
        if (Array.isArray(d.adsets) && d.adsets.length) {
          sets = d.adsets;
        } else if (d.adsetName !== undefined) {
          // Legacy single-ad-set draft — wrap it into the new shape.
          sets = [{
            adsetName: d.adsetName ?? "", location: d.location ?? "WEBSITE", pixelId: "", customEvent: d.customEvent ?? "PURCHASE",
            so: defaultSalesOpts, startTime: d.startTime ?? today, hasEnd: !!d.hasEnd, endTime: d.endTime ?? "",
            countries: d.countries ?? ["BD"], ageMin: d.ageMin ?? "18", ageMax: d.ageMax ?? "65", gender: d.gender ?? "all",
            interests: d.interests ?? [], connections: "all", mainDest: "WEBSITE", phone: d.phone ?? "",
            engLoc: d.engLoc ?? "MESSAGING", destMode: d.destMode ?? "auto", dests: d.dests ?? ["MESSENGER"],
            budgetType: d.budgetType ?? "daily", amount: d.amount ?? "5.00",
            bidStrategy: d.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP", bidAmount: d.bidAmount ?? "",
            ads: [{
              adName: d.adName ?? "", setup: d.setup ?? "new", postId: d.postId ?? "", message: d.message ?? "",
              headline: d.headline ?? "", link: d.link ?? "", cta: d.cta ?? "SHOP_NOW", postCta: d.postCta ?? "",
              image: null, video: d.video ?? null,
            }],
          }];
        }
        if (sets) {
          sets = sets.map((s) => ({ ...defaultAdsetShape, ...s, so: { ...defaultSalesOpts, ...s.so }, ads: s.ads?.length ? s.ads : [mkAd("New Ad")] }));
          setAdsets(sets);
          const sp = d.selPos && d.selPos.a < sets.length ? d.selPos : { a: 0, d: 0 };
          loadAdset(sets[sp.a], sp.d);
          setSelPos({ a: sp.a, d: sp.d });
        }
        if (d.pageDbId && pages.some((p) => p.id === d.pageDbId)) setPageDbId(d.pageDbId);
        if (d.accId && accounts.some((a) => a.id === d.accId)) setAccId(d.accId);
      }
    } catch { /* ignore */ }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Save only when the content actually changed (debounced). Saving on every render caused an
  // endless loop (save -> list refresh -> re-render -> save) that froze the page on mobile.
  const snapJson = JSON.stringify(snapshot);
  const lastSaved = useRef<string>("");
  useEffect(() => {
    if (!restored.current || phase !== "edit" || snapJson === lastSaved.current) return;
    const t = setTimeout(() => { lastSaved.current = snapJson; saveDraft(draftId, JSON.parse(snapJson), userId); }, 600);
    return () => clearTimeout(t);
  }, [snapJson, phase, draftId, userId]);
  const clearDraft = () => deleteDraft(draftId, userId);
  const askClose = () => (phase === "edit" ? setConfirmClose(true) : onClose());
  const discard = () => { clearDraft(); setConfirmClose(false); onClose(); };
  const keepDraft = () => { saveDraft(draftId, snapshot, userId); setConfirmClose(false); toast.success("Draft হিসেবে রাখা হয়েছে — list-এ দেখা যাবে"); onClose(); };

  // Browser back / reload should not silently lose the campaign.
  useEffect(() => {
    if (phase !== "edit") return;
    history.pushState({ wizard: true }, "");
    const onPop = () => { history.pushState({ wizard: true }, ""); setConfirmClose(true); };
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("popstate", onPop);
    window.addEventListener("beforeunload", onUnload);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("beforeunload", onUnload); };
  }, [phase]);

  // Flags for the SELECTED ad set (buffer) — drive the form sections.
  const isMsg = objective === "ENGAGEMENT" ? engLoc === "MESSAGING" : location === "MESSAGING" && (objective === "SALES" || objective === "LEADS");
  const canCall = (objective === "SALES" || objective === "LEADS" || objective === "TRAFFIC") && !isMsg;
  const callMode = objective === "ENGAGEMENT" ? engLoc === "CALLS" : canCall && mainDest === "CALL";
  const bothMode = (objective === "SALES" || objective === "LEADS") && location === "WEBSITE" && mainDest === "BOTH";
  const needsPixel = (objective === "SALES" || objective === "LEADS") && location === "WEBSITE" && !callMode;
  const [waManual, setWaManual] = useState("");
  const wa = (pageInfo?.whatsappNumber && pageInfo.whatsappNumber !== "linked" ? pageInfo.whatsappNumber : null) ?? (waManual.replace(/[^\d+]/g, "").length >= 8 ? waManual.replace(/[^\d+]/g, "") : pageInfo?.whatsappNumber === "linked" ? "WhatsApp connected ✓ (Page-এর Primary নম্বর)" : null);
  const waConnectUrl = `https://www.facebook.com/${encodeURIComponent(String((pages.find((p) => p.id === pageDbId) as any)?.page_id ?? ""))}/settings/?tab=linked_accounts`;
  const finalDests: ("MESSENGER" | "WHATSAPP")[] = destMode === "auto" ? (wa ? ["MESSENGER", "WHATSAPP"] : ["MESSENGER"]) : dests;
  const cAmt = Number(cAmount) || 0;
  const totalBudget = budgetLevel === "campaign" ? cAmt : flushed().reduce((t, s) => t + (Number(s.amount) || 0), 0);
  const overWallet = acc?.kind === "shared" && totalBudget > walletBalance;

  // Flags for ANY ad set (used for validation of the whole tree).
  const flagsFor = (s: AdsetDraft) => {
    const msg = objective === "ENGAGEMENT" ? s.engLoc === "MESSAGING" : s.location === "MESSAGING" && (objective === "SALES" || objective === "LEADS");
    const canC = (objective === "SALES" || objective === "LEADS" || objective === "TRAFFIC") && !msg;
    const call = objective === "ENGAGEMENT" ? s.engLoc === "CALLS" : canC && s.mainDest === "CALL";
    const both = (objective === "SALES" || objective === "LEADS") && s.location === "WEBSITE" && s.mainDest === "BOTH";
    const np = (objective === "SALES" || objective === "LEADS") && s.location === "WEBSITE" && !call;
    const fd: ("MESSENGER" | "WHATSAPP")[] = s.destMode === "auto" ? (wa ? ["MESSENGER", "WHATSAPP"] : ["MESSENGER"]) : s.dests;
    return { msg, canC, call, both, np, fd };
  };
  const adsetErr = (s: AdsetDraft) => {
    const f = flagsFor(s);
    return !s.adsetName.trim() || !s.countries.length
      || (objective === "ENGAGEMENT" && s.engLoc === "MESSAGING" && (!f.fd.length || (f.fd.includes("WHATSAPP") && !wa)))
      || ((f.call || f.both) && !s.phone.trim()) || (f.np && !s.pixelId)
      || (s.budgetType === "lifetime" && !s.hasEnd)
      || (budgetLevel === "adset" && (Number(s.amount) || 0) < 1);
  };
  const adErr = (a: AdDraft, s: AdsetDraft) => {
    const f = flagsFor(s);
    const nl = (a.setup !== "post" || !!a.postCta) && !f.msg && !f.call && objective !== "AWARENESS" && !(objective === "ENGAGEMENT" && s.engLoc !== "WEBSITE");
    return !a.adName.trim() || !pageDbId || !accId || (a.setup === "post" && !a.postId) || (nl && !/^https?:\/\//.test(a.link));
  };

  useEffect(() => {
    setPixels(null); setPixelId("");
    if (!needsPixel || !accId || !pageDbId || phase !== "edit") return;
    cached(`pixels:${accId}:${pageDbId}`, () => managedAds<{ pixels: any[] }>({ action: "pixels", pageDbId, adAccountDbId: accId }), force > 0)
      .then((r) => { setPixels(r.pixels); if (r.pixels[0]) setPixelId(r.pixels[0].id); })
      .catch((e) => { setPixels([]); toast.error(e.message); });
  }, [needsPixel, accId, pageDbId, phase, force]);

  useEffect(() => {
    setPageInfo(null);
    if (!accId || !pageDbId || phase !== "edit") return;
    cached<any>(`pageinfo:${accId}:${pageDbId}`, () => managedAds<any>({ action: "page_info", pageDbId, adAccountDbId: accId }), infoTick > 0 || force > 0)
      .then((r) => { setPageInfo(r); if (r.phone) setPhone((p) => p || r.phone); })
      .catch(() => setPageInfo({ whatsappNumber: null, phone: null, picture: null }));
  }, [accId, pageDbId, phase, infoTick, force]);

  const loadPosts = async (fresh = true) => {
    if (!accId || !pageDbId) return;
    setLoadingPosts(true);
    try {
      const r = await cached(`posts:${accId}:${pageDbId}`, () => managedAds<{ posts: any[]; needsAccess?: boolean }>({ action: "posts", pageDbId, adAccountDbId: accId }), fresh);
      setPosts(r.posts); setPostsNeedAccess(!!r.needsAccess);
    } catch (e: any) { setPosts([]); toast.error(e.message); } finally { setLoadingPosts(false); }
  };
  const firstPage = useRef(true);
  useEffect(() => { setPosts(null); if (firstPage.current) { firstPage.current = false; return; } setPostId(""); }, [accId, pageDbId]);
  useEffect(() => { if (level === 2 && setup === "post" && posts === null) loadPosts(false); }, [level, setup, posts]);

  const requestAccess = async () => {
    try {
      await managedAds({ action: "request_page_access", pageDbId, adAccountDbId: accId });
      toast.success("Request পাঠানো হয়েছে — Page-এর admin Facebook-এ accept করলে post দেখা যাবে");
    } catch (e: any) { toast.error(e.message); }
  };

  const searchInterests = async () => {
    if (iq.trim().length < 2 || !pageDbId || !accId) return;
    try {
      const [r, d] = await Promise.all([
        managedAds<{ interests: any[] }>({ action: "interests", pageDbId, adAccountDbId: accId, q: iq.trim() }),
        managedAds<{ items: any[] }>({ action: "demographics", pageDbId, adAccountDbId: accId, q: iq.trim() }).catch(() => ({ items: [] })),
      ]);
      setIResults([...d.items.slice(0, 15), ...r.interests.map((i: any) => ({ ...i, type: "interests" }))]);
    } catch (e: any) { toast.error(e.message); }
  };

  const loadDemo = async () => {
    setDemoOpen(!demoOpen);
    if (demoItems || !pageDbId || !accId) return;
    try { setDemoItems((await managedAds<{ items: any[] }>({ action: "demographics", pageDbId, adAccountDbId: accId })).items); }
    catch (e: any) { setDemoItems([]); toast.error(e.message); }
  };
  const addTarget = (i: any) => { if (!interests.some((x) => x.id === i.id)) setInterests([...interests, { id: i.id, name: i.name, type: i.type } as any]); };

  const onImage = (f?: File) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error("ছবি ৫MB-এর কম হতে হবে");
    const reader = new FileReader();
    reader.onload = () => { const s = String(reader.result); setImage({ b64: s.split(",")[1], url: s }); };
    reader.readAsDataURL(f);
  };
  const [videoPct, setVideoPct] = useState(0);
  const onVideo = async (f?: File) => {
    if (!f) return;
    if (!accId) return toast.error("আগে ad account বাছুন");
    setVideoBusy(true); setVideoPct(0);
    try {
      const v = await uploadToAccount(accId, f, setVideoPct);
      setVideo({ id: v.id, name: f.name, src: URL.createObjectURL(f) });
      toast.success("Video ad account-এর library-তে upload হয়েছে");
    } catch (e: any) { toast.error(e.message || "Video upload হয়নি"); } finally { setVideoBusy(false); }
  };
  const parsePostId = (v: string) => { const m = v.match(/(?:posts|videos|permalink\/|story_fbid=|fbid=)\/?(\d{5,})/); return m ? m[1] : v.trim(); };

  const startEdit = () => {
    if (!pick || pick === "APP") return;
    setObjective(pick);
    const n = OBJECTIVES.find((o) => o.v === pick)!.l;
    setCampaignName(`New ${n} Campaign`);
    const firstAd = mkAd(`New ${n} Ad`);
    if (pick === "ENGAGEMENT") firstAd.setup = engLoc === "ON_AD" ? "post" : "new";
    const first: AdsetDraft = { ...collectAdset([firstAd]), adsetName: `New ${n} Ad Set`, ads: [firstAd] };
    setAdsets([first]);
    loadAdset(first, 0);
    setSelPos({ a: 0, d: 0 });
    setCta(pick === "SALES" ? "SHOP_NOW" : pick === "LEADS" ? "SIGN_UP" : "LEARN_MORE");
    setLevel(0);
    setPhase("edit");
  };

  const needLink = (setup !== "post" || !!postCta) && !isMsg && !callMode && objective !== "AWARENESS" && !(objective === "ENGAGEMENT" && engLoc !== "WEBSITE");
  // validation per level (drives red icons like Facebook)
  const errs = {
    campaign: !campaignName.trim() || (budgetLevel === "campaign" && cAmt < 1) || overWallet,
  };
  const fAll = flushed();
  const ready = !errs.campaign && fAll.every((s) => !adsetErr(s) && s.ads.every((a) => !adErr(a, s)));
  const missing: { go: () => void; t: string }[] = [
    !accId && { go: () => goto(0, 0), t: "Ad account বাছুন" },
    !campaignName.trim() && { go: gotoCampaign, t: "Campaign name লিখুন" },
    budgetLevel === "campaign" && cAmt < 1 && { go: gotoCampaign, t: "Campaign budget কমপক্ষে 1 দিন" },
    overWallet && { go: gotoCampaign, t: "Budget wallet balance-এর বেশি — কমান বা top-up করুন" },
  ].filter(Boolean) as any;
  fAll.forEach((s, i) => {
    const fl = flagsFor(s);
    if (!s.adsetName.trim()) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: নাম লিখুন` });
    if (!s.countries.length) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: কমপক্ষে একটি দেশ (Location) বাছুন` });
    if (fl.np && !s.pixelId) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: Dataset / Pixel বাছুন` });
    if (s.budgetType === "lifetime" && !s.hasEnd) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: Lifetime budget-এর জন্য End date দিন` });
    if (budgetLevel === "adset" && (Number(s.amount) || 0) < 1) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: Budget কমপক্ষে 1 দিন` });
    if (objective === "ENGAGEMENT" && s.engLoc === "MESSAGING" && !fl.fd.length) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: Messenger বা WhatsApp বাছুন` });
    if (objective === "ENGAGEMENT" && s.engLoc === "MESSAGING" && fl.fd.includes("WHATSAPP") && !wa) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: Page-এ WhatsApp number যুক্ত নেই` });
    if ((fl.call || fl.both) && !s.phone.trim()) missing.push({ go: () => goto(i, -1), t: `Ad set ${i + 1}: Phone number লিখুন` });
    s.ads.forEach((a, j) => {
      const nl = (a.setup !== "post" || !!a.postCta) && !fl.msg && !fl.call && objective !== "AWARENESS" && !(objective === "ENGAGEMENT" && s.engLoc !== "WEBSITE");
      if (!a.adName.trim()) missing.push({ go: () => goto(i, j), t: `Ad set ${i + 1} › Ad ${j + 1}: নাম লিখুন` });
      if (a.setup === "post" && !a.postId) missing.push({ go: () => goto(i, j), t: `Ad set ${i + 1} › Ad ${j + 1}: একটি existing post বাছুন` });
      if (nl && !/^https?:\/\//.test(a.link)) missing.push({ go: () => goto(i, j), t: `Ad set ${i + 1} › Ad ${j + 1}: Website URL দিন (https:// দিয়ে শুরু)` });
    });
  });
  if (!pageDbId) missing.push({ go: () => goto(0, 0), t: "Facebook Page বাছুন" });
  const [showMissing, setShowMissing] = useState(false);

  const submit = async (publish: boolean) => {
    if (!accId) return toast.error("Ad account বাছুন");
    if (!pageDbId) return toast.error("Facebook Page বাছুন");
    if (overWallet) return toast.error("Wallet balance-এর বেশি budget দেওয়া যাবে না");
    const f = flushed();
    if (errs.campaign) { gotoCampaign(); return toast.error("Campaign-এর তথ্য সম্পূর্ণ করুন"); }
    for (let i = 0; i < f.length; i++) {
      if (adsetErr(f[i])) { goto(i, -1); return toast.error(`Ad set "${f[i].adsetName}"-এর তথ্য সম্পূর্ণ করুন`); }
      for (let j = 0; j < f[i].ads.length; j++) {
        if (adErr(f[i].ads[j], f[i])) { goto(i, j); return toast.error(`Ad "${f[i].ads[j].adName}"-এর তথ্য সম্পূর্ণ করুন`); }
      }
    }
    setSaving(true);
    try {
      await managedAds({
        action: "create", pageDbId, adAccountDbId: accId, objective,
        campaignName, budgetLevel, specialCategories: special,
        budgetType: cBudgetType, amount: cAmt, bidStrategy: cBidStrategy, bidAmount: cBidAmount ? Number(cBidAmount) : undefined,
        // Legacy single-ad-set fields (first ad set) — the server uses `adsets` when present.
        adsetName: f[0].adsetName, adName: f[0].ads[0].adName,
        countries: f[0].countries, ageMin: Number(f[0].ageMin), ageMax: Number(f[0].ageMax),
        genders: f[0].gender === "male" ? [1] : f[0].gender === "female" ? [2] : [], interests: f[0].interests,
        adsets: f.map((s) => {
          const fl = flagsFor(s);
          return {
            adsetName: s.adsetName, conversionLocation: s.location,
            pixelId: fl.np ? s.pixelId : undefined, customEvent: fl.np ? s.customEvent : undefined,
            startTime: s.startTime ? new Date(s.startTime).toISOString() : undefined,
            endTime: s.hasEnd && s.endTime ? new Date(s.endTime).toISOString() : undefined,
            budgetType: s.budgetType, amount: Number(s.amount) || 0,
            bidStrategy: s.bidStrategy, bidAmount: s.bidAmount ? Number(s.bidAmount) : undefined,
            countries: s.countries, ageMin: Number(s.ageMin), ageMax: Number(s.ageMax),
            genders: s.gender === "male" ? [1] : s.gender === "female" ? [2] : [],
            interests: s.interests, connections: s.connections,
            mainDestination: fl.canC ? s.mainDest : undefined,
            phoneNumber: fl.call || fl.both ? s.phone.trim() : undefined,
            ...(objective === "ENGAGEMENT" ? {
              engagementLocation: s.engLoc, msgDestinations: s.engLoc === "MESSAGING" ? fl.fd : undefined,
              whatsappNumber: wa && /\d{8}/.test(wa.replace(/\D/g, "")) ? wa : undefined,
            } : {}),
            ...(objective === "SALES" && fl.np ? {
              ...salesPayload(s.so, s.budgetType),
              ...(s.so.customConversionId ? { customEvent: undefined } : {}),
              ...(s.so.advantageSales ? { budgetLevel: "campaign" } : {}),
            } : {}),
            ads: s.ads.map((a) => ({
              adName: a.adName,
              existingPostId: a.setup === "post" && a.postId ? parsePostId(a.postId) : undefined,
              message: a.setup === "new" ? a.message : undefined,
              headline: a.setup === "new" ? a.headline : undefined,
              link: a.link || undefined,
              cta: fl.msg || fl.call ? undefined : a.setup === "new" ? a.cta : a.postCta || undefined,
              imageBase64: a.setup === "new" ? a.image?.b64 : undefined,
              videoId: a.setup === "new" && a.video ? a.video.id : undefined,
              ...(objective === "SALES" && fl.np && a.setup === "new" ? {
                format: s.so.useCatalog ? "catalog" : s.so.format,
                cards: s.so.format === "carousel" && !s.so.useCatalog ? s.so.cards.map((c) => ({ imageBase64: c.b64, headline: c.headline || undefined, description: c.description || undefined, link: c.link || undefined })) : undefined,
                description: s.so.description || undefined, displayLink: s.so.displayLink || undefined, urlTags: s.so.urlTags || undefined,
                advantageCreative: s.so.advantageCreative,
                ...(!s.so.useCatalog && s.so.format === "single" ? { messages: [a.message, ...s.so.extraMessages], headlines: [a.headline, ...s.so.extraHeadlines] } : {}),
              } : {}),
            })),
          };
        }),
        publish,
      });
      clearDraft();
      toast.success(publish ? "Ad publish হয়েছে — Facebook review-এর পর চালু হবে" : "Facebook-এ বন্ধ অবস্থায় save হয়েছে");
      onCreated();
    } catch (e: any) { toast.error(e.message, { duration: 12000 }); } finally { setSaving(false); }
  };

  // ================= Phase 1: objective modal =================
  if (phase === "objective") {
    const cur = OBJECTIVES.find((o) => o.v === pick);
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-4 font-[system-ui,-apple-system,'Segoe_UI',Helvetica,Arial,sans-serif] text-fb-text">
        <div className="flex max-h-[100dvh] w-full max-w-[560px] flex-col rounded-t-xl bg-background shadow-2xl sm:max-h-[90vh] sm:rounded-lg">
          <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
            <span className="rounded-md bg-fb-blue-soft px-3 py-2 text-[13px] font-semibold text-fb-blue">Create new campaign</span>
            <span className="hidden px-3 py-2 text-[13px] text-fb-muted sm:inline">New ad set or ad</span>
            <button onClick={onClose} className="ml-auto rounded-full p-1 hover:bg-fb-bg"><X className="h-5 w-5" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pt-3">
            <p className="text-[13px] font-semibold">Choose a buying type <Info className="inline h-3 w-3" /></p>
            <select className={cn(sel, "mt-1")} defaultValue="AUCTION"><option value="AUCTION">Auction</option></select>
          </div>
          <div className="px-4 pt-5">
            <p className="text-[15px] font-semibold">Choose a campaign objective</p>
          </div>
          <div className="grid grid-cols-1 gap-3 px-2 py-2 sm:min-h-[340px] sm:gap-4 sm:py-3 sm:grid-cols-[1fr_1fr]">
            <div className="space-y-1">
              {OBJECTIVES.map((o) => {
                const on = pick === o.v;
                return (
                  <button key={o.v} onClick={() => setPick(o.v)} onMouseEnter={() => !pick && null}
                    className={cn("flex w-full items-center gap-3 rounded-md px-2 py-1 text-left", on ? "bg-fb-blue-soft" : "hover:bg-fb-bg")}>
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border-2", on ? "border-fb-blue" : "border-fb-muted")}>
                      {on && <span className="h-2.5 w-2.5 rounded-full bg-fb-blue" />}
                    </span>
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-md sm:h-10 sm:w-10", on ? "bg-fb-blue text-primary-foreground" : "bg-fb-bg")}>
                      <o.icon className="h-5 w-5" />
                    </span>
                    <span className="text-[14px]">{o.l}</span>
                  </button>
                );
              })}
            </div>
            <div className="px-2">
              {cur ? (
                <div className="space-y-2">
                  <div className="hidden h-24 sm:flex items-center justify-center rounded-lg bg-gradient-to-br from-fb-blue-soft to-fb-green/10"><cur.icon className="h-12 w-12 text-fb-blue" /></div>
                  <p className="text-[15px] font-semibold">{cur.l}</p>
                  <p className="text-[13px] text-fb-muted">{cur.d}</p>
                  <p className="pt-2 text-[13px] font-semibold">Good for:</p>
                  <div className="flex flex-wrap gap-1.5">{cur.good.map((g) => <span key={g} className="rounded bg-fb-bg px-2 py-1 text-[12px]">{g}</span>)}</div>
                  {cur.v === "APP" && <p className="pt-2 text-[12px] text-destructive">App promotion এখনো চালু নেই।</p>}
                </div>
              ) : (
                <div className="hidden space-y-3 pt-6 sm:block">
                  <div className="flex h-24 items-center justify-center rounded-lg bg-fb-blue-soft"><Megaphone className="h-12 w-12 text-fb-blue" /></div>
                  <p className="text-[13px] text-fb-muted">Your campaign objective is the business goal you hope to achieve by running your ads. Hover over each one for more information.</p>
                </div>
              )}
            </div>
          </div>
          </div>
          <div className="flex shrink-0 items-center justify-between border-t border-fb-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <span className="hidden text-[13px] text-fb-blue sm:inline">About campaign objectives</span>
            <div className="ml-auto flex gap-2">
              <button onClick={onClose} className="h-9 rounded-md border border-fb-border px-4 text-[13px] font-semibold hover:bg-fb-bg">Cancel</button>
              <button disabled={!pick || pick === "APP"} onClick={startEdit} className="h-9 rounded-md bg-fb-blue px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-40">Continue</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ================= Phase 2: 3-level editor =================
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const campaignView = (
    <>
      <Section title="Campaign name" ok={!!campaignName.trim()}>
        <input className={inp} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
      </Section>
      <Section title="Campaign details">
        <div><p className="font-semibold">Buying type</p><p className="text-[12px] text-fb-muted">Auction</p></div>
        <div><p className="font-semibold">Campaign objective <Info className="inline h-3 w-3" /></p><p className="text-[12px] text-fb-muted">{label}</p></div>
        {objective === "SALES" && (
          <div className="rounded-md border border-fb-border p-3">
            <p className="font-semibold"><Info className="mr-1 inline h-3.5 w-3.5" />"Shop now" is the default call to action text</p>
            <p className="text-[12px] text-fb-muted">You can still choose "Learn more" or another option in the ad.</p>
          </div>
        )}
        <Field label="Ad account" hint={acc?.kind === "shared" ? "Shared account — খরচ আপনার wallet থেকে কাটা হবে।" : acc ? "আপনার নিজের ad account — wallet লাগবে না।" : "Campaigns পেজের উপর থেকে ad account বাছুন।"}>
          <div className="rounded-md border border-fb-border bg-fb-bg px-3 py-2 text-[13px]">{acc ? `${acc.name} (${String(acc.account_id).replace(/^act_/, "")})` : "কোনো ad account বাছা হয়নি"}</div>
        </Field>
      </Section>
      <Section title="Budget" ok={!errs.campaign} right={budgetLevel === "campaign" ? <Adv /> : null}>
        <button type="button" onClick={() => setBudgetOpen(!budgetOpen)} className="flex w-full items-center justify-between rounded-md bg-fb-blue-soft px-3 py-2 font-semibold">
          Budget strategy <Info className="ml-1 h-3 w-3" />{budgetOpen ? <ChevronUp className="ml-auto h-4 w-4" /> : <ChevronDown className="ml-auto h-4 w-4" />}
        </button>
        {budgetOpen && (
          <div className="rounded-md border border-fb-border p-3">
            <Radio on={budgetLevel === "campaign"} onClick={() => setBudgetLevel("campaign")} title="Campaign budget" desc="Automatically distribute your budget to the best opportunities across your campaign. Also known as Advantage+ campaign budget." />
            <Radio on={budgetLevel === "adset"} onClick={() => setBudgetLevel("adset")} title="Ad set budget" desc="Set different bid strategies or budget schedules for each ad set." />
          </div>
        )}
        {budgetLevel === "campaign" && <BudgetInputs bt={cBudgetType} setBt={setCBudgetType} am={cAmount} setAm={setCAmount} />}
        {budgetLevel === "campaign" && <BidStrategy bs={cBidStrategy} setBs={setCBidStrategy} ba={cBidAmount} setBa={setCBidAmount} />}
        {budgetLevel === "adset" && <p className="text-[12px] text-fb-muted">প্রতিটা ad set-এর budget আলাদা করে সেই ad set-এর ধাপে দেবেন।</p>}
        <WalletNote />
      </Section>
      <Section title="A/B test" right={<span className="flex items-center gap-2 text-fb-muted">Off <Switch disabled /></span>}>
        <p className="text-[12px] text-fb-muted">Compare versions of your ad to see what works best.</p>
      </Section>
      <Section title="Special Ad Categories">
        <p className="text-fb-muted">Declare if your ads are related to financial products and services, employment, housing, social issues, elections or politics to help prevent ad rejections.</p>
        <p className="font-semibold">Categories</p>
        <button type="button" onClick={() => setShowSpecial(!showSpecial)} className={cn(sel, "flex items-center justify-between text-left")}>
          <span className={special.length ? "" : "text-fb-muted"}>{special.length ? special.map((s) => SPECIAL.find((x) => x[0] === s)?.[1]).join(", ") : "Declare category if applicable"}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
        {showSpecial && (
          <div className="rounded-md border border-fb-border p-2">
            {SPECIAL.map(([v, l]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 py-1">
                <input type="checkbox" checked={special.includes(v)} onChange={(e) => setSpecial(e.target.checked ? [...special, v] : special.filter((x) => x !== v))} />{l}
              </label>
            ))}
          </div>
        )}
      </Section>
    </>
  );

  function BudgetInputs({ bt, setBt, am, setAm }: { bt: "daily" | "lifetime"; setBt: (v: "daily" | "lifetime") => void; am: string; setAm: (v: string) => void }) {
    const n = Number(am) || 0;
    return (
      <>
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-fb-border">
          <select className="h-9 border-r border-fb-border bg-background px-3 text-[13px]" value={bt} onChange={(e) => { setBt(e.target.value as any); if (e.target.value === "lifetime") setHasEnd(true); }}>
            <option value="daily">Daily budget</option><option value="lifetime">Lifetime budget</option>
          </select>
          <div className="flex items-center px-3"><span>$</span>
            <input type="number" min={1} step="0.01" className="h-9 w-full bg-background px-1 text-[13px] outline-none" value={am} onChange={(e) => setAm(e.target.value)} />
            <span className="text-fb-muted">USD</span>
          </div>
        </div>
        {bt === "daily" && n > 0 && (
          <p className="text-[12px]">We'll spend around <b>{fmt(n)}</b> per day. Your maximum daily spend is <b>{fmt(n * 1.75)}</b> and your maximum weekly spend is <b>{fmt(n * 7)}</b>.</p>
        )}
        <p className="text-[12px] text-fb-muted">Spending may be higher some days and lower on others.</p>
      </>
    );
  }
  function BidStrategy({ bs, setBs, ba, setBa }: { bs: string; setBs: (v: string) => void; ba: string; setBa: (v: string) => void }) {
    return (
      <div className="border-t border-fb-border pt-3">
        <Field label="Campaign bid strategy">
          <select className={sel} value={bs} onChange={(e) => setBs(e.target.value)}>
            <option value="LOWEST_COST_WITHOUT_CAP">Highest volume or value</option>
            <option value="COST_CAP">Cost per result goal</option>
            <option value="LOWEST_COST_WITH_BID_CAP">Bid cap</option>
            {objective === "SALES" && <option value="LOWEST_COST_WITH_MIN_ROAS">ROAS goal</option>}
          </select>
        </Field>
        {bs !== "LOWEST_COST_WITHOUT_CAP" && (
          <div className="mt-2"><Field label={bs === "COST_CAP" ? "Cost per result goal ($)" : bs === "LOWEST_COST_WITH_MIN_ROAS" ? "ROAS goal (যেমন 2.0)" : "Bid cap ($)"}><input type="number" className={inp} value={ba} onChange={(e) => setBa(e.target.value)} /></Field></div>
        )}
      </div>
    );
  }
  function WalletNote() {
    if (acc?.kind !== "shared") return null;
    return <p className={cn("text-[12px]", overWallet ? "text-destructive" : "text-fb-muted")}>Available balance: {fmt(walletBalance)}{overWallet && " — মোট budget balance-এর বেশি"}</p>;
  }

  const addCountry = () => {
    const c = cq.trim().toUpperCase();
    if (c.length === 2 && !countries.includes(c)) setCountries([...countries, c]);
    setCq("");
  };

  const adsetView = (
    <>
      <Section title="Ad set name" ok={!!adsetName.trim()}>
        <input className={inp} value={adsetName} onChange={(e) => setAdsetName(e.target.value)} />
      </Section>
      {(objective === "SALES" || objective === "LEADS") && (
        <Section title="Conversion" ok={!needsPixel || !!pixelId}>
          <Field label="Conversion location">
            <select className={sel} value={location === "WEBSITE" && mainDest === "CALL" ? "CALLS" : location === "WEBSITE" && mainDest === "BOTH" ? "BOTH" : location} onChange={(e) => {
              const v = e.target.value;
              if (v === "CALLS") { setLocation("WEBSITE" as any); setMainDest("CALL"); }
              else if (v === "BOTH") { setLocation("WEBSITE" as any); setMainDest("BOTH"); }
              else { setLocation(v as any); setMainDest("WEBSITE"); }
            }}>
              <option value="WEBSITE">Website</option>
              <option value="BOTH">Website and calls</option>
              <option value="CALLS">Calls</option>
              <option value="MESSAGING">Message destinations (Messenger)</option>
            </select>
          </Field>
{!(objective === "SALES" && needsPixel) && (
          <Field label="Performance goal" hint="Set your goal, such as maximizing conversions or conversion value.">
            <select className={sel} disabled><option>{isMsg ? "Maximize number of conversations" : "Maximize number of conversions"}</option></select>
          </Field>)}
          {needsPixel && (
            <>
              <Field label="Dataset" req hint="Track actions that people take on your website.">
                <select className={cn(sel, !pixelId && pixels && "border-destructive")} value={pixelId} onChange={(e) => setPixelId(e.target.value)}>
                  {pixels === null && <option value="">লোড হচ্ছে…</option>}
                  {pixels?.length === 0 && <option value="">কোনো Dataset নেই</option>}
                  {(pixels ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {pixels?.length === 0 && (
                  <p className="mt-1 text-[12px] text-destructive">
                    {acc?.kind === "shared"
                      ? "এই ad account-এ কোনো Pixel/Dataset নেই — admin-কে বলুন।"
                      : "এই ad account-এ কোনো Pixel/Dataset নেই। Meta Events Manager (business.facebook.com/events_manager) থেকে এই account-এর জন্য একটি Dataset বানান, তারপর এখানে ফিরে এসে আবার চেষ্টা করুন।"}
                  </p>
                )}
              </Field>
              <Field label="Conversion event" req hint="The action you want people to take when they see your ads.">
                <select className={sel} value={customEvent} onChange={(e) => setCustomEvent(e.target.value)}>
                  {EVENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            </>
          )}
        </Section>
      )}
      {objective === "SALES" && needsPixel && (
        <SalesAdsetOptions o={so} set={setSo} pageDbId={pageDbId} accId={accId} pixelId={pixelId} budgetType={budgetType} />
      )}
      {objective === "ENGAGEMENT" && (
        <Section title="Conversion" ok={countries.length > 0}>
          <Field label="Conversion location">
            <div className="space-y-0.5 rounded-md border border-fb-border p-2">
              {([
                ["MESSAGING", "Message destinations", "Get people to engage with your brand on Messenger or WhatsApp."],
                ["ON_AD", "On your ad", "Get people to interact with your post or event, or to watch a video."],
                ["CALLS", "Calls", "Get people to call your business."],
                ["WEBSITE", "Website", "Get people to engage with your website."],
                ["PAGE_LIKES", "Facebook Page (likes)", "Get people to like your Facebook Page."],
                ["EVENT", "Event responses", "Get people to respond to your Facebook event."],
              ] as const).map(([v, t, d]) => (
                <Radio key={v} on={engLoc === v} title={t} desc={d} onClick={() => { setEngLoc(v); setSetup(v === "ON_AD" || v === "EVENT" ? "post" : "new"); }} />
              ))}
            </div>
          </Field>
          {engLoc === "MESSAGING" && (
            <>
              <div className="border-t border-fb-border pt-3">
                <p className="font-semibold">Facebook Page <span className="font-normal text-fb-muted">• This page will represent your business in your ad and conversation.</span></p>
                <div className="mt-2 flex items-center gap-2">
                  {pageInfo?.picture ? <img src={pageInfo.picture} alt="" className="h-9 w-9 rounded-full" /> : <div className="h-9 w-9 shrink-0 rounded-full bg-fb-blue-soft" />}
                  <select className={cn(sel, !pageDbId && "border-destructive")} value={pageDbId} onChange={(e) => setPageDbId(e.target.value)}>
                    <option value="">Select Page</option>
                    {pages.map((p) => <option key={p.id} value={p.id}>{p.page_name}</option>)}
                  </select>
                </div>
                {!pages.length && <p className="mt-1 text-[12px] text-destructive">কোনো page নেই — Campaigns পাতার উপরে "Connect Facebook" চাপুন।</p>}
              </div>
              <div className="rounded-md bg-fb-bg p-3">
                <p className="mb-1 font-semibold">Message destinations</p>
                <Radio on={destMode === "auto"} title="Automatic destination (recommended)" desc="We'll send people to the messaging app where they engage most and lower ad costs." onClick={() => setDestMode("auto")} />
                <Radio on={destMode === "manual"} title="Manual destination" desc="We'll only send people to the messaging apps you choose." onClick={() => setDestMode("manual")} />
                {destMode === "auto" && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                    <span className="rounded bg-background px-2 py-1">Messenger · {page?.page_name}</span>
                    {wa && <span className="rounded bg-background px-2 py-1">WhatsApp · {wa}</span>}
                  </div>
                )}
                {destMode === "manual" && (
                  <div className="mt-2 space-y-2 rounded-md bg-background p-2">
                    <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-fb-blue" checked={dests.includes("MESSENGER")} onChange={(e) => setDests((d) => e.target.checked ? [...d.filter((x) => x !== "MESSENGER"), "MESSENGER"] : d.filter((x) => x !== "MESSENGER"))} />
                      <span><b>Messenger</b><span className="block text-[12px] text-fb-muted">{page?.page_name}</span></span></label>
                    <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-fb-blue" disabled={!wa} checked={dests.includes("WHATSAPP")} onChange={(e) => setDests((d) => e.target.checked ? [...d.filter((x) => x !== "WHATSAPP"), "WHATSAPP"] : d.filter((x) => x !== "WHATSAPP"))} />
                      <span className="flex-1"><b>WhatsApp</b><span className="block text-[12px] text-fb-muted">{wa ?? "এই Page-এ WhatsApp connect করা নেই"}</span></span>
                      {!wa && pageInfo && <a href={waConnectUrl} target="_blank" rel="noreferrer" className="rounded-md border border-fb-border px-3 py-1 text-[12px] font-semibold">Connect WhatsApp</a>}
                    </label>
                    {!finalDests.length && <p className="text-[12px] text-destructive">অন্তত একটা বাছুন</p>}
                  </div>
                )}
                {!pageInfo && <p className="mt-2 flex items-center gap-1 text-[12px] text-fb-muted"><Loader2 className="h-3 w-3 animate-spin" />WhatsApp খোঁজা হচ্ছে…</p>}
                {pageInfo && !pageInfo.whatsappNumber && (
                  <div className="mt-2 rounded-md border border-fb-border bg-background p-2 text-[12px]">
                    <p>Facebook থেকে WhatsApp নম্বর আসেনি। Page-এ আগেই WhatsApp যুক্ত থাকলে নিচে সেই নম্বরটা লিখে দিন (দেশের কোডসহ, যেমন +8801XXXXXXXXX)।</p>
                    <input value={waManual} onChange={(e) => setWaManual(e.target.value)} placeholder="+8801XXXXXXXXX" className="mt-1 w-full rounded-md border border-fb-border bg-background px-2 py-1.5 text-[13px]" />
                    <p className="mt-2">নম্বর যুক্ত না থাকলে: <b>Connect WhatsApp</b> চাপুন → নম্বর দিন → WhatsApp-এ আসা code দিন → এখানে <b>আবার চেক করুন</b>।</p>
                    {pageInfo.pageTokenMissing && <p className="mt-1 font-semibold text-destructive">এই Page-এর Facebook login এখনো CRM-এ save হয়নি। তাই WhatsApp নম্বর পড়া যাচ্ছে না। Campaigns পাতার উপরে "Facebook আবার connect" চেপে login করুন (Page-টা টিক দিয়ে), তারপর "আবার চেক করুন" চাপুন।</p>}
                    <div className="mt-2 flex gap-2">
                      <a href={waConnectUrl} target="_blank" rel="noreferrer" className="rounded-md bg-fb-blue px-3 py-1 font-semibold text-primary-foreground">Connect WhatsApp</a>
                      <button type="button" onClick={() => setInfoTick((t) => t + 1)} className="rounded-md border border-fb-border px-3 py-1 font-semibold">আবার চেক করুন</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
          {engLoc === "CALLS" && (
            <Field label="Phone number" req hint="যে নম্বরে মানুষ call করবে (দেশের কোড সহ, যেমন +8801...)">
              <input className={inp} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8801XXXXXXXXX" />
            </Field>
          )}
          <Field label="Performance goal" hint="How you measure success for your ads.">
            <select className={sel} disabled><option>{engLoc === "MESSAGING" ? "Maximize number of conversations" : engLoc === "ON_AD" ? "Maximize engagement with a post" : engLoc === "CALLS" ? "Maximize number of calls" : engLoc === "PAGE_LIKES" ? "Maximize Page likes" : engLoc === "EVENT" ? "Maximize event responses" : "Maximize number of link clicks"}</option></select>
          </Field>
        </Section>
      )}
      <Section title="Budget & schedule" ok={budgetType !== "lifetime" || hasEnd}>
        {budgetLevel === "campaign" ? (
          <div><p className="font-semibold">Budget strategy</p><p className="text-[12px] text-fb-muted">Your campaign budget automatically distributes your {cBudgetType} budget of {fmt(cAmt)} across ad sets to get the best performance.</p></div>
        ) : (<><BudgetInputs bt={budgetType} setBt={setBudgetType} am={amount} setAm={setAmount} /><BidStrategy bs={bidStrategy} setBs={setBidStrategy} ba={bidAmount} setBa={setBidAmount} /><WalletNote /></>)}
        <p className="pt-2 font-semibold">Schedule</p>
        <Field label="Start date"><input type="datetime-local" className={inp} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={hasEnd} disabled={budgetType === "lifetime"} onChange={(e) => setHasEnd(e.target.checked)} />Set an end date</label>
        {hasEnd && <Field label="End date"><input type="datetime-local" className={inp} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>}
      </Section>
      <Section title="Audience" ok={countries.length > 0} right={<Adv />}>
        <p className="text-fb-muted">Set up your audience using controls and suggestions.</p>
        <Field label="Locations">
          <div className="flex flex-wrap gap-1.5 rounded-md border border-fb-border p-2">
            {countries.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded bg-fb-blue-soft px-2 py-0.5 text-[12px] text-fb-blue">{c}<X className="h-3 w-3 cursor-pointer" onClick={() => setCountries(countries.filter((x) => x !== c))} /></span>
            ))}
            <input className="min-w-[120px] flex-1 bg-background text-[13px] outline-none" placeholder="দেশের কোড (যেমন BD) লিখে Enter" value={cq} maxLength={2}
              onChange={(e) => setCq(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCountry()} />
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field label="Minimum age"><select className={sel} value={ageMin} onChange={(e) => setAgeMin(e.target.value)}>{Array.from({ length: 48 }, (_, i) => 18 + i).map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Field label="Maximum age"><select className={sel} value={ageMax} onChange={(e) => setAgeMax(e.target.value)}>{Array.from({ length: 48 }, (_, i) => 18 + i).map((n) => <option key={n} value={n}>{n === 65 ? "65+" : n}</option>)}</select></Field>
          <Field label="Gender"><select className={sel} value={gender} onChange={(e) => setGender(e.target.value)}><option value="all">All genders</option><option value="male">Men</option><option value="female">Women</option></select></Field>
          <Field label="Connections" hint="যারা আপনার Page লাইক করেছে তাদের নিয়ে">
            <select className={sel} value={connections} onChange={(e) => setConnections(e.target.value as any)}>
              <option value="all">সবাই</option>
              <option value="include">শুধু যারা Page লাইক করেছে</option>
              <option value="exclude">যারা Page লাইক করেছে তাদের বাদ দিন</option>
            </select>
          </Field>
        </div>
        <Field label="Detailed targeting" hint="Include people who match interests.">
          <div className="flex gap-2">
            <input className={inp} value={iq} onChange={(e) => setIq(e.target.value)} placeholder="Add demographics, interests or behaviors" onKeyDown={(e) => e.key === "Enter" && searchInterests()} />
            <button onClick={searchInterests} className="h-9 rounded-md border border-fb-border px-3 font-semibold hover:bg-fb-bg">Search</button>
            <button onClick={loadDemo} className="h-9 rounded-md border border-fb-border px-3 font-semibold hover:bg-fb-bg">Browse</button>
          </div>
          {demoOpen && (
            <div className="mt-2 max-h-56 overflow-auto rounded-md border border-fb-border">
              {demoItems === null && <p className="flex items-center gap-1 p-2 text-fb-muted"><Loader2 className="h-3 w-3 animate-spin" />লোড হচ্ছে…</p>}
              {demoItems?.length === 0 && <p className="p-2 text-fb-muted">কিছু পাওয়া যায়নি</p>}
              {(demoItems ?? []).map((i) => (
                <button key={`${i.type}-${i.id}`} className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-fb-bg" onClick={() => addTarget(i)}>
                  <span><span className="block">{i.name}</span><span className="block text-[11px] text-fb-muted">{i.path || i.type}</span></span>
                  {i.audience && <span className="shrink-0 text-[12px] text-fb-muted">{Number(i.audience).toLocaleString()}</span>}
                </button>
              ))}
            </div>
          )}
          {iResults.length > 0 && (
            <div className="mt-2 max-h-44 overflow-auto rounded-md border border-fb-border">
              {iResults.map((i) => (
                <button key={i.id} className="flex w-full justify-between px-3 py-1.5 hover:bg-fb-bg"
                  onClick={() => addTarget(i)}>
                  <span>{i.name}{i.type && i.type !== "interests" && <span className="ml-1 text-[11px] text-fb-muted">({i.path || i.type})</span>}</span>{i.audience && <span className="text-[12px] text-fb-muted">{Number(i.audience).toLocaleString()}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {interests.map((i) => <span key={i.id} className="inline-flex items-center gap-1 rounded bg-fb-bg px-2 py-0.5 text-[12px]">{i.name}<X className="h-3 w-3 cursor-pointer" onClick={() => setInterests(interests.filter((x) => x.id !== i.id))} /></span>)}
          </div>
        </Field>
      </Section>
      <Section title="Placements" right={placements === "auto" ? <Adv /> : null}>
        <Radio on={placements === "auto"} onClick={() => setPlacements("auto")} title="Advantage+ placements (recommended)" desc="Use Advantage+ placements to maximize your budget and help show your ads to more people." />
        <Radio on={placements === "manual"} onClick={() => setPlacements("auto")} disabled title="Manual placements" desc="শীঘ্রই আসছে" />
      </Section>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addAdset} className="inline-flex h-9 items-center gap-1 rounded-md border border-fb-border bg-background px-3 text-[13px] font-semibold text-fb-blue hover:bg-fb-bg"><Plus className="h-4 w-4" />আরেকটা Ad set যোগ করুন</button>
        {adsets.length > 1 && (
          <button type="button" onClick={() => removeAdset(selPos.a)} className="inline-flex h-9 items-center gap-1 rounded-md border border-destructive/40 bg-background px-3 text-[13px] font-semibold text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" />এই Ad set মুছুন</button>
        )}
      </div>
    </>
  );

  const adView = (
    <>
      <Section title="Ad name" ok={!!adName.trim()}>
        <input className={inp} value={adName} onChange={(e) => setAdName(e.target.value)} />
      </Section>
      <Section title="Identity" ok={!!pageDbId}>
        <p className="text-fb-muted">The profiles and branding that will be used in your ad.</p>
        <Field label="Facebook Page" req>
          <select className={cn(sel, !pageDbId && "border-destructive")} value={pageDbId} onChange={(e) => setPageDbId(e.target.value)}>
            <option value="">Select Page</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.page_name}</option>)}
          </select>
          {!pages.length && <p className="mt-1 text-[12px] text-destructive">কোনো page নেই — আগে "My Pages" থেকে page যুক্ত করুন।</p>}
        </Field>
      </Section>
      <Section title="Ad setup" ok={setup === "post" ? !!postId : true}>
        <select className={sel} value={setup} onChange={(e) => setSetup(e.target.value as any)}>
          <option value="new" disabled={objective === "ENGAGEMENT"}>Create ad</option>
          <option value="post">Use existing post</option>
        </select>
        {setup === "new" ? (
          <>
            <p className="font-semibold">Creative source</p>
            <Radio on onClick={() => {}} title="Manual upload" />
            <p className="font-semibold">Format</p>
            <Radio on onClick={() => {}} title="Single image or video" />
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{page?.page_name ?? "Page"} — posts</p>
              <button className="text-fb-blue" disabled={loadingPosts} onClick={() => loadPosts(true)}>{loadingPosts ? "Loading…" : "Refresh"}</button>
            </div>
            {postsNeedAccess && (
              <div className="space-y-2 rounded-md border border-destructive/50 p-3">
                <p>এই Page-এর post পড়ার অনুমতি পাওয়া যায়নি। Campaigns পাতার উপরে <b>"Facebook আবার connect"</b> চেপে login করুন এবং এই Page-টা টিক দিয়ে রাখুন — তারপর এখানে Refresh চাপুন।</p>
                <button onClick={requestAccess} className="h-8 rounded-md border border-fb-border px-3 font-semibold">অথবা Business Manager-কে access request পাঠান</button>
              </div>
            )}
            {posts && posts.length > 0 && (
              <div className="grid max-h-80 gap-2 overflow-auto sm:grid-cols-2">
                {posts.map((p) => (
                  <button key={p.id} type="button" onClick={() => setPostId(p.id)}
                    className={cn("relative flex gap-2 rounded-md border p-2 text-left text-[12px]", postId === p.id ? "border-fb-blue bg-fb-blue-soft" : "border-fb-border hover:bg-fb-bg")}>
                    {p.picture ? <img src={p.picture} alt="" className="h-14 w-14 shrink-0 rounded object-cover" /> : <div className="h-14 w-14 shrink-0 rounded bg-fb-bg" />}
                    <span className="line-clamp-3">{p.message || "(no text)"}</span>
                    {postId === p.id && <Check className="absolute right-1 top-1 h-4 w-4 text-fb-blue" />}
                  </button>
                ))}
              </div>
            )}
            {posts && posts.length === 0 && !postsNeedAccess && <p className="text-fb-muted">কোনো post পাওয়া যায়নি।</p>}
            <input className={inp} value={postId} onChange={(e) => setPostId(e.target.value)} placeholder="অথবা Post ID / link লিখুন" />
          </div>
        )}
      </Section>
      {!isMsg && objective !== "AWARENESS" && (objective !== "ENGAGEMENT" || engLoc === "WEBSITE") && (
        <Section title="Destination" ok={callMode ? !!phone.trim() : bothMode ? !!phone.trim() && /^https?:\/\//.test(link) : !needLink || /^https?:\/\//.test(link)}>
          <Field label="Main destination">
            <select className={sel} value={canCall ? mainDest : "WEBSITE"} disabled={!canCall} onChange={(e) => setMainDest(e.target.value as any)}>
              <option value="WEBSITE">Website</option>
              {canCall && (objective === "SALES" || objective === "LEADS") && <option value="BOTH">Website and calls</option>}
              {canCall && <option value="CALL">Calls</option>}
            </select>
          </Field>
          {callMode ? (
            <Field label="Phone number" req hint="Ad-এ চাপলে মানুষ এই নম্বরে call করবে।">
              <input className={cn(inp, !phone.trim() && "border-destructive")} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8801XXXXXXXXX" />
            </Field>
          ) : (
            <Field label="Website URL" req={needLink}>
              <input className={cn(inp, needLink && !/^https?:\/\//.test(link) && "border-destructive")} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Enter the URL people visit after your ad" />
            </Field>
          )}
          {bothMode && (
            <Field label="Call now" req hint="Website-এ ঢোকার পরও মানুষ এই নম্বরে Call now চেপে call করতে পারবে।">
              <input className={cn(inp, !phone.trim() && "border-destructive")} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8809647222999" />
            </Field>
          )}
          {setup === "post" && !callMode && (
            <Field label="Call to action" hint="Existing post-এ বাটন (যেমন Order Now) লাগাতে চাইলে বাছুন — তখন Website URL দিতে হবে।">
              <select className={sel} value={postCta} onChange={(e) => setPostCta(e.target.value)}>
                <option value="">Post যেমন আছে (বাটন ছাড়া)</option>
                {CTAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          )}
        </Section>
      )}
      {isMsg && (
        <Section title="Destination" ok={finalDests.length > 0}>
          <p className="text-fb-muted">মানুষ ad-এ চাপলে কোথায় message করবে।</p>
          {(["MESSENGER", "WHATSAPP"] as const).map((d) => {
            const on = finalDests.includes(d); const off = d === "WHATSAPP" && !wa;
            return (
              <label key={d} className={cn("flex items-center gap-2 rounded-md border p-2", on ? "border-fb-blue bg-fb-blue-soft" : "border-fb-border", off && "opacity-50")}>
                <input type="checkbox" className="h-4 w-4 accent-fb-blue" disabled={off || objective !== "ENGAGEMENT"} checked={on}
                  onChange={(e) => { setDestMode("manual"); setDests((x) => e.target.checked ? [...x.filter((y) => y !== d), d] : x.filter((y) => y !== d)); }} />
                <span><b>{d === "MESSENGER" ? "Messenger" : "WhatsApp"}</b><span className="block text-[12px] text-fb-muted">{d === "MESSENGER" ? page?.page_name : wa ?? "Page-এ WhatsApp connect করা নেই"}</span></span>
              </label>
            );
          })}
        </Section>
      )}
      {objective === "ENGAGEMENT" && engLoc === "CALLS" && (
        <Section title="Destination" ok={!!phone.trim()}>
          <Field label="Phone number" req><input className={inp} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+8801XXXXXXXXX" /></Field>
        </Section>
      )}
      {setup === "new" && (
        <Section title="Ad creative" ok>
          <p className="text-fb-muted">Select and optimize your ad text, media and enhancements.</p>
          <Field label="Media">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-fb-border px-3 font-semibold hover:bg-fb-bg">
              <ImagePlus className="h-4 w-4" />{image ? "Change image" : "Set up creative"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onImage(e.target.files?.[0])} />
            </label>
            <label className="ml-2 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-fb-border px-3 font-semibold hover:bg-fb-bg">
              {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{videoBusy ? `Uploading ${videoPct}%` : video ? "Change video" : "Upload video"}
              <input type="file" accept="video/*" className="hidden" disabled={videoBusy} onChange={(e) => onVideo(e.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => setLibOpen(true)} className="ml-2 inline-flex h-9 items-center gap-2 rounded-md border border-fb-border px-3 font-semibold hover:bg-fb-bg">
              <Folder className="h-4 w-4" />Video library
            </button>
            {video && <p className="mt-1 text-[12px] text-fb-green">🎬 {video.name} — <button type="button" className="text-fb-muted underline" onClick={() => setVideo(null)}>বাদ দিন</button></p>}
          </Field>
          <VideoLibrary open={libOpen} onClose={() => setLibOpen(false)} accId={accId || undefined} selected={video?.id} onPick={(v) => setVideo({ id: v.id, name: v.title, picture: v.picture, src: v.source })} />
          <Field label="Primary text"><textarea rows={4} className="w-full rounded-md border border-fb-border bg-background p-2 text-[13px]" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell people what your ad is about" /></Field>
          <Field label="Headline"><input className={inp} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Write a short headline" /></Field>
          {!isMsg && (
            <Field label="Call to action">
              <select className={sel} value={cta} onChange={(e) => setCta(e.target.value)}>{CTAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
          )}
        </Section>
      )}
      {objective === "SALES" && needsPixel && setup === "new" && <SalesAdOptions o={so} set={setSo} />}
      {needsPixel && (
        <Section title="Tracking">
          <p className="text-fb-muted">This ad account's selected conversion dataset will be tracked by default.</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked readOnly />Website events</label>
          <div className="rounded-md border border-fb-border p-2 text-[12px]">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-fb-green" />{pixels?.find((p) => p.id === pixelId)?.name ?? "—"}
            <p className="text-fb-muted">Pixel ID: {pixelId || "—"}</p>
          </div>
        </Section>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addAd} className="inline-flex h-9 items-center gap-1 rounded-md border border-fb-border bg-background px-3 text-[13px] font-semibold text-fb-blue hover:bg-fb-bg"><Plus className="h-4 w-4" />এই Ad set-এ আরেকটা Ad যোগ করুন</button>
        {(adsets[selPos.a]?.ads.length ?? 1) > 1 && (
          <button type="button" onClick={() => removeAd(selPos.d)} className="inline-flex h-9 items-center gap-1 rounded-md border border-destructive/40 bg-background px-3 text-[13px] font-semibold text-destructive hover:bg-destructive/10"><Trash2 className="h-4 w-4" />এই Ad মুছুন</button>
        )}
      </div>
    </>
  );

  const preview = (() => {
    const sp = setup === "post" ? posts?.find((p) => p.id === postId) : null;
    const text = setup === "post" ? sp?.message : message;
    const img = setup === "post" ? sp?.picture : image?.url;
    const ctaLabel = isMsg ? (finalDests.length === 1 && finalDests[0] === "WHATSAPP" ? "Send WhatsApp message" : "Send message") : callMode ? "Call now" : setup === "post" && postCta ? CTAS.find((c) => c[0] === postCta)?.[1] ?? "Learn more" : CTAS.find((c) => c[0] === cta)?.[1] ?? "Learn more";
    return (
      <PlacementPreview d={{
        pageName: page?.page_name ?? "Your Page",
        avatar: pageInfo?.picture,
        text,
        img,
        video: setup === "new" ? video : null,
        domain: isMsg ? (finalDests.includes("WHATSAPP") && finalDests.length === 1 ? "WhatsApp" : "Messenger") : link ? link.replace(/^https?:\/\//, "").split("/")[0] : "website.com",
        headline: setup === "new" ? (headline || "Headline") : (page?.page_name ?? ""),
        cta: ctaLabel,
        showCta: setup === "new" || isMsg || callMode || (setup === "post" && !!postCta) || (objective === "ENGAGEMENT" && engLoc !== "ON_AD"),
      }} />
    );
  })();

  const reviewView = (
    <Section title="Review">
      {[
        ["Campaign", `${campaignName} · ${label}`],
        ["Budget", budgetLevel === "campaign" ? `${fmt(cAmt)} ${cBudgetType} · Campaign budget` : `প্রতিটা ad set-এর নিজের budget`],
        ["Ad account", acc ? `${acc.name} (${acc.account_id})` : "—"],
      ].map((r) => (
        <div key={r[0]} className="flex justify-between gap-3 border-b border-fb-border pb-2"><span className="font-semibold">{r[0]}</span><span className="text-right text-fb-muted">{r[1]}</span></div>
      ))}
      {fAll.map((s, i) => {
        const fl = flagsFor(s);
        return (
          <div key={i} className="border-b border-fb-border pb-2 last:border-0">
            <p className="font-semibold">Ad set {i + 1}: {s.adsetName}</p>
            <p className="text-fb-muted">
              {s.countries.join(", ")} · Age {s.ageMin}-{s.ageMax}
              {budgetLevel === "adset" ? ` · ${fmt(Number(s.amount) || 0)} ${s.budgetType}` : ""}
              {fl.np ? ` · ${pixels?.find((p) => p.id === s.pixelId)?.name ?? "Dataset"} · ${s.customEvent}` : ""}
            </p>
            {s.ads.map((a, j) => (
              <p key={j} className="text-fb-muted">• {a.adName} · {page?.page_name ?? "No page"} · {a.setup === "post" ? "Existing post" : "New creative"}</p>
            ))}
          </div>
        );
      })}
    </Section>
  );

  const curAdset = fAll[selPos.a];
  const curAd = curAdset?.ads[selPos.d];

  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] bg-fb-bg font-[system-ui,-apple-system,'Segoe_UI',Helvetica,Arial,sans-serif] text-fb-text">
      {/* Left tree */}
      <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-fb-border bg-background md:block">
        <div className="flex h-12 items-center border-b border-fb-border px-2">
          <button onClick={askClose} className="rounded-md p-2 hover:bg-fb-bg"><X className="h-5 w-5" /></button>
        </div>
        <button onClick={gotoCampaign}
          className={cn("flex w-full items-center gap-2 py-2.5 pl-3 pr-3 text-left text-[13px]", level === 0 ? "bg-fb-blue-soft font-semibold" : "hover:bg-fb-bg")}>
          <Folder className={cn("h-4 w-4 shrink-0", level === 0 ? "text-fb-blue" : "text-fb-muted")} />
          <span className="truncate">{campaignName || "Campaign"}</span>
          {errs.campaign ? <AlertCircle className="ml-auto h-4 w-4 shrink-0 text-destructive" /> : <MoreHorizontal className="ml-auto h-4 w-4 shrink-0 text-fb-muted" />}
        </button>
        {fAll.map((s, i) => (
          <div key={i}>
            <button onClick={() => goto(i, -1)}
              className={cn("flex w-full items-center gap-2 py-2.5 pl-7 pr-3 text-left text-[13px]", level === 1 && selPos.a === i ? "bg-fb-blue-soft font-semibold" : "hover:bg-fb-bg")}>
              <LayoutGrid className={cn("h-4 w-4 shrink-0", level === 1 && selPos.a === i ? "text-fb-blue" : "text-fb-muted")} />
              <span className="truncate">{s.adsetName || `Ad set ${i + 1}`}</span>
              {adsetErr(s) ? <AlertCircle className="ml-auto h-4 w-4 shrink-0 text-destructive" /> : <MoreHorizontal className="ml-auto h-4 w-4 shrink-0 text-fb-muted" />}
            </button>
            {s.ads.map((a, j) => (
              <button key={j} onClick={() => goto(i, j)}
                className={cn("flex w-full items-center gap-2 py-2.5 pl-11 pr-3 text-left text-[13px]", level === 2 && selPos.a === i && selPos.d === j ? "bg-fb-blue-soft font-semibold" : "hover:bg-fb-bg")}>
                <FileText className={cn("h-4 w-4 shrink-0", level === 2 && selPos.a === i && selPos.d === j ? "text-fb-blue" : "text-fb-muted")} />
                <span className="truncate">{a.adName || `Ad ${j + 1}`}</span>
                {adErr(a, s) ? <AlertCircle className="ml-auto h-4 w-4 shrink-0 text-destructive" /> : <MoreHorizontal className="ml-auto h-4 w-4 shrink-0 text-fb-muted" />}
              </button>
            ))}
          </div>
        ))}
        <button onClick={addAdset} className="flex w-full items-center gap-2 py-2.5 pl-7 pr-3 text-left text-[13px] font-semibold text-fb-blue hover:bg-fb-bg">
          <Plus className="h-4 w-4 shrink-0" />Ad set যোগ করুন
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 items-center gap-1 overflow-x-auto border-b border-fb-border bg-background px-2 text-[13px] sm:gap-2 sm:px-3">
          <button onClick={askClose} className="shrink-0 rounded-md p-1.5 hover:bg-fb-bg md:hidden"><X className="h-5 w-5" /></button>
          <span className="flex min-w-0 shrink-0 items-center gap-1">
            <button onClick={gotoCampaign} className={cn("flex min-w-0 items-center gap-1 rounded px-1.5 py-1", level === 0 ? "bg-fb-blue-soft text-fb-blue" : "text-fb-muted hover:bg-fb-bg")}>
              <Folder className="h-3.5 w-3.5 shrink-0" /><span className="max-w-[90px] truncate sm:max-w-[140px]">{campaignName || "Campaign"}</span>
            </button>
            <span className="text-fb-muted">›</span>
            <button onClick={() => goto(selPos.a, -1)} className={cn("flex min-w-0 items-center gap-1 rounded px-1.5 py-1", level === 1 ? "bg-fb-blue-soft text-fb-blue" : "text-fb-muted hover:bg-fb-bg")}>
              <LayoutGrid className="h-3.5 w-3.5 shrink-0" /><span className="max-w-[90px] truncate sm:max-w-[140px]">{curAdset?.adsetName || "Ad set"}{fAll.length > 1 ? ` (${selPos.a + 1}/${fAll.length})` : ""}</span>
            </button>
            <span className="text-fb-muted">›</span>
            <button onClick={() => goto(selPos.a, selPos.d)} className={cn("flex min-w-0 items-center gap-1 rounded px-1.5 py-1", level === 2 ? "bg-fb-blue-soft text-fb-blue" : "text-fb-muted hover:bg-fb-bg")}>
              <FileText className="h-3.5 w-3.5 shrink-0" /><span className="max-w-[90px] truncate sm:max-w-[140px]">{curAd?.adName || "Ad"}{(curAdset?.ads.length ?? 1) > 1 ? ` (${selPos.d + 1}/${curAdset?.ads.length})` : ""}</span>
            </button>
          </span>
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 text-fb-muted sm:flex"><span className="h-2.5 w-2.5 rounded-full border border-fb-muted" />In draft</span>
        </header>
        <div className="flex justify-center gap-2 border-b border-fb-border bg-background py-1.5">
          <button onClick={() => setTab("edit")} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold", tab === "edit" ? "bg-fb-blue-soft text-fb-blue" : "text-fb-text")}><Pencil className="h-3.5 w-3.5" />Edit</button>
          <button onClick={() => setTab("review")} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold", tab === "review" ? "bg-fb-blue-soft text-fb-blue" : "text-fb-text")}><Eye className="h-3.5 w-3.5" />Review</button>
        </div>
        {/* Mobile step indicator */}
        <div className="flex gap-1 bg-background px-3 pb-2 pt-1 md:hidden">
          {[0, 1, 2].map((i) => <div key={i} className={cn("h-1 flex-1 rounded-full", i <= level ? "bg-fb-blue" : "bg-fb-border")} />)}
        </div>

        {/* Body */}
        <main className="wizard-bg flex-1 overflow-auto overscroll-contain">
          <div className="mx-auto grid max-w-[1500px] gap-4 p-2 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="min-w-0 space-y-3">{tab === "review" ? reviewView : level === 0 ? campaignView : level === 1 ? adsetView : adView}</div>
            <div className="min-w-0 space-y-3 lg:sticky lg:top-3 lg:self-start">
              <div className="hidden rounded-lg border border-fb-border bg-background p-4 sm:block">
                <div className="flex items-center gap-3">
                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-full border-4 text-[14px] font-bold", ready ? "border-fb-green" : "border-fb-blue/50")}>{ready ? 100 : 70}</div>
                  <div><p className="text-[14px] font-semibold">Campaign score</p><p className="text-[12px] text-fb-muted">{ready ? "You're using our recommended setup." : "Complete the required fields."}</p></div>
                </div>
              </div>
              {acc?.kind === "shared" && (
                <div className={cn("rounded-lg border bg-background p-4", ((acc as any)?.kind === "shared" && walletBalance < 1) || overWallet ? "border-destructive" : "border-fb-border")}>
                  <p className="flex items-center gap-2 text-[14px] font-semibold"><Wallet className="h-4 w-4" />Account balance</p>
                  <p className="mt-1 text-[20px] font-bold">{fmt(walletBalance)}</p>
                  {(((acc as any)?.kind === "shared" && walletBalance < 1) || overWallet) && <p className="text-[12px] text-destructive">Balance কম — publish করার আগে top-up করুন।</p>}
                </div>
              )}
              {level === 1 && tab === "edit" && (
                <div className="rounded-lg border border-fb-border bg-background p-4 text-[13px]">
                  <p className="font-semibold">Audience definition</p>
                  <p className="text-fb-muted">{countries.join(", ") || "—"} · Age {ageMin}-{ageMax === "65" ? "65+" : ageMax} · {gender === "all" ? "All genders" : gender === "male" ? "Men" : "Women"}{interests.length ? ` · ${interests.length} interests` : ""}</p>
                  <p className="mt-3 font-semibold">Estimated audience size <Info className="inline h-3 w-3 text-fb-muted" /></p>
                  <p className="mt-1 text-[16px] font-bold">
                    {reach === "loading" ? <Loader2 className="inline h-4 w-4 animate-spin text-fb-muted" />
                      : reach && reach !== "error" && reach.lower != null ? `${reach.lower.toLocaleString("en-US")} - ${(reach.upper ?? reach.lower).toLocaleString("en-US")}` : "—"}
                  </p>
                  <p className="text-[11px] text-fb-muted">{reach === "error" ? "Meta থেকে এখন হিসাব আনা যায়নি।" : "Estimates come from Meta and may vary over time."}</p>
                </div>
              )}
              {missing.length > 0 && (
                <div className={cn("rounded-lg border bg-background p-4 text-[13px]", showMissing ? "border-destructive" : "border-fb-border")}>
                  <p className="flex items-center gap-2 font-semibold text-destructive"><AlertCircle className="h-4 w-4" />Publish করার আগে যা বাকি ({missing.length})</p>
                  <ul className="mt-2 space-y-1">
                    {missing.map((m, i) => (
                      <li key={i}><button onClick={m.go} className="text-left hover:underline">• {m.t}</button></li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-2 overflow-hidden"><div className="flex items-center justify-between"><p className="text-[13px] font-semibold">Ad preview</p><button type="button" className="text-[12px] font-semibold text-fb-blue" onClick={() => { setForce((x) => x + 1); if (posts !== null) loadPosts(true); }}>Update now</button></div>{preview}</div>
            </div>
          </div>
        </main>

        {/* Bottom bar */}
        <footer className="flex items-center gap-2 border-t border-fb-border bg-background px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[13px] sm:gap-3 sm:px-4 sm:py-2.5">
          <button onClick={askClose} className="hidden h-10 rounded-md border border-fb-border px-4 font-semibold hover:bg-fb-bg sm:block sm:h-9">Close</button>
          <span className="hidden items-center gap-1 text-fb-green sm:flex"><Check className="h-4 w-4" />All edits saved</span>
          {level === 2 && <span className="hidden text-[11px] text-fb-muted lg:inline">By clicking Publish, you acknowledge the Terms and Conditions.</span>}
          <div className="flex flex-1 gap-2 sm:ml-auto sm:flex-none">
            {level > 0 && <button onClick={() => (level === 2 ? goto(selPos.a, -1) : gotoCampaign())} className="h-10 flex-1 rounded-md border border-fb-border px-3 font-semibold hover:bg-fb-bg sm:h-9 sm:flex-none sm:px-4">Back</button>}
            {level < 2 ? (
              <button onClick={() => (level === 0 ? goto(selPos.a, -1) : goto(selPos.a, selPos.d))} className="h-10 flex-1 rounded-md bg-fb-blue px-5 font-semibold text-primary-foreground sm:h-9 sm:flex-none">Next</button>
            ) : (
              <>
                <button disabled={saving} onClick={keepDraft} className="h-10 flex-1 rounded-md border border-fb-border px-2 font-semibold hover:bg-fb-bg disabled:opacity-50 sm:h-9 sm:flex-none sm:px-4">Draft</button>
                <button disabled={saving} onClick={() => { if (!ready) { setShowMissing(true); return toast.error("কিছু তথ্য বাকি — ডান পাশের তালিকা দেখুন"); } submit(true); }} className="inline-flex h-10 flex-1 items-center justify-center rounded-md bg-fb-green px-5 font-semibold text-primary-foreground disabled:opacity-40 sm:h-9 sm:flex-none">
                  {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Publish
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
      {confirmClose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/40 p-4">
          <div className="w-full max-w-[420px] rounded-lg bg-background p-5 shadow-2xl">
            <p className="text-[16px] font-semibold">Campaign বন্ধ করবেন?</p>
            <p className="mt-1 text-[13px] text-fb-muted">
              Save as draft চাপলে campaign-টা list-এ "In draft" হিসেবে থাকবে। পরে Edit চাপলে এটাই খুলবে, তখন Publish করতে পারবেন।
            </p>
            <div className="mt-4 flex justify-end gap-2 text-[13px]">
              <button onClick={() => setConfirmClose(false)} className="h-9 rounded-md border border-fb-border px-4 font-semibold hover:bg-fb-bg">Cancel</button>
              <button onClick={discard} className="h-9 rounded-md border border-destructive/50 px-4 font-semibold text-destructive hover:bg-destructive/10">Discard</button>
              <button onClick={keepDraft}
                className="h-9 rounded-md bg-fb-blue px-4 font-semibold text-primary-foreground disabled:opacity-50">Save as draft</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Used when restoring old drafts that predate some ad-set fields.
const defaultAdsetShape = {
  location: "WEBSITE", pixelId: "", customEvent: "PURCHASE", hasEnd: false, endTime: "",
  countries: ["BD"], ageMin: "18", ageMax: "65", gender: "all", interests: [], connections: "all",
  mainDest: "WEBSITE", phone: "", engLoc: "MESSAGING", destMode: "auto", dests: ["MESSENGER"],
  budgetType: "daily", amount: "5.00", bidStrategy: "LOWEST_COST_WITHOUT_CAP", bidAmount: "",
} as const;
