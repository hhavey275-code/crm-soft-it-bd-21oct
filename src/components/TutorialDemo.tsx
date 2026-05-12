import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  X, ChevronLeft, ChevronRight, MousePointer2, Building2, Upload,
  CheckCircle2, Wallet, Loader2, CreditCard, FileText, ArrowRight,
  Pencil, Share2, PlusCircle, LayoutDashboard, Palette, RefreshCw,
  AlertTriangle, Sun, Moon,
} from "lucide-react";

/**
 * Multi-topic demo walkthrough. Shows a menu first; user picks a topic,
 * each topic renders its own sequence of fake scenes inside a phone frame.
 * No real backend calls.
 */

type CursorTarget = { x: number; y: number; click?: boolean };
type SceneCtx = { amount: number; refNo: string; walletBalance: number; adBalance: number };
type Scene = {
  title: string;
  desc: string;
  render: (ctx: SceneCtx) => React.ReactNode;
  cursor?: CursorTarget;
};

type TopicId =
  | "payment"
  | "ad-topup"
  | "rename-ad"
  | "bm-share"
  | "new-ad-req"
  | "dashboard"
  | "theme"
  | "refund";

type Topic = {
  id: TopicId;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
};

const TOPICS: Topic[] = [
  { id: "payment", title: "কীভাবে Payment Request দিবেন", desc: "Bank সিলেক্ট → Amount → Screenshot → Auto Approve → Wallet", icon: Wallet, color: "from-blue-500 to-blue-600" },
  { id: "ad-topup", title: "কীভাবে Ad Account এ Top-Up করবেন", desc: "Wallet থেকে Ad Account এ Spend Cap বাড়ানো", icon: CreditCard, color: "from-emerald-500 to-emerald-600" },
  { id: "rename-ad", title: "কীভাবে Ad Account Rename করবেন", desc: "Ad Account এর নাম পরিবর্তন করা", icon: Pencil, color: "from-amber-500 to-amber-600" },
  { id: "bm-share", title: "কীভাবে BM Share Request দিবেন", desc: "Business Manager এর সাথে Ad Account share করা", icon: Share2, color: "from-purple-500 to-purple-600" },
  { id: "new-ad-req", title: "কীভাবে নতুন Ad Account Request দিবেন", desc: "নতুন Ad Account এর জন্য আবেদন", icon: PlusCircle, color: "from-pink-500 to-pink-600" },
  { id: "dashboard", title: "Dashboard পরিচিতি", desc: "কোন Card কী দেখায় সেটার ব্যাখ্যা", icon: LayoutDashboard, color: "from-cyan-500 to-cyan-600" },
  { id: "theme", title: "কীভাবে Theme পরিবর্তন করবেন", desc: "Light / Dark mode toggle", icon: Palette, color: "from-orange-500 to-orange-600" },
  { id: "refund", title: "Top-Up Failed হলে Refund কীভাবে নিবেন", desc: "Failed Top-Up থেকে refund process", icon: RefreshCw, color: "from-rose-500 to-rose-600" },
];

const REF = "LID01880099" + Math.floor(100 + Math.random() * 900);

export function TutorialDemo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [topic, setTopic] = useState<TopicId | null>(null);
  const [idx, setIdx] = useState(0);
  const [autoApproving, setAutoApproving] = useState(false);
  const [adApplying, setAdApplying] = useState(false);

  useEffect(() => {
    if (!open) {
      setTopic(null);
      setIdx(0);
      setAutoApproving(false);
      setAdApplying(false);
    }
  }, [open]);

  // payment topic auto-approve animation triggers
  useEffect(() => {
    if (!open || topic !== "payment") return;
    if (idx === 4) {
      setAutoApproving(true);
      const t = setTimeout(() => setAutoApproving(false), 1800);
      return () => clearTimeout(t);
    }
    if (idx === 8) {
      setAdApplying(true);
      const t = setTimeout(() => setAdApplying(false), 1500);
      return () => clearTimeout(t);
    }
  }, [idx, open, topic]);

  if (!open) return null;

  // ---------- Menu ----------
  if (!topic) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-start p-4 overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 z-10"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="w-full max-w-md mt-8 mb-4 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/20 mb-3">
            <MousePointer2 className="h-7 w-7 text-blue-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">টিউটোরিয়াল মেনু</h2>
          <p className="text-sm text-slate-300">যেটা শিখতে চান সেটায় ক্লিক করুন</p>
        </div>
        <div className="w-full max-w-md grid gap-2 pb-8">
          {TOPICS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => { setTopic(t.id); setIdx(0); }}
                className="w-full text-left bg-background border border-border hover:border-primary/50 hover:bg-accent rounded-xl p-3 flex items-center gap-3 transition-all hover:scale-[1.02]"
              >
                <div className={`h-11 w-11 shrink-0 rounded-lg bg-gradient-to-br ${t.color} flex items-center justify-center`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t.desc}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      </div>,
      document.body
    );
  }

  // ---------- Scene player ----------
  const ctx: SceneCtx = {
    amount: 200,
    refNo: REF,
    walletBalance: idx >= 5 ? 200 : 0,
    adBalance: idx >= 9 ? 150 : 0,
  };

  const scenes = getScenesForTopic(topic, { autoApproving, adApplying, ctx });
  const scene = scenes[idx];
  const next = () => (idx < scenes.length - 1 ? setIdx(idx + 1) : setTopic(null));
  const prev = () => idx > 0 && setIdx(idx - 1);
  const currentTopic = TOPICS.find((t) => t.id === topic)!;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-3 overflow-y-auto">
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 z-10"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Back to menu */}
      <button
        onClick={() => { setTopic(null); setIdx(0); }}
        className="absolute top-4 left-4 text-white/80 hover:text-white text-xs px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 z-10 flex items-center gap-1"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> মেনু
      </button>

      {/* Phone frame */}
      <div className="relative w-full max-w-[360px] aspect-[9/17] bg-slate-900 rounded-[2.5rem] border-4 border-slate-800 shadow-2xl overflow-hidden mt-12">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-slate-800 rounded-b-2xl z-20" />
        <div className="absolute inset-0 pt-6 overflow-hidden bg-slate-950 text-slate-100">
          <div key={`${topic}-${idx}`} className="h-full animate-in fade-in duration-300">
            {scene.render(ctx)}
          </div>
        </div>
        {scene.cursor && <CursorOverlay key={`cur-${topic}-${idx}`} target={scene.cursor} />}
      </div>

      <div className="w-full max-w-[360px] mt-4 bg-background border border-border rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground truncate pr-2">{currentTopic.title}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {idx + 1} / {scenes.length}
          </span>
        </div>
        <div className="flex gap-1 mb-3">
          {scenes.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full flex-1 transition-all ${
                i === idx ? "bg-primary" : i < idx ? "bg-primary/40" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <h3 className="font-bold text-base mb-1">{scene.title}</h3>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{scene.desc}</p>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setTopic(null); setIdx(0); }}>
            মেনু
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={prev} disabled={idx === 0}>
              <ChevronLeft className="h-4 w-4 mr-1" />পিছনে
            </Button>
            <Button size="sm" onClick={next}>
              {idx === scenes.length - 1 ? "শেষ" : "পরের"}
              {idx < scenes.length - 1 && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ========================= Scene sets per topic ========================= */

function getScenesForTopic(
  topic: TopicId,
  state: { autoApproving: boolean; adApplying: boolean; ctx: SceneCtx },
): Scene[] {
  switch (topic) {
    case "payment": return paymentScenes(state);
    case "ad-topup": return adTopUpScenes();
    case "rename-ad": return renameAdScenes();
    case "bm-share": return bmShareScenes();
    case "new-ad-req": return newAdReqScenes();
    case "dashboard": return dashboardScenes();
    case "theme": return themeScenes();
    case "refund": return refundScenes();
  }
}

function paymentScenes({ autoApproving, adApplying, ctx }: { autoApproving: boolean; adApplying: boolean; ctx: SceneCtx }): Scene[] {
  return [
    { title: "স্বাগতম! 👋", desc: "এই demo তে দেখাবো — Payment request → Auto approve → Wallet → Ad Account Top-Up।", render: () => <SceneIntro /> },
    { title: "ধাপ ১ — Bank সিলেক্ট", desc: "Top-Up Wallet পেজে গিয়ে 'Bank Transfer' সিলেক্ট করুন।", cursor: { x: 50, y: 55, click: true }, render: () => <ScenePaymentType highlight /> },
    { title: "ধাপ ২ — Bank পছন্দ", desc: "যে bank এ payment করেছেন সেটা সিলেক্ট করুন।", cursor: { x: 50, y: 38, click: true }, render: () => <SceneBankList /> },
    { title: "ধাপ ৩ — Amount + Screenshot", desc: "Amount লিখুন এবং payment screenshot upload করুন।", cursor: { x: 50, y: 78, click: true }, render: () => <SceneTopUpForm amount={ctx.amount} /> },
    { title: "ধাপ ৪ — Auto Verify", desc: "সিস্টেম automatically Telegram bank SMS এর সাথে মিলিয়ে approve করে।", render: () => <SceneAutoApprove approving={autoApproving} amount={ctx.amount} ref={ctx.refNo} /> },
    { title: "ধাপ ৫ — Wallet এ ব্যালেন্স", desc: "Approve হলে Wallet এ ব্যালেন্স যোগ হয়ে যায়।", cursor: { x: 50, y: 28 }, render: () => <SceneWallet balance={ctx.walletBalance} amount={ctx.amount} ref={ctx.refNo} /> },
    { title: "ধাপ ৬ — Ad Accounts", desc: "Wallet থেকে Ad Account এ Top-Up করতে 'Ad Accounts' মেনুতে যান।", cursor: { x: 50, y: 35, click: true }, render: () => <SceneAdAccountsList /> },
    { title: "ধাপ ৭ — Top-Up বাটন", desc: "যে Ad Account এ Top-Up করতে চান সেটার 'Top-Up' বাটনে ক্লিক।", cursor: { x: 78, y: 38, click: true }, render: () => <SceneAdAccountsList highlightBtn /> },
    { title: "ধাপ ৮ — Confirm", desc: "Amount দিয়ে Confirm করুন।", cursor: { x: 50, y: 78, click: true }, render: () => <SceneAdTopUpDialog amount={150} /> },
    { title: "ধাপ ৯ — সম্পন্ন!", desc: "Wallet থেকে কেটে Ad Account এর Spend Cap বেড়ে গেছে।", render: () => <SceneAdAccountsList topUpDone applying={adApplying} adBalance={ctx.adBalance} /> },
    { title: "শেষ! 🎉", desc: "Payment → Auto Approve → Wallet → Ad Account Top-Up পুরো flow শিখে গেছেন।", render: () => <SceneDone /> },
  ];
}

function adTopUpScenes(): Scene[] {
  return [
    { title: "Ad Account Top-Up", desc: "Wallet এ ব্যালেন্স থাকলে Ad Account এ Spend Cap বাড়াতে পারবেন।", render: () => <SceneWallet balance={200} amount={200} ref={REF} /> },
    { title: "ধাপ ১ — Ad Accounts মেনু", desc: "সাইডবার থেকে 'Ad Accounts' এ যান।", cursor: { x: 50, y: 35, click: true }, render: () => <SceneAdAccountsList /> },
    { title: "ধাপ ২ — Top-Up বাটন", desc: "যেটায় Top-Up করবেন সেটার 'Top-Up' বাটনে ক্লিক।", cursor: { x: 78, y: 65, click: true }, render: () => <SceneAdAccountsList highlightBtn /> },
    { title: "ধাপ ৩ — Amount দিন", desc: "কত USD Top-Up করবেন লিখুন এবং Confirm করুন।", cursor: { x: 50, y: 80, click: true }, render: () => <SceneAdTopUpDialog amount={150} /> },
    { title: "সম্পন্ন ✓", desc: "Spend Cap বেড়ে গেছে — Remaining কলামে নতুন balance দেখাচ্ছে।", render: () => <SceneAdAccountsList topUpDone adBalance={150} /> },
  ];
}

function renameAdScenes(): Scene[] {
  return [
    { title: "Ad Account Rename", desc: "Ad Account এর নাম যেকোনো সময় পরিবর্তন করতে পারবেন।", render: () => <SceneAdAccountsList /> },
    { title: "ধাপ ১ — Account এ ক্লিক", desc: "যে Account rename করবেন সেটার নামে ক্লিক করুন।", cursor: { x: 30, y: 25, click: true }, render: () => <SceneAdAccountsList /> },
    { title: "ধাপ ২ — Edit আইকন", desc: "নামের পাশে Pencil আইকনে ক্লিক করুন।", cursor: { x: 75, y: 25, click: true }, render: () => <SceneRenameDialog stage="open" /> },
    { title: "ধাপ ৩ — নতুন নাম", desc: "নতুন নাম লিখুন এবং Save করুন।", cursor: { x: 50, y: 75, click: true }, render: () => <SceneRenameDialog stage="typing" /> },
    { title: "সম্পন্ন ✓", desc: "Ad Account এর নাম পরিবর্তন হয়ে গেছে।", render: () => <SceneRenameDialog stage="done" /> },
  ];
}

function bmShareScenes(): Scene[] {
  return [
    { title: "BM Share Request", desc: "Business Manager এর সাথে Ad Account share করার নিয়ম।", render: () => <SceneBMIntro /> },
    { title: "ধাপ ১ — Account সিলেক্ট", desc: "যে Ad Account share করতে চান সেটায় যান।", cursor: { x: 50, y: 30, click: true }, render: () => <SceneAdAccountsList /> },
    { title: "ধাপ ২ — BM Share বাটন", desc: "'Share with BM' বাটনে ক্লিক করুন।", cursor: { x: 50, y: 70, click: true }, render: () => <SceneBMShareForm stage="form" /> },
    { title: "ধাপ ৩ — BM ID দিন", desc: "আপনার Business Manager ID লিখুন এবং Submit করুন।", cursor: { x: 50, y: 75, click: true }, render: () => <SceneBMShareForm stage="filled" /> },
    { title: "Pending Approval", desc: "Admin আপনার BM share request approve করার পর Account আপনার BM এ চলে যাবে।", render: () => <SceneBMShareForm stage="pending" /> },
  ];
}

function newAdReqScenes(): Scene[] {
  return [
    { title: "নতুন Ad Account", desc: "নতুন Ad Account এর জন্য request দেওয়ার নিয়ম।", render: () => <SceneNewAdIntro /> },
    { title: "ধাপ ১ — Requests মেনু", desc: "সাইডবার থেকে 'Requests' / 'Top-Up Request' পেজে যান।", cursor: { x: 50, y: 50, click: true }, render: () => <SceneRequestsMenu /> },
    { title: "ধাপ ২ — New Account Request", desc: "'New Ad Account Request' বাটনে ক্লিক করুন।", cursor: { x: 50, y: 70, click: true }, render: () => <SceneNewAdForm stage="form" /> },
    { title: "ধাপ ৩ — Details দিন", desc: "Page URL, BM ID, Timezone, Currency দিন এবং Submit করুন।", cursor: { x: 50, y: 85, click: true }, render: () => <SceneNewAdForm stage="filled" /> },
    { title: "সম্পন্ন ✓", desc: "Admin review করে আপনার Ad Account তৈরি করে দিবে।", render: () => <SceneNewAdForm stage="done" /> },
  ];
}

function dashboardScenes(): Scene[] {
  return [
    { title: "Dashboard পরিচিতি", desc: "Dashboard এ আপনি একনজরে সব দেখতে পারবেন।", render: () => <SceneDashOverview /> },
    { title: "Wallet Balance Card", desc: "এই কার্ডে আপনার Wallet এ বর্তমানে কত USD আছে দেখাচ্ছে।", cursor: { x: 25, y: 25 }, render: () => <SceneDashOverview hl="wallet" /> },
    { title: "Total Spent Card", desc: "এই মাসে সব Ad Account মিলিয়ে কত spend হয়েছে।", cursor: { x: 75, y: 25 }, render: () => <SceneDashOverview hl="spent" /> },
    { title: "Active Accounts Card", desc: "এখন কতগুলো Active Ad Account আছে।", cursor: { x: 25, y: 50 }, render: () => <SceneDashOverview hl="active" /> },
    { title: "Recent Top-Ups", desc: "সর্বশেষ কয়টা Top-Up এর Status (approved/pending) দেখাচ্ছে।", cursor: { x: 50, y: 75 }, render: () => <SceneDashOverview hl="recent" /> },
  ];
}

function themeScenes(): Scene[] {
  return [
    { title: "Theme Toggle", desc: "Light বা Dark mode যেকোনো একটায় আপনি কাজ করতে পারবেন।", render: () => <SceneThemeIntro mode="dark" /> },
    { title: "ধাপ ১ — Sidebar এ Theme বাটন", desc: "সাইডবারের নিচে Sun/Moon আইকন দেখাচ্ছে।", cursor: { x: 18, y: 90, click: true }, render: () => <SceneThemeSidebar /> },
    { title: "ধাপ ২ — ক্লিক করুন", desc: "ক্লিক করলেই Theme পরিবর্তন হয়ে যাবে।", render: () => <SceneThemeIntro mode="light" /> },
    { title: "সম্পন্ন ✓", desc: "যেকোনো সময় আবার ক্লিক করে Dark mode এ ফিরতে পারবেন।", render: () => <SceneThemeIntro mode="dark" /> },
  ];
}

function refundScenes(): Scene[] {
  return [
    { title: "Failed Top-Up Refund", desc: "Top-Up fail হলে টাকা automatically Wallet এ ফেরত আসে। চলুন দেখি।", render: () => <SceneRefundIntro /> },
    { title: "ধাপ ১ — Failed Top-Ups মেনু", desc: "সাইডবার থেকে 'Failed Top-Ups' পেজে যান।", cursor: { x: 50, y: 45, click: true }, render: () => <SceneFailedList /> },
    { title: "ধাপ ২ — Failed entry দেখুন", desc: "এখানে যে Top-Up fail হয়েছে সেটার বিস্তারিত দেখাচ্ছে।", cursor: { x: 50, y: 35 }, render: () => <SceneFailedList highlight /> },
    { title: "ধাপ ৩ — Refund বাটন", desc: "'Refund to Wallet' বাটনে ক্লিক করুন।", cursor: { x: 75, y: 60, click: true }, render: () => <SceneFailedList highlight showBtn /> },
    { title: "সম্পন্ন ✓", desc: "টাকা আপনার Wallet এ ফেরত এসে গেছে।", render: () => <SceneRefundDone /> },
  ];
}

/* ========================= Cursor overlay ========================= */
function CursorOverlay({ target }: { target: CursorTarget }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 10 });
  const [clicking, setClicking] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setPos({ x: target.x, y: target.y }), 50);
    let t2: ReturnType<typeof setTimeout> | undefined;
    if (target.click) {
      t2 = setTimeout(() => {
        setClicking(true);
        setTimeout(() => setClicking(false), 500);
      }, 900);
    }
    return () => { clearTimeout(t1); if (t2) clearTimeout(t2); };
  }, [target]);
  return (
    <div ref={ref} className="absolute z-30 transition-all duration-700 ease-out pointer-events-none"
      style={{ top: `${pos.y}%`, left: `${pos.x}%`, transform: `translate(-50%, -50%) scale(${clicking ? 0.85 : 1})` }}>
      <div className="relative">
        <MousePointer2 className="h-6 w-6 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" fill="#3b82f6" />
        {clicking && <span className="absolute -top-3 -left-3 h-12 w-12 rounded-full border-2 border-blue-400 animate-ping" />}
      </div>
    </div>
  );
}

/* ========================= Shared scene parts ========================= */

function PhoneHeader({ title }: { title: string }) {
  return (
    <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
      <Wallet className="h-4 w-4 text-blue-400" />
      <span className="font-bold text-sm">{title}</span>
    </div>
  );
}

function SceneIntro() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="h-20 w-20 rounded-full bg-blue-500/20 flex items-center justify-center mb-4">
        <MousePointer2 className="h-10 w-10 text-blue-400" />
      </div>
      <h2 className="text-xl font-bold mb-2">Demo Walkthrough</h2>
      <p className="text-xs text-slate-400 leading-relaxed">
        সব কিছু demo — কোনো আসল payment বা request যাবে না।
      </p>
    </div>
  );
}

function ScenePaymentType({ highlight }: { highlight?: boolean }) {
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Top-Up Wallet" />
      <div className="px-4 py-3 flex items-center justify-between text-xs">
        <span>Balance: <span className="text-blue-400 font-bold">$0.00</span></span>
        <span className="text-slate-400">Rate: ৳130/USD</span>
      </div>
      <div className="px-4 mt-2">
        <div className="text-sm font-semibold mb-3">Choose Payment Type</div>
        <div className={`p-3 rounded-xl border ${highlight ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/40" : "border-slate-700 bg-slate-900"} flex items-center gap-3`}>
          <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-sm">Bank Transfer</div>
            <div className="text-[10px] text-slate-400">Online, ATM & Cash deposit</div>
          </div>
          <ArrowRight className="h-4 w-4 text-slate-500" />
        </div>
      </div>
    </div>
  );
}

function SceneBankList() {
  const banks = [
    { name: "City Bank", acc: "1502xxxxxx", hl: true },
    { name: "Dutch-Bangla Bank", acc: "1011xxxxxx" },
    { name: "BRAC Bank", acc: "1521xxxxxx" },
    { name: "Islami Bank", acc: "2050xxxxxx" },
  ];
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Select Bank" />
      <div className="px-4 py-3 space-y-2">
        {banks.map((b) => (
          <div key={b.name}
            className={`p-3 rounded-lg border flex items-center gap-3 ${
              b.hl ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/40" : "border-slate-700 bg-slate-900"
            }`}>
            <Building2 className="h-5 w-5 text-blue-400" />
            <div className="flex-1">
              <div className="text-sm font-semibold">{b.name}</div>
              <div className="text-[10px] text-slate-400">A/C: {b.acc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneTopUpForm({ amount }: { amount: number }) {
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Payment Details" />
      <div className="px-4 py-3 space-y-3">
        <div>
          <label className="text-[10px] text-slate-400">Bank</label>
          <div className="px-3 py-2 rounded-lg bg-slate-800 text-sm">City Bank</div>
        </div>
        <div>
          <label className="text-[10px] text-slate-400">Amount (USD)</label>
          <div className="px-3 py-2 rounded-lg bg-slate-800 text-sm font-bold text-blue-400">${amount}.00</div>
        </div>
        <div>
          <label className="text-[10px] text-slate-400">Payment Screenshot</label>
          <div className="p-2 rounded-lg bg-slate-800 border border-dashed border-slate-600 flex items-center gap-2">
            <div className="h-12 w-12 rounded bg-slate-700 flex items-center justify-center">
              <FileText className="h-5 w-5 text-blue-400" />
            </div>
            <div className="flex-1 text-[10px]">
              <div className="text-slate-200">payment_proof.jpg</div>
              <div className="text-green-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Uploaded
              </div>
            </div>
            <Upload className="h-4 w-4 text-slate-500" />
          </div>
        </div>
        <button className="w-full py-2.5 rounded-lg bg-blue-500 text-white text-sm font-bold ring-2 ring-blue-500/40">
          Submit Request
        </button>
      </div>
    </div>
  );
}

function SceneAutoApprove({ approving, amount, ref }: { approving: boolean; amount: number; ref: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      {approving ? (
        <>
          <Loader2 className="h-14 w-14 text-blue-400 animate-spin mb-4" />
          <div className="font-bold text-base mb-1">Auto Verifying...</div>
          <div className="text-[11px] text-slate-400 mb-3">Telegram bank SMS এর সাথে মিলানো হচ্ছে</div>
          <div className="text-[10px] font-mono text-slate-500">Ref: {ref}</div>
        </>
      ) : (
        <>
          <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center mb-3 animate-in zoom-in">
            <CheckCircle2 className="h-10 w-10 text-green-400" />
          </div>
          <div className="font-bold text-base text-green-400 mb-1">Approved! ✓</div>
          <div className="text-xs text-slate-300 mb-1">${amount}.00 Wallet এ যোগ হয়েছে</div>
          <div className="text-[10px] font-mono text-slate-500">Ref: {ref}</div>
        </>
      )}
    </div>
  );
}

function SceneWallet({ balance, amount, ref }: { balance: number; amount: number; ref: string }) {
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="My Wallet" />
      <div className="p-4">
        <div className="rounded-xl p-4 bg-gradient-to-br from-blue-600 to-blue-500 ring-2 ring-blue-400/50">
          <div className="text-[11px] text-blue-100">Available Balance</div>
          <div className="text-3xl font-bold text-white mt-1">${balance.toFixed(2)}</div>
          <div className="text-[10px] text-blue-100 mt-1">≈ ৳{(balance * 130).toLocaleString()}</div>
        </div>
        <div className="mt-4">
          <div className="text-xs font-semibold mb-2 text-slate-300">Recent History</div>
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">+ ${amount}.00</div>
              <div className="text-[10px] text-slate-400">Top-Up · Just now</div>
              <div className="text-[10px] font-mono text-slate-500">{ref}</div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Approved</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneAdAccountsList({
  highlightBtn, topUpDone, applying, adBalance,
}: { highlightBtn?: boolean; topUpDone?: boolean; applying?: boolean; adBalance?: number }) {
  const remaining = topUpDone ? (adBalance ?? 150) : 0;
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Ad Accounts" />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-sm font-bold">Demo Ad Account</div>
              <div className="text-[10px] text-slate-400">ID: act_123456789</div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Active</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
            <div className="bg-slate-800 rounded p-2">
              <div className="text-slate-400">Spent</div>
              <div className="font-bold">$50.00</div>
            </div>
            <div className={`bg-slate-800 rounded p-2 ${topUpDone ? "ring-2 ring-green-500/50" : ""}`}>
              <div className="text-slate-400">Remaining</div>
              <div className={`font-bold ${applying ? "animate-pulse text-blue-400" : topUpDone ? "text-green-400" : ""}`}>
                ${remaining.toFixed(2)}
              </div>
            </div>
          </div>
          <button className={`w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${
            highlightBtn ? "bg-blue-500 text-white ring-2 ring-blue-400/60" : "bg-slate-800 text-blue-400"
          }`}>
            <CreditCard className="h-3.5 w-3.5" /> Top-Up
          </button>
        </div>
      </div>
    </div>
  );
}

function SceneAdTopUpDialog({ amount }: { amount: number }) {
  return (
    <div className="h-full relative">
      <div className="opacity-40"><SceneAdAccountsList /></div>
      <div className="absolute inset-0 bg-black/60 flex items-end">
        <div className="w-full bg-slate-900 rounded-t-2xl p-4 border-t-2 border-slate-700">
          <div className="font-bold text-sm mb-3">Top-Up Ad Account</div>
          <div className="text-[10px] text-slate-400 mb-1">Wallet Balance: $200.00</div>
          <div className="text-[10px] text-slate-400 mb-1">Amount (USD)</div>
          <div className="px-3 py-2 rounded-lg bg-slate-800 text-base font-bold text-blue-400 mb-3">${amount}.00</div>
          <button className="w-full py-2.5 rounded-lg bg-blue-500 text-white text-sm font-bold ring-2 ring-blue-500/40">
            Confirm Top-Up
          </button>
        </div>
      </div>
    </div>
  );
}

function SceneDone() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
        <CheckCircle2 className="h-12 w-12 text-green-400" />
      </div>
      <h2 className="text-xl font-bold mb-2">শিখে গেছেন! 🎉</h2>
      <p className="text-xs text-slate-400 leading-relaxed">এখন নিজে চেষ্টা করুন।</p>
    </div>
  );
}

/* ========================= Rename ========================= */
function SceneRenameDialog({ stage }: { stage: "open" | "typing" | "done" }) {
  const newName = stage === "typing" || stage === "done" ? "My Brand Ad Account" : "Demo Ad Account";
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Edit Account Name" />
      <div className="p-4 space-y-3">
        {stage === "done" ? (
          <div className="text-center py-6">
            <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-2" />
            <div className="font-bold text-sm">Saved ✓</div>
            <div className="text-[11px] text-slate-400 mt-1">নাম পরিবর্তন হয়ে গেছে</div>
            <div className="mt-3 px-3 py-2 rounded-lg bg-slate-800 text-sm font-semibold">{newName}</div>
          </div>
        ) : (
          <>
            <div>
              <label className="text-[10px] text-slate-400">Account Name</label>
              <div className={`px-3 py-2 rounded-lg bg-slate-800 text-sm ${stage === "typing" ? "ring-2 ring-blue-500" : ""}`}>
                {newName}{stage === "typing" && <span className="animate-pulse">|</span>}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="flex-1 py-2 rounded-lg bg-slate-800 text-xs">Cancel</button>
              <button className="flex-1 py-2 rounded-lg bg-blue-500 text-white text-xs font-bold ring-2 ring-blue-500/40">Save</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ========================= BM Share ========================= */
function SceneBMIntro() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="h-20 w-20 rounded-full bg-purple-500/20 flex items-center justify-center mb-4">
        <Share2 className="h-10 w-10 text-purple-400" />
      </div>
      <h2 className="text-base font-bold mb-2">BM Share Request</h2>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        আপনার নিজের Business Manager এ Ad Account share করতে পারবেন।
      </p>
    </div>
  );
}

function SceneBMShareForm({ stage }: { stage: "form" | "filled" | "pending" }) {
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Share with BM" />
      <div className="p-4 space-y-3">
        {stage === "pending" ? (
          <div className="text-center py-6">
            <Loader2 className="h-12 w-12 text-amber-400 mx-auto mb-2 animate-spin" />
            <div className="font-bold text-sm text-amber-400">Pending Admin Approval</div>
            <div className="text-[11px] text-slate-400 mt-1">খুব শীঘ্রই Account আপনার BM এ চলে যাবে</div>
          </div>
        ) : (
          <>
            <div>
              <label className="text-[10px] text-slate-400">Ad Account</label>
              <div className="px-3 py-2 rounded-lg bg-slate-800 text-sm">act_123456789</div>
            </div>
            <div>
              <label className="text-[10px] text-slate-400">Your Business Manager ID</label>
              <div className={`px-3 py-2 rounded-lg bg-slate-800 text-sm font-mono ${stage === "filled" ? "ring-2 ring-purple-500 text-purple-300" : "text-slate-500"}`}>
                {stage === "filled" ? "1234567890123456" : "BM ID লিখুন..."}
              </div>
            </div>
            <button className="w-full py-2.5 rounded-lg bg-purple-500 text-white text-sm font-bold ring-2 ring-purple-500/40">
              Submit BM Share Request
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ========================= New Ad Request ========================= */
function SceneNewAdIntro() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="h-20 w-20 rounded-full bg-pink-500/20 flex items-center justify-center mb-4">
        <PlusCircle className="h-10 w-10 text-pink-400" />
      </div>
      <h2 className="text-base font-bold mb-2">নতুন Ad Account Request</h2>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Page URL, BM ID ইত্যাদি দিয়ে নতুন Ad Account এর জন্য আবেদন।
      </p>
    </div>
  );
}

function SceneRequestsMenu() {
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Requests" />
      <div className="p-3 space-y-2">
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 flex items-center gap-3">
          <ArrowRight className="h-4 w-4 text-blue-400" />
          <span className="text-sm">Top-Up Request</span>
        </div>
        <div className="p-3 rounded-lg bg-pink-500/10 border-2 border-pink-500 flex items-center gap-3 ring-2 ring-pink-500/40">
          <PlusCircle className="h-4 w-4 text-pink-400" />
          <span className="text-sm font-bold">New Ad Account Request</span>
        </div>
        <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 flex items-center gap-3">
          <Share2 className="h-4 w-4 text-purple-400" />
          <span className="text-sm">BM Share Request</span>
        </div>
      </div>
    </div>
  );
}

function SceneNewAdForm({ stage }: { stage: "form" | "filled" | "done" }) {
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="New Ad Account" />
      <div className="p-4 space-y-2">
        {stage === "done" ? (
          <div className="text-center py-6">
            <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto mb-2" />
            <div className="font-bold text-sm">Submitted ✓</div>
            <div className="text-[11px] text-slate-400 mt-1">Admin শীঘ্রই Account তৈরি করে দিবে</div>
          </div>
        ) : (
          <>
            {[
              { label: "Page URL", val: stage === "filled" ? "facebook.com/mybrand" : "" },
              { label: "BM ID", val: stage === "filled" ? "1234567890" : "" },
              { label: "Timezone", val: stage === "filled" ? "Asia/Dhaka" : "" },
              { label: "Currency", val: stage === "filled" ? "USD" : "" },
            ].map((f) => (
              <div key={f.label}>
                <label className="text-[10px] text-slate-400">{f.label}</label>
                <div className={`px-3 py-1.5 rounded-lg bg-slate-800 text-xs ${f.val ? "text-pink-300" : "text-slate-500"}`}>
                  {f.val || "—"}
                </div>
              </div>
            ))}
            <button className="w-full py-2.5 rounded-lg bg-pink-500 text-white text-sm font-bold ring-2 ring-pink-500/40 mt-2">
              Submit Request
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ========================= Dashboard ========================= */
function SceneDashOverview({ hl }: { hl?: "wallet" | "spent" | "active" | "recent" }) {
  const card = (key: string, label: string, value: string, color: string) => (
    <div className={`rounded-xl p-3 ${color} ${hl === key ? "ring-4 ring-yellow-400/70 scale-105" : ""} transition-all`}>
      <div className="text-[10px] text-white/80">{label}</div>
      <div className="text-lg font-bold text-white mt-1">{value}</div>
    </div>
  );
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Dashboard" />
      <div className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {card("wallet", "Wallet Balance", "$200.00", "bg-gradient-to-br from-blue-600 to-blue-500")}
          {card("spent", "Total Spent", "$1,250.00", "bg-gradient-to-br from-emerald-600 to-emerald-500")}
          {card("active", "Active Accounts", "5", "bg-gradient-to-br from-purple-600 to-purple-500")}
          {card("recent", "Pending Top-Up", "1", "bg-gradient-to-br from-amber-600 to-amber-500")}
        </div>
        <div className={`rounded-lg border border-slate-700 bg-slate-900 p-3 ${hl === "recent" ? "ring-4 ring-yellow-400/70" : ""}`}>
          <div className="text-[11px] font-semibold mb-2 text-slate-300">Recent Top-Ups</div>
          <div className="space-y-1.5">
            {[
              { amt: "$200", st: "Approved", c: "text-green-400 bg-green-500/20" },
              { amt: "$150", st: "Pending", c: "text-amber-400 bg-amber-500/20" },
            ].map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="font-bold">{r.amt}</span>
                <span className={`px-2 py-0.5 rounded-full ${r.c}`}>{r.st}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================= Theme ========================= */
function SceneThemeIntro({ mode }: { mode: "light" | "dark" }) {
  const isDark = mode === "dark";
  return (
    <div className={`h-full flex flex-col items-center justify-center px-6 text-center transition-colors ${isDark ? "bg-slate-950" : "bg-white"}`}>
      <div className={`h-20 w-20 rounded-full flex items-center justify-center mb-4 ${isDark ? "bg-slate-800" : "bg-yellow-100"}`}>
        {isDark ? <Moon className="h-10 w-10 text-blue-300" /> : <Sun className="h-10 w-10 text-yellow-500" />}
      </div>
      <h2 className={`text-base font-bold mb-2 ${isDark ? "text-white" : "text-slate-900"}`}>
        {isDark ? "Dark Mode" : "Light Mode"}
      </h2>
      <p className={`text-[11px] ${isDark ? "text-slate-400" : "text-slate-600"}`}>
        Sidebar এর Theme বাটন চেপে যেকোনো mode এ যেতে পারবেন।
      </p>
    </div>
  );
}

function SceneThemeSidebar() {
  return (
    <div className="h-full bg-slate-900 flex">
      <div className="w-20 bg-slate-950 border-r border-slate-800 flex flex-col items-center py-4 gap-3 text-[9px] text-slate-400">
        <div className="h-8 w-8 rounded-lg bg-blue-500" />
        <div className="space-y-2 text-center">
          <div>Dashboard</div>
          <div>Wallet</div>
          <div>Top-Up</div>
        </div>
        <div className="flex-1" />
        <div className="ring-4 ring-yellow-400/70 rounded-full p-1">
          <Sun className="h-5 w-5 text-yellow-400" />
        </div>
        <div className="text-[9px] text-yellow-400">Theme</div>
      </div>
      <div className="flex-1 p-3 text-xs text-slate-300">
        <div className="text-sm font-bold mb-2">Dashboard</div>
        <div className="text-slate-500">এই Sun/Moon আইকনে ক্লিক করলেই Theme পরিবর্তন।</div>
      </div>
    </div>
  );
}

/* ========================= Refund ========================= */
function SceneRefundIntro() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="h-20 w-20 rounded-full bg-rose-500/20 flex items-center justify-center mb-4">
        <RefreshCw className="h-10 w-10 text-rose-400" />
      </div>
      <h2 className="text-base font-bold mb-2">Failed Top-Up Refund</h2>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Top-Up fail হলে টাকা automatically Wallet এ ফেরত আসে।
      </p>
    </div>
  );
}

function SceneFailedList({ highlight, showBtn }: { highlight?: boolean; showBtn?: boolean }) {
  return (
    <div className="h-full overflow-hidden">
      <PhoneHeader title="Failed Top-Ups" />
      <div className="p-3 space-y-2">
        <div className={`rounded-xl border p-3 ${highlight ? "border-rose-500 bg-rose-500/10 ring-2 ring-rose-500/40" : "border-slate-700 bg-slate-900"}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <div className="text-sm font-bold">act_123456789</div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400">Failed</span>
          </div>
          <div className="text-[11px] text-slate-400 mb-1">Amount: <span className="font-bold text-slate-200">$150.00</span></div>
          <div className="text-[10px] text-slate-500 mb-2">Reason: Spend cap reached</div>
          {showBtn && (
            <button className="w-full py-2 rounded-lg bg-rose-500 text-white text-xs font-bold ring-2 ring-rose-500/40 flex items-center justify-center gap-1">
              <RefreshCw className="h-3.5 w-3.5" /> Refund to Wallet
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SceneRefundDone() {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
        <CheckCircle2 className="h-12 w-12 text-green-400" />
      </div>
      <h2 className="text-base font-bold mb-2 text-green-400">Refunded ✓</h2>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">$150.00 আপনার Wallet এ ফেরত এসেছে।</p>
      <div className="rounded-lg bg-slate-900 border border-slate-700 px-4 py-2">
        <div className="text-[10px] text-slate-400">New Wallet Balance</div>
        <div className="text-lg font-bold text-blue-400">$350.00</div>
      </div>
    </div>
  );
}
