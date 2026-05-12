import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  X, ChevronLeft, ChevronRight, MousePointer2, Building2, Upload,
  CheckCircle2, Wallet, Loader2, CreditCard, FileText, ArrowRight,
} from "lucide-react";

/**
 * Fully simulated walkthrough — no real backend calls, no real navigation.
 * Each "scene" is a fake screen rendered inside a phone-like frame, with an
 * animated cursor that highlights the action being explained.
 */

type CursorTarget = { x: number; y: number; click?: boolean };

type Scene = {
  title: string;
  desc: string;
  render: (ctx: SceneCtx) => React.ReactNode;
  cursor?: CursorTarget; // relative to phone frame (0-100 %)
};

type SceneCtx = {
  // shared demo state across scenes
  amount: number;
  refNo: string;
  walletBalance: number;
  adBalance: number;
};

const REF = "LID01880099" + Math.floor(100 + Math.random() * 900);

export function TutorialDemo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [autoApproving, setAutoApproving] = useState(false);
  const [adApplying, setAdApplying] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setIdx(0);
      setAutoApproving(false);
      setAdApplying(false);
    }
  }, [open]);

  // Scene 4 = auto-approve animation
  useEffect(() => {
    if (!open) return;
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
  }, [idx, open]);

  const ctx: SceneCtx = {
    amount: 200,
    refNo: REF,
    walletBalance: idx >= 5 ? 200 : 0,
    adBalance: idx >= 9 ? 150 : 0,
  };

  const scenes: Scene[] = [
    {
      title: "স্বাগতম! 👋",
      desc: "এই ডেমোতে দেখাবো — কীভাবে Payment request দিবেন, Wallet এ ব্যালেন্স আসবে, এবং Ad Account এ Top-Up হবে। এটা পুরোটাই demo — কোনো আসল request যাবে না।",
      render: () => <SceneIntro />,
    },
    {
      title: "ধাপ ১ — Bank সিলেক্ট করুন",
      desc: "Top-Up Wallet পেজে গিয়ে 'Bank Transfer' সিলেক্ট করুন।",
      cursor: { x: 50, y: 55, click: true },
      render: () => <ScenePaymentType highlight />,
    },
    {
      title: "ধাপ ২ — Bank পছন্দ করুন",
      desc: "যে bank এ আপনি payment করেছেন সেটা সিলেক্ট করুন (যেমন: City Bank, DBBL, BRAC ইত্যাদি)।",
      cursor: { x: 50, y: 38, click: true },
      render: () => <SceneBankList />,
    },
    {
      title: "ধাপ ৩ — Amount + Screenshot",
      desc: "Amount লিখুন এবং আপনার payment screenshot upload করুন। তারপর Submit করুন।",
      cursor: { x: 50, y: 78, click: true },
      render: () => <SceneTopUpForm amount={ctx.amount} />,
    },
    {
      title: "ধাপ ৪ — Auto Verify হচ্ছে...",
      desc: "Submit করার পর সিস্টেম automatically Telegram bank SMS এর সাথে মিলিয়ে আপনার payment approve করে দেয়। Admin কে কিছু করতে হয় না।",
      render: () => <SceneAutoApprove approving={autoApproving} amount={ctx.amount} ref={ctx.refNo} />,
    },
    {
      title: "ধাপ ৫ — Wallet এ ব্যালেন্স",
      desc: "Approve হওয়ার সাথে সাথে আপনার Wallet এ ব্যালেন্স যোগ হয়ে যায়।",
      cursor: { x: 50, y: 28 },
      render: () => <SceneWallet balance={ctx.walletBalance} amount={ctx.amount} ref={ctx.refNo} />,
    },
    {
      title: "ধাপ ৬ — Ad Accounts এ যান",
      desc: "এখন Wallet থেকে আপনার Ad Account এ Top-Up করতে 'Ad Accounts' মেনুতে যান।",
      cursor: { x: 50, y: 35, click: true },
      render: () => <SceneAdAccountsList />,
    },
    {
      title: "ধাপ ৭ — Top-Up বাটন",
      desc: "যে Ad Account এ Top-Up করতে চান সেটার পাশে 'Top-Up' বাটনে ক্লিক করুন।",
      cursor: { x: 78, y: 38, click: true },
      render: () => <SceneAdAccountsList highlightBtn />,
    },
    {
      title: "ধাপ ৮ — Amount দিয়ে Confirm",
      desc: "কত টাকা Top-Up করতে চান লিখুন এবং Confirm করুন।",
      cursor: { x: 50, y: 78, click: true },
      render: () => <SceneAdTopUpDialog amount={150} />,
    },
    {
      title: "ধাপ ৯ — Top-Up সম্পন্ন!",
      desc: "Wallet থেকে কেটে Ad Account এর Spend Cap বেড়ে গেছে। Remaining কলামে নতুন balance দেখাবে।",
      render: () => <SceneAdAccountsList topUpDone applying={adApplying} adBalance={ctx.adBalance} />,
    },
    {
      title: "শেষ! 🎉 পুরো flow শিখে গেছেন",
      desc: "Payment → Auto Approve → Wallet → Ad Account Top-Up। কোনো সমস্যা হলে নিচের Chat Support এ মেসেজ দিন। শুভকামনা!",
      render: () => <SceneDone />,
    },
  ];

  if (!open) return null;
  const scene = scenes[idx];

  const next = () => (idx < scenes.length - 1 ? setIdx(idx + 1) : onClose());
  const prev = () => idx > 0 && setIdx(idx - 1);

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-3 overflow-y-auto">
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 z-10"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Phone frame */}
      <div className="relative w-full max-w-[360px] aspect-[9/17] bg-slate-900 rounded-[2.5rem] border-4 border-slate-800 shadow-2xl overflow-hidden mt-2">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-slate-800 rounded-b-2xl z-20" />

        {/* Screen content */}
        <div className="absolute inset-0 pt-6 overflow-hidden bg-slate-950 text-slate-100">
          <div key={idx} className="h-full animate-in fade-in duration-300">
            {scene.render(ctx)}
          </div>
        </div>

        {/* Animated cursor (relative to phone frame) */}
        {scene.cursor && (
          <CursorOverlay key={`cur-${idx}`} target={scene.cursor} />
        )}
      </div>

      {/* Caption + controls */}
      <div className="w-full max-w-[360px] mt-4 bg-background border border-border rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">
            ধাপ {idx + 1} / {scenes.length}
          </span>
          <div className="flex gap-1">
            {scenes.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-5 bg-primary" : "w-1.5 bg-muted"
                }`}
              />
            ))}
          </div>
        </div>
        <h3 className="font-bold text-base mb-1">{scene.title}</h3>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{scene.desc}</p>
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
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

/* ---------- Cursor overlay ---------- */
function CursorOverlay({ target }: { target: CursorTarget }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 10 });
  const [clicking, setClicking] = useState(false);

  useEffect(() => {
    // glide in
    const t1 = setTimeout(() => setPos({ x: target.x, y: target.y }), 50);
    let t2: ReturnType<typeof setTimeout> | undefined;
    if (target.click) {
      t2 = setTimeout(() => {
        setClicking(true);
        setTimeout(() => setClicking(false), 500);
      }, 900);
    }
    return () => {
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
  }, [target]);

  return (
    <div
      ref={ref}
      className="absolute z-30 transition-all duration-700 ease-out pointer-events-none"
      style={{
        top: `${pos.y}%`,
        left: `${pos.x}%`,
        transform: `translate(-50%, -50%) scale(${clicking ? 0.85 : 1})`,
      }}
    >
      <div className="relative">
        <MousePointer2 className="h-6 w-6 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" fill="#3b82f6" />
        {clicking && (
          <span className="absolute -top-3 -left-3 h-12 w-12 rounded-full border-2 border-blue-400 animate-ping" />
        )}
      </div>
    </div>
  );
}

/* ---------- Scenes ---------- */

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
        আপনাকে দেখাবো কীভাবে Payment request → Auto approve → Wallet → Ad Account Top-Up কাজ করে।
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
          <div
            key={b.name}
            className={`p-3 rounded-lg border flex items-center gap-3 ${
              b.hl ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/40" : "border-slate-700 bg-slate-900"
            }`}
          >
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

function SceneAutoApprove({
  approving, amount, ref,
}: { approving: boolean; amount: number; ref: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      {approving ? (
        <>
          <Loader2 className="h-14 w-14 text-blue-400 animate-spin mb-4" />
          <div className="font-bold text-base mb-1">Auto Verifying...</div>
          <div className="text-[11px] text-slate-400 mb-3">
            Telegram bank SMS এর সাথে মিলানো হচ্ছে
          </div>
          <div className="text-[10px] font-mono text-slate-500">Ref: {ref}</div>
        </>
      ) : (
        <>
          <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center mb-3 animate-in zoom-in">
            <CheckCircle2 className="h-10 w-10 text-green-400" />
          </div>
          <div className="font-bold text-base text-green-400 mb-1">Approved! ✓</div>
          <div className="text-xs text-slate-300 mb-1">${amount}.00 আপনার Wallet এ যোগ হয়েছে</div>
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
          <button
            className={`w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${
              highlightBtn
                ? "bg-blue-500 text-white ring-2 ring-blue-400/60"
                : "bg-slate-800 text-blue-400"
            }`}
          >
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
      <div className="opacity-40">
        <SceneAdAccountsList />
      </div>
      <div className="absolute inset-0 bg-black/60 flex items-end">
        <div className="w-full bg-slate-900 rounded-t-2xl p-4 border-t-2 border-slate-700">
          <div className="font-bold text-sm mb-3">Top-Up Ad Account</div>
          <div className="text-[10px] text-slate-400 mb-1">Wallet Balance: $200.00</div>
          <div className="text-[10px] text-slate-400 mb-1">Amount (USD)</div>
          <div className="px-3 py-2 rounded-lg bg-slate-800 text-base font-bold text-blue-400 mb-3">
            ${amount}.00
          </div>
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
      <p className="text-xs text-slate-400 leading-relaxed">
        এখন নিজে চেষ্টা করুন — Top-Up Request পেজে গিয়ে আপনার আসল payment proof দিন। সিস্টেম auto verify করবে।
      </p>
    </div>
  );
}
