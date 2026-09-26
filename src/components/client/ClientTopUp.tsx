import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Link } from "@/lib/router-compat";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { ArrowUpCircle, Banknote, DollarSign, ImageIcon, X, FileText, ChevronLeft, ChevronRight, Check, CreditCard, Building2, Wallet, ArrowRight, Smartphone, Globe, Landmark, Loader2, Copy } from "lucide-react";

import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWallets } from "@/hooks/useWallets";
import { logSystemAction } from "@/lib/systemLog";
import { cn } from "@/lib/utils";
import { TelegramPollStatus } from "@/components/TelegramPollStatus";
import { createProofUrl } from "@/lib/proofUrl";

type PaymentMethod = "online_transfer" | "mfs_to_bank" | "npsb" | "atm_deposit" | "cash_deposit";
type PaymentCategory = "bank" | "mfs";

const isMFS = (name: string) => /bkash|nagad/i.test(name);
const normalizePaymentRef = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const STEPS = [
  { label: "Method", icon: CreditCard },
  { label: "Bank", icon: Building2 },
  { label: "Details", icon: FileText },
  { label: "Review", icon: Check },
];

// Premium icon components
function PremiumIcon({ children, gradient, size = "lg" }: { children: React.ReactNode; gradient: string; size?: "lg" | "md" }) {
  return (
    <div className={cn(
      "rounded-2xl flex items-center justify-center shadow-lg",
      size === "lg" ? "h-14 w-14" : "h-11 w-11"
    )} style={{ background: gradient }}>
      {children}
    </div>
  );
}

function BankTransferIcon() {
  return (
    <PremiumIcon gradient="linear-gradient(135deg, #2563eb, #1d4ed8)">
      <Landmark className="h-7 w-7 text-white" />
    </PremiumIcon>
  );
}

function MFSIcon() {
  return (
    <PremiumIcon gradient="linear-gradient(135deg, #e91e8c, #f97316)">
      <Smartphone className="h-7 w-7 text-white" />
    </PremiumIcon>
  );
}

function OnlineIcon() {
  return (
    <PremiumIcon gradient="linear-gradient(135deg, #3b82f6, #06b6d4)" size="md">
      <Globe className="h-6 w-6 text-white" />
    </PremiumIcon>
  );
}

function ATMIcon() {
  return (
    <PremiumIcon gradient="linear-gradient(135deg, #8b5cf6, #a855f7)" size="md">
      <CreditCard className="h-6 w-6 text-white" />
    </PremiumIcon>
  );
}

function CashIcon() {
  return (
    <PremiumIcon gradient="linear-gradient(135deg, #10b981, #059669)" size="md">
      <Banknote className="h-6 w-6 text-white" />
    </PremiumIcon>
  );
}

export function ClientTopUp() {
  const isMobile = useIsMobile();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const isInactive = (profile as any)?.status === "inactive";
  const agencyId = (profile as any)?.agency_id;

  const { data: agencyWalletData } = useQuery({
    queryKey: ["agency-wallet-check", agencyId],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("balance").eq("agency_id", agencyId!).single();
      return data;
    },
    enabled: !!agencyId,
  });
  const agencyBlocked = agencyId && agencyWalletData && Number(agencyWalletData.balance) <= 0;

  // Wizard state
  const [step, setStep] = useState(0);
  const [targetWallet, setTargetWallet] = useState<"primary" | "secondary" | "credit_line">("primary");

  const [category, setCategory] = useState<PaymentCategory | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [selectedBank, setSelectedBank] = useState("");
  const [bdtAmount, setBdtAmount] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [duplicateRefError, setDuplicateRefError] = useState<string | null>(null);
  const [accountVerified, setAccountVerified] = useState<boolean | null>(null);
  const [ocrAmountRaw, setOcrAmountRaw] = useState<number | null>(null);
  const [ocrReference, setOcrReference] = useState("");
  const [ocrRawData, setOcrRawData] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: assignedBanks } = useQuery({
    queryKey: ["client-assigned-banks", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any).from("client_banks").select("*, bank_accounts(*)").eq("user_id", user!.id);
      return (data as any[]) ?? [];
    },
    enabled: !!user,
  });
  const selectedBankDetails = assignedBanks?.find((cb: any) => cb.bank_account_id === selectedBank)?.bank_accounts;
  const selectedBankDetailsRef = useRef<any>(null);
  const paymentMethodRef = useRef<PaymentMethod | null>(null);

  useEffect(() => {
    selectedBankDetailsRef.current = selectedBankDetails;
    paymentMethodRef.current = paymentMethod;
  }, [selectedBankDetails, paymentMethod]);

  // LOCKED: amount mismatch guard. If OCR extracted an amount and the user-entered
  // amount differs by > 15 BDT, block submit. This prevents wrong-screenshot approvals
  // (e.g. uploading a 5k receipt while requesting 30k). Do NOT remove without owner approval.
  const amountMismatch =
    ocrAmountRaw !== null && ocrAmountRaw > 0 && !!bdtAmount &&
    Math.abs(parseFloat(bdtAmount) - ocrAmountRaw) > 15;
  const refMismatch = !!proofFile && !ocrLoading && (
    !ocrReference.trim() || !paymentRef.trim() || normalizePaymentRef(ocrReference) !== normalizePaymentRef(paymentRef)
  );

  // MFS charge rates
  const getMFSChargeRate = (bankName: string): number => {
    if (/bkash/i.test(bankName)) return 0.0185; // 1.85%
    if (/nagad/i.test(bankName)) return 0.015;   // 1.5%
    return 0;
  };

  // Compress image before OCR + upload to drastically cut AI tokens & storage cost.
  // Keeps text legibility (max 1600px) but typically 70-85% smaller than original.
  const compressImage = async (file: File): Promise<{ file: File; dataUrl: string }> => {
    try {
      if (!file.type.startsWith("image/") || file.type === "image/gif") {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((res, rej) => {
          reader.onload = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        return { file, dataUrl };
      }
      const bitmap = await createImageBitmap(file);
      const MAX = 1100;
      let { width, height } = bitmap;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas ctx");
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.62),
      );
      // Only use compressed if it's actually smaller
      if (blob.size >= file.size) {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((res, rej) => {
          reader.onload = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        return { file, dataUrl };
      }
      const compressed = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(compressed);
      });
      return { file: compressed, dataUrl };
    } catch (e) {
      console.warn("compressImage failed, using original", e);
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      return { file, dataUrl };
    }
  };

  // Pure client-side verification — mirrors the locked server first3+last4 rule.
  // Used both after OCR completes AND when the user changes the selected bank later.
  const verifyAccountFromData = (data: any, bankAcctNum: string | null | undefined, methodForVerification: PaymentMethod | null = paymentMethod): boolean | null => {
    if (!data) return null;
    const target = String(bankAcctNum || "").replace(/\D/g, "");
    if (target.length < 6) return null;
    const first3 = target.slice(0, 3);
    const first4 = target.slice(0, 4);
    const last4 = target.slice(-4);
    const last3 = target.slice(-3);
    // Relaxed (first4 + last3) allowed when:
    //  (a) user explicitly chose bKash/Nagad → Bank sub-method, OR
    //  (b) OCR detected the source as bKash/Nagad AND destination is a real bank (not MFS).
    const ocrText = [data?.bank_name, data?.source, data?.reference, data?.account_holder_name]
      .filter(Boolean).map(String).join(" ");
    const ocrMentionsMFS = /bkash|bikash|বিকাশ|nagad|নগদ/i.test(ocrText);
    const destBankName = String((selectedBankDetailsRef.current as any)?.bank_name || "");
    const destIsBank = destBankName ? !isMFS(destBankName) : true;
    const allowFirst4Last3 =
      methodForVerification === "mfs_to_bank" || (ocrMentionsMFS && destIsBank);
    const ocrAcct = String(data?.account_number || "").replace(/\D/g, "");
    const matches = (d: string) => {
      if (!d) return false;
      if (d === target || d.includes(target)) return true;
      if (d.length >= 7 && d.startsWith(first3) && d.endsWith(last4)) return true;
      if (allowFirst4Last3 && d.length >= 7 && d.startsWith(first4) && d.endsWith(last3)) return true;
      return false;
    };
    if (typeof data?.account_verified === 'boolean' && data.account_verified) return true;
    if (matches(ocrAcct)) return true;
    const allDigits = [data?.account_number, data?.account_holder_name, data?.bank_name, data?.reference]
      .filter(Boolean).map(String).join(" ").replace(/\D/g, "");
    if (allDigits.includes(target)) return true;
    if (new RegExp(`${first3}\\d{0,20}${last4}`).test(allDigits)) return true;
    if (allowFirst4Last3 && new RegExp(`${first4}\\d{0,20}${last3}`).test(allDigits)) return true;
    return false;
  };

  // OCR extraction from screenshot
  const runOcrExtraction = async (file: File) => {
    // Snapshot the bank at call-time so the value used by OCR matches what UI shows.
    const bankSnapshot = selectedBankDetailsRef.current;
    const paymentMethodSnapshot = paymentMethodRef.current;
    if (!bankSnapshot?.account_number) {
      toast.error("প্রথমে bank/payment method select করুন, তারপর screenshot upload করুন।");
      return;
    }
    setOcrLoading(true);
    setAccountVerified(null);
    setOcrReference("");
    setOcrRawData(null);
    try {
      const { file: compressedFile, dataUrl } = await compressImage(file);
      if (compressedFile !== file) {
        setProofFile(compressedFile);
      }

      const { data, error } = await supabase.functions.invoke('ocr-seller-payment', {
        body: {
          image_url: dataUrl,
          verify_account_number: bankSnapshot.account_number,
          allow_first3_last3: paymentMethodSnapshot === "mfs_to_bank",
          fast: true,
        },
      });
      if (error) throw error;
      setOcrRawData(data);
      const extractedRef = String(data?.reference || "").trim();
      setOcrReference(extractedRef);
      if (extractedRef) {
        setPaymentRef(extractedRef);
        toast.success("Transaction ID auto-filled from screenshot!");
      }
      if (data?.bdt_amount) {
        const finalAmount = Number(data.bdt_amount);
        setOcrAmountRaw(finalAmount);
        if (bankSnapshot && isMFS(bankSnapshot.bank_name)) {
          toast.info(`প্রাপ্ত পরিমাণ (চার্জ বাদে): ৳${finalAmount.toLocaleString()}`);
        }
        setBdtAmount(String(finalAmount));
      } else {
        setOcrAmountRaw(0);
      }
      const verified = verifyAccountFromData(data, bankSnapshot.account_number, paymentMethodSnapshot);
      if (verified === true) {
        setAccountVerified(true);
        toast.success("✅ অ্যাকাউন্ট নম্বর verified!");
      } else if (verified === false) {
        setAccountVerified(false);
        toast.error("⚠️ Screenshot এ নির্বাচিত অ্যাকাউন্ট নম্বর পাওয়া যায়নি! সঠিক bank select করেছেন কিনা check করুন।");
      } else {
        setAccountVerified(null);
      }
    } catch (err: any) {
      console.error("OCR extraction failed:", err);
      setOcrAmountRaw(0);
      setOcrReference("");
      const message = typeof err?.message === "string" ? err.message : "";
      if (message.includes("401") || message.toLowerCase().includes("unauthorized")) {
        toast.error("Session invalid. অনুগ্রহ করে আবার login করে চেষ্টা করুন।");
      } else {
        toast.error("Screenshot থেকে তথ্য বের করা যায়নি। ম্যানুয়ালি পূরণ করুন।");
      }
    } finally {
      setOcrLoading(false);
    }
  };

  // Re-verify account when bank selection changes (no OCR re-call → no token cost).
  useEffect(() => {
    if (!ocrRawData || !selectedBankDetails?.account_number) return;
    const verified = verifyAccountFromData(ocrRawData, selectedBankDetails.account_number);
    if (verified === true) {
      setAccountVerified(true);
    } else if (verified === false) {
      setAccountVerified(false);
    } else {
      setAccountVerified(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBank, paymentMethod]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("File size must be under 5MB"); return; }
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
    runOcrExtraction(file);
  };

  const clearFile = () => {
    setProofFile(null);
    setProofPreview(null);
    setAccountVerified(null);
    setOcrAmountRaw(null);
    setOcrReference("");
    setOcrRawData(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { toast.error("File size must be under 5MB"); return; }
        setProofFile(file);
        setProofPreview(URL.createObjectURL(file));
        toast.success("Screenshot pasted!");
        runOcrExtraction(file);
        return;
      }
    }
  }, []);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  // Duplicate reference check
  // LOCKED: same TXN ID can never be reused — checks across ALL statuses
  // (pending, approved, hold, rejected). Do NOT narrow this filter.
  const checkDuplicateRef = async (ref: string): Promise<boolean> => {
    if (!ref.trim()) return false;
    const { data } = await supabase
      .from("top_up_requests")
      .select("id, status")
      .eq("payment_reference", ref.trim())
      .limit(1);
    return (data?.length ?? 0) > 0;
  };

  // Clear duplicate error when ref changes
  useEffect(() => {
    setDuplicateRefError(null);
  }, [paymentRef]);

  // Queries
  const { data: usdRate } = useQuery({
    queryKey: ["usd-rate", user?.id],
    queryFn: async () => {
      const { data: freshProfile } = await supabase.from("profiles").select("usd_rate").eq("user_id", user!.id).single();
      const clientRate = freshProfile?.usd_rate;
      if (clientRate != null && clientRate > 0) return Number(clientRate);
      const { data } = await supabase.from("site_settings").select("value").eq("key", "usd_rate").maybeSingle();
      return Number(data?.value ?? 0) || 0;
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchOnMount: "always",
  });

  const { data: wallet } = useQuery({
    queryKey: ["client-wallet", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("balance").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: myRequests } = useQuery({
    queryKey: ["client-topup-history", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("top_up_requests").select("*").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(1000);
      return data ?? [];
    },
    enabled: !!user,
  });

  const reviewerIds = [...new Set((myRequests ?? []).map((r: any) => r.reviewed_by).filter(Boolean))];
  const { data: reviewerProfiles } = useQuery({
    queryKey: ["reviewer-profiles", reviewerIds.join(",")],
    queryFn: async () => {
      if (reviewerIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", reviewerIds);
      return (data as any[]) ?? [];
    },
    enabled: reviewerIds.length > 0,
  });

  // Realtime
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("client-topup-realtime").on("postgres_changes", { event: "*", schema: "public", table: "top_up_requests", filter: `user_id=eq.${user.id}` }, () => {
      queryClient.invalidateQueries({ queryKey: ["client-topup-history", user.id] });
      queryClient.invalidateQueries({ queryKey: ["client-wallet"] });
      queryClient.invalidateQueries({ queryKey: ["client-pending-topups"] });
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, queryClient]);

  // Google Sheet card-bill adjustment was removed — no card due is ever applied.
  const cardDueBdt = 0;

  // Payment allocation preview: main wallet due → sheet bill → secondary wallet due → wallet credit
  const wallets = useWallets(user?.id);

  // Only clients an admin explicitly allows may deposit straight into the secondary wallet.
  const { data: secondaryDepositAllowed } = useQuery({
    queryKey: ["secondary-deposit-enabled", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("secondary_deposit_enabled")
        .eq("user_id", user!.id)
        .maybeSingle();
      return !!data?.secondary_deposit_enabled;
    },
  });

  // Wallets a client may deposit into: main (when switched on for this
  // client), plus each extra wallet that is switched on.
  const walletOptions = useMemo(() => {
    const opts: { kind: "primary" | "secondary" | "credit_line"; label: string; rate: number; hint: string }[] = [];
    if (wallets.mainEnabled)
      opts.push({ kind: "primary", label: "Main wallet", rate: Number(usdRate) || 0, hint: "Due adjust + advance" });
    if (wallets.creditLineEnabled)
      opts.push({
        kind: "credit_line",
        label: "Credit line wallet",
        rate: wallets.creditLineRate || Number(usdRate) || 0,
        hint: "Credit line rate",
      });
    if (secondaryDepositAllowed && wallets.secondaryEnabled)
      opts.push({
        kind: "secondary",
        label: "Secondary wallet",
        rate: wallets.secondaryRate || Number(usdRate) || 0,
        hint: "Sheet rate",
      });
    return opts;
  }, [usdRate, wallets.mainEnabled, wallets.creditLineEnabled, wallets.creditLineRate, wallets.secondaryEnabled, wallets.secondaryRate, secondaryDepositAllowed]);

  const canPickWallet = walletOptions.length > 1;
  // Fall back to the first available wallet (e.g. credit line) when the
  // previously picked one is not offered — e.g. main wallet is switched off.
  const effectiveTargetWallet: "primary" | "secondary" | "credit_line" =
    walletOptions.some((o) => o.kind === targetWallet)
      ? targetWallet
      : (walletOptions[0]?.kind ?? "primary");
  // Deposits straight into an extra wallet skip the main-wallet due / card-bill flow.
  const isSecondaryDeposit = effectiveTargetWallet !== "primary";
  const targetWalletLabel =
    walletOptions.find((o) => o.kind === effectiveTargetWallet)?.label ?? "Main wallet";

  // Deposit rate: each wallet converts at its own USD rate.
  const depositRate =
    walletOptions.find((o) => o.kind === effectiveTargetWallet)?.rate || Number(usdRate) || 0;

  // Extra-wallet deposits are credited in full to that wallet; the card
  // bill / main-wallet due adjustment only applies to main wallet deposits.
  const effectiveBdt = bdtAmount
    ? (isSecondaryDeposit ? parseFloat(bdtAmount) : Math.max(0, parseFloat(bdtAmount) - cardDueBdt))
    : 0;
  // Same rounding rule as the server: round to 2 decimals so the credited USD matches exactly.
  const usdEquivalent =
    bdtAmount && depositRate ? (Math.round((effectiveBdt / depositRate) * 100) / 100).toFixed(2) : "0.00";

  const alloc = useMemo(() => {
    const total = parseFloat(bdtAmount) || 0;
    const rate = depositRate || 1;
    let rem = total;

    if (isSecondaryDeposit) {
      // Whole payment lands in the secondary (sheet-rate) wallet. Any secondary
      // due is cleared automatically by the credit itself.
      return {
        total,
        rate,
        mainDueBdt: 0,
        mainDuePaid: 0,
        sheetPaid: 0,
        secDueBdt: 0,
        secDuePaid: 0,
        creditBdt: total,
        creditUsd: total / rate,
      };
    }

    const mainDueBdt = Math.max(0, -wallets.mainBalance) * (wallets.mainRate || rate);
    const mainDuePaid = Math.min(mainDueBdt, rem);
    rem -= mainDuePaid;
    const sheetPaid = Math.min(cardDueBdt, rem);
    rem -= sheetPaid;
    const secDueBdt = wallets.secondaryEnabled
      ? Math.max(0, -wallets.secondaryBalance) * (wallets.secondaryRate || rate)
      : 0;
    const secDuePaid = Math.min(secDueBdt, rem);
    rem -= secDuePaid;
    return {
      total,
      rate,
      mainDueBdt,
      mainDuePaid,
      sheetPaid,
      secDueBdt,
      secDuePaid,
      creditBdt: rem,
      creditUsd: rem / rate,
    };
  }, [bdtAmount, depositRate, isSecondaryDeposit, cardDueBdt, wallets.mainBalance, wallets.mainRate, wallets.secondaryBalance, wallets.secondaryRate, wallets.secondaryEnabled]);



  const bdt = (n: number) => `৳${Math.round(n).toLocaleString()}`;

  const AllocationBreakdown = ({ compact = false }: { compact?: boolean }) => {
    if (!alloc.total) return null;
    const rows: { label: string; value: string; cls: string }[] = [
      { label: "মোট পেমেন্ট", value: bdt(alloc.total), cls: "font-semibold" },
    ];
    if (alloc.mainDueBdt > 0)
      rows.push({
        label: `Main wallet due adjust (due ${bdt(alloc.mainDueBdt)})`,
        value: `-${bdt(alloc.mainDuePaid)}`,
        cls: "text-blue-600 font-semibold",
      });
    if (cardDueBdt > 0)
      rows.push({
        label: `Sheet / card bill adjust (due ${bdt(cardDueBdt)})`,
        value: `-${bdt(alloc.sheetPaid)}`,
        cls: "text-amber-600 font-semibold",
      });
    if (alloc.secDueBdt > 0)
      rows.push({
        label: `Secondary wallet bill adjust (due ${bdt(alloc.secDueBdt)})`,
        value: `-${bdt(alloc.secDuePaid)}`,
        cls: "text-emerald-600 font-semibold",
      });
    return (
      <div className={cn("rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1.5", compact && "p-2.5")}>
        <p className="text-[11px] font-semibold text-muted-foreground">Payment Adjustment Details</p>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{r.label}</span>
            <span className={r.cls}>{r.value}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1.5 text-xs">
          <span className="text-muted-foreground">{`${targetWalletLabel}-এ জমা হবে`}</span>
          <span className="font-bold text-primary">
            ${alloc.creditUsd.toFixed(2)} <span className="font-normal text-muted-foreground">({bdt(alloc.creditBdt)})</span>
          </span>
        </div>
      </div>
    );
  };

  // Filter banks by category
  const filteredBanks = assignedBanks?.filter((cb: any) => {
    const bank = cb.bank_accounts;
    if (!bank) return false;
    if (category === "mfs") return isMFS(bank.bank_name);
    if (category === "bank") return !isMFS(bank.bank_name);
    return true;
  }) ?? [];

  // Check if MFS banks exist
  const hasMFSBanks = assignedBanks?.some((cb: any) => cb.bank_accounts && isMFS(cb.bank_accounts.bank_name)) ?? false;
  const hasBankBanks = assignedBanks?.some((cb: any) => cb.bank_accounts && !isMFS(cb.bank_accounts.bank_name)) ?? false;

  const fetchTelegramFirst = async () => {
    try { await supabase.functions.invoke('telegram-poll', { body: { quick: true } }); } catch (err) { console.log('telegram-poll pre-fetch skipped:', err); }
  };

  const verifyWithRetry = async (requestId: string, attempt = 1) => {
    const maxRetries = 4;
    const retryDelayMs = 3 * 60 * 1000;
    try {
      await fetchTelegramFirst();
      const { data, error } = await supabase.functions.invoke('verify-topup', { body: { request_id: requestId } });
      if (error) throw error;
      if (data?.auto_approved) { toast.success("Payment auto-approved! ✅"); queryClient.invalidateQueries({ queryKey: ["client-topup-history"] }); queryClient.invalidateQueries({ queryKey: ["client-wallet"] }); return; }
      if (attempt < maxRetries) { toast.info(`Verifying payment... retry ${attempt}/${maxRetries} in 3 min`); setTimeout(() => verifyWithRetry(requestId, attempt + 1), retryDelayMs); return; }
      toast.info("Payment pending manual review by admin.");
    } catch (err) {
      console.warn('verify-topup error (silent):', err);
      if (attempt < maxRetries) { setTimeout(() => verifyWithRetry(requestId, attempt + 1), retryDelayMs); }
    }
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      const isCashDeposit = paymentMethod === "cash_deposit";
      // LOCKED: Transaction ID is required for all methods EXCEPT cash_deposit.
      // Cash deposit slips don't have a printed TrxID — only handwritten serials.
      if (!isCashDeposit && !paymentRef?.trim()) {
        toast.error("Transaction ID আবশ্যক — Screenshot এ TrxID না পেলে ম্যানুয়ালি টাইপ করুন।");
        throw new Error("Missing transaction ID");
      }
      if (!proofFile) throw new Error("Payment proof screenshot is required");
      if (ocrLoading) throw new Error("OCR এখনো চলছে — একটু অপেক্ষা করুন");
      if (ocrAmountRaw === null || ocrAmountRaw <= 0) throw new Error("Screenshot থেকে amount পড়া যায়নি। স্পষ্ট receipt screenshot আপলোড করুন।");
      if (amountMismatch) throw new Error("Screenshot amount এবং submitted amount মিলছে না");
      if (!isCashDeposit && refMismatch) throw new Error("Screenshot TrxID এবং submitted TrxID মিলছে না");
      if (accountVerified !== true) throw new Error("Screenshot এ selected account number verify হয়নি");
      // Check for duplicate payment reference (skip for cash deposit — no real TrxID)
      if (!isCashDeposit && paymentRef?.trim()) {
        const isDuplicate = await checkDuplicateRef(paymentRef);
        if (isDuplicate) {
          setDuplicateRefError("এই Transaction ID দিয়ে ইতোমধ্যে একটি request আছে। একই TXN ID দিয়ে দুইবার request করা যাবে না।");
          throw new Error("Duplicate transaction reference. This TXN ID has already been used.");
        }
      }
      let proofUrl: string | null = null;
      if (proofFile) {
        const ext = proofFile.name.split(".").pop();
        const filePath = `${user!.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(filePath, proofFile);
        if (uploadError) throw uploadError;
        proofUrl = await createProofUrl(filePath);
      }
      const { data: inserted, error } = await supabase.from("top_up_requests").insert({
        user_id: user!.id,
        amount: parseFloat(usdEquivalent),
        bdt_amount: parseFloat(bdtAmount),
        usd_rate: depositRate,
        target_wallet: effectiveTargetWallet,
        bank_account_id: selectedBank,
        payment_reference: paymentRef || null,
        payment_method: paymentMethod === "online_transfer" ? "bank_transfer" : paymentMethod,
        proof_url: proofUrl,
      } as any).select("id").single();
      if (error) throw error;
      if (inserted?.id) {
        // Fire-and-forget — never let verification errors bubble up to the mutation
        setTimeout(() => { try { verifyWithRetry(inserted.id); } catch (e) { console.warn(e); } }, 0);
      }
    },
    onSuccess: () => {
      toast.success("Top-up request submitted! Verifying payment...");
      logSystemAction("Top-Up Submitted", `$${usdEquivalent} (৳${bdtAmount})`, user!.id, profile?.full_name || user!.email);
      queryClient.invalidateQueries({ queryKey: ["client-pending-topups"] });
      queryClient.invalidateQueries({ queryKey: ["client-topup-history"] });
      setStep(0);
      setBdtAmount("");
      setSelectedBank("");
      setPaymentRef("");
      setPaymentMethod(null);
      setCategory(null);
      setTargetWallet("primary");

      clearFile();
    },
    onError: (err: any) => {
      const msg = String(err?.message || err || "");
      // Suppress transient network noise from background verification calls
      if (/failed to fetch/i.test(msg)) return;
      toast.error(msg);
    },
  });

  const methodLabel = (m: PaymentMethod | null) => {
    if (m === "online_transfer") return "Online Bank Transfer";
    if (m === "mfs_to_bank") return "bKash/Nagad to Bank";
    if (m === "npsb") return "NPSB";
    if (m === "atm_deposit") return "ATM Deposit";
    if (m === "cash_deposit") return "Cash Deposit";
    return "";
  };

  const getBkashColor = (name: string) => {
    if (/bkash/i.test(name)) return { bg: "linear-gradient(135deg, #E2136E, #c41060)", border: "#E2136E" };
    if (/nagad/i.test(name)) return { bg: "linear-gradient(135deg, #F6921E, #e07d0a)", border: "#F6921E" };
    return { bg: "linear-gradient(135deg, #6366f1, #4f46e5)", border: "#6366f1" };
  };

  // Step Progress
  const StepIndicator = () => (
    <div className="flex items-center justify-center gap-1 mb-6">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const isCompleted = i < step;
        const isCurrent = i === step;
        return (
          <div key={i} className="flex items-center gap-1">
            <div className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all",
              isCurrent && "bg-primary text-primary-foreground shadow-sm",
              isCompleted && "bg-primary/15 text-primary",
              !isCurrent && !isCompleted && "bg-muted text-muted-foreground"
            )}>
              <Icon className="h-3.5 w-3.5" />
              {!isMobile && <span>{s.label}</span>}
            </div>
            {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        );
      })}
    </div>
  );

  // Header bar
  const HeaderBar = () => (
    <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" />
        <span className="text-sm font-medium">Balance: <span className="text-lg font-bold text-primary">${Number(wallet?.balance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></span>
      </div>
      <div className="flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">Rate: <span className="font-semibold">৳{usdRate}</span>/USD</span>
      </div>
    </div>
  );

  return (
    <div data-tutorial="topup-form" className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <ArrowUpCircle className="h-5 w-5 md:h-6 md:w-6 text-primary" />
          Top-Up Wallet
        </h1>
      </div>

      {isInactive && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="text-destructive font-semibold">⚠️ Your account was frozen for violating our policy. You cannot submit top-up requests.</span>
          </CardContent>
        </Card>
      )}

      <HeaderBar />
      <StepIndicator />

      {/* Step 0: Select Category */}
      {step === 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Choose Payment Type</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Bank Transfer Category */}
            {hasBankBanks && (
              <Card
                className={cn(
                  "cursor-pointer transition-all hover:shadow-xl active:scale-[0.97] border-2 overflow-hidden",
                  category === "bank" ? "border-primary bg-primary/5 shadow-xl" : "border-border hover:border-primary/60"
                )}
                onClick={() => { setCategory("bank"); setStep(0.5 as any); }}
              >
                <CardContent className="p-6 flex items-center gap-5">
                  <BankTransferIcon />
                  <div className="flex-1">
                    <p className="font-bold text-base">Bank Transfer</p>
                    <p className="text-sm text-muted-foreground mt-1">Online, ATM & Cash deposit</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            )}

            {/* MFS Category */}
            {hasMFSBanks && (
              <Card
                className={cn(
                  "cursor-pointer transition-all hover:shadow-xl active:scale-[0.97] border-2 overflow-hidden",
                  category === "mfs" ? "border-primary bg-primary/5 shadow-xl" : "border-border hover:border-primary/60"
                )}
                onClick={() => { setCategory("mfs"); setPaymentMethod("online_transfer"); setStep(1); }}
              >
                <CardContent className="p-6 flex items-center gap-5">
                  <MFSIcon />
                  <div className="flex-1">
                    <p className="font-bold text-base">MFS</p>
                    <p className="text-sm text-muted-foreground mt-1">bKash, Nagad</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Step 0.5: Select Bank Sub-method */}
      {(step as number) === 0.5 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setStep(0); setCategory(null); }} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <h2 className="text-lg font-semibold">Select Transfer Method</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              { value: "online_transfer" as PaymentMethod, label: "Online Transfer", desc: "Internet / Mobile / NPSB / MFS→Bank", IconComp: OnlineIcon, isOnline: true },
              { value: "atm_deposit" as PaymentMethod, label: "ATM Deposit", desc: "Deposit via ATM", IconComp: ATMIcon },
              { value: "cash_deposit" as PaymentMethod, label: "Cash Deposit", desc: "Bank branch deposit", IconComp: CashIcon },
            ]).map((m) => (
              <Card
                key={m.value}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-lg active:scale-[0.97] border-2",
                  (paymentMethod === m.value || (m.isOnline && (paymentMethod === "mfs_to_bank" || paymentMethod === "npsb"))) ? "border-primary bg-primary/5 shadow-lg" : "border-border hover:border-primary/40"
                )}
                onClick={() => {
                  if (m.isOnline) { setPaymentMethod("online_transfer"); setStep(0.6 as any); }
                  else { setPaymentMethod(m.value); setStep(1); }
                }}
              >
                <CardContent className="p-5 flex flex-col items-center text-center gap-3">
                  <m.IconComp />
                  <div>
                    <p className="font-bold text-sm">{m.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Step 0.6: Online Transfer sub-method */}
      {(step as number) === 0.6 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setStep(0.5 as any); setPaymentMethod(null); }} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <h2 className="text-lg font-semibold">Online Transfer Type</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              { value: "npsb" as PaymentMethod, label: "NPSB", desc: "Inter-bank NPSB transfer", IconComp: OnlineIcon },
              { value: "mfs_to_bank" as PaymentMethod, label: "bKash/Nagad → Bank", desc: "MFS to bank transfer", IconComp: MFSIcon },
            ]).map((m) => (
              <Card
                key={m.value}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-lg active:scale-[0.97] border-2",
                  paymentMethod === m.value ? "border-primary bg-primary/5 shadow-lg" : "border-border hover:border-primary/40"
                )}
                onClick={() => { setPaymentMethod(m.value); setStep(1); }}
              >
                <CardContent className="p-5 flex flex-col items-center text-center gap-3">
                  <m.IconComp />
                  <div>
                    <p className="font-bold text-sm">{m.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Select Bank */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => {
              if (category === "mfs") { setStep(0); setCategory(null); setPaymentMethod(null); }
              else if (paymentMethod === "mfs_to_bank" || paymentMethod === "npsb") { setStep(0.6 as any); }
              else { setStep(0.5 as any); }
            }} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <h2 className="text-lg font-semibold">
              {category === "mfs" ? "Select MFS Account" : "Select Payment Bank"}
            </h2>
          </div>

          {filteredBanks.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {category === "mfs" ? "No MFS accounts assigned. Contact your admin." : "No banks assigned. Contact your admin."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredBanks.map((cb: any) => {
                const bank = cb.bank_accounts;
                if (!bank) return null;
                const isSelected = selectedBank === cb.bank_account_id;
                const mfsColors = category === "mfs" ? getBkashColor(bank.bank_name) : null;

                return (
                  <Card
                    key={cb.bank_account_id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-lg active:scale-[0.97] border-2 overflow-hidden",
                      isSelected
                        ? mfsColors ? "shadow-lg" : "border-primary bg-primary/5 shadow-lg"
                        : mfsColors ? "hover:shadow-lg" : "border-border hover:border-primary/40"
                    )}
                    style={mfsColors ? {
                      borderColor: isSelected ? mfsColors.border : undefined,
                      background: isSelected ? `${mfsColors.border}08` : undefined,
                    } : undefined}
                    onClick={() => { setSelectedBank(cb.bank_account_id); setStep(2); }}
                  >
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center gap-4">
                        {category === "mfs" ? (
                          <div className="h-12 w-12 rounded-xl flex items-center justify-center shadow-md shrink-0" style={{ background: mfsColors?.bg }}>
                            <Smartphone className="h-6 w-6 text-white" />
                          </div>
                        ) : bank.logo_url ? (
                          <img src={bank.logo_url} alt={bank.bank_name} className="h-12 w-12 rounded-xl border object-contain bg-white shrink-0" />
                        ) : (
                          <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                            <Building2 className="h-6 w-6 text-blue-600" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-base">{bank.bank_name}</p>
                          <p className="text-sm text-muted-foreground">{bank.account_name}</p>
                        </div>
                      </div>
                      <div className="text-sm space-y-1 text-muted-foreground pl-16">
                        <p className="flex items-center gap-2">{category === "mfs" ? "Number" : "A/C"}: <span className="font-mono font-semibold text-foreground text-base select-all">{bank.account_number}</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(bank.account_number); toast.success("Account number copied!"); }} className="p-1 rounded hover:bg-accent"><Copy className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        </p>
                        <p className="flex items-center gap-2">Name: <span className="font-medium text-foreground select-all">{bank.account_name}</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(bank.account_name); toast.success("Account name copied!"); }} className="p-1 rounded hover:bg-accent"><Copy className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        </p>
                        {bank.branch && <p>Branch: {bank.branch}</p>}
                        {bank.routing_number && <p>Routing: {bank.routing_number}</p>}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const lines = [
                              `Bank: ${bank.bank_name}`,
                              `Account Name: ${bank.account_name}`,
                              `${category === "mfs" ? "Number" : "A/C"}: ${bank.account_number}`,
                              bank.branch ? `Branch: ${bank.branch}` : null,
                              bank.routing_number ? `Routing: ${bank.routing_number}` : null,
                            ].filter(Boolean).join("\n");
                            navigator.clipboard.writeText(lines);
                            toast.success("All bank info copied!");
                          }}
                          className="text-xs font-medium flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-background hover:bg-accent transition-colors"
                        >
                          <Copy className="h-3 w-3" /> Copy All
                        </button>
                        <span className="text-xs font-semibold flex items-center gap-1" style={{ color: mfsColors?.border || "hsl(var(--primary))" }}>
                          Select <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Payment Details */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <h2 className="text-lg font-semibold">Payment Details</h2>
          </div>

          {/* Selected bank summary */}
          {selectedBankDetails && (
            <Card className="bg-muted/50 border">
              <CardContent className="p-4 flex items-center gap-4">
                {category === "mfs" ? (
                  <div className="h-11 w-11 rounded-xl flex items-center justify-center shadow-sm shrink-0" style={{ background: getBkashColor(selectedBankDetails.bank_name).bg }}>
                    <Smartphone className="h-5 w-5 text-white" />
                  </div>
                ) : selectedBankDetails.logo_url ? (
                  <img src={selectedBankDetails.logo_url} alt="" className="h-11 w-11 rounded-xl border object-contain bg-white shrink-0" />
                ) : (
                  <div className="h-11 w-11 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                    <Building2 className="h-5 w-5 text-blue-600" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold">{selectedBankDetails.bank_name}</p>
                  <p className="text-sm text-muted-foreground">{selectedBankDetails.account_name} — <span className="font-mono">{selectedBankDetails.account_number}</span></p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Screenshot first - for OCR auto-fill */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" />
              Payment Screenshot
              <span className="text-xs font-normal text-muted-foreground">(upload first to auto-fill)</span>
            </Label>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            {!proofPreview ? (
              <Button type="button" variant="outline" className="w-full border-dashed border-2 border-primary/30 h-32 flex flex-col gap-2 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all" onClick={() => fileInputRef.current?.click()}>
                <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
                  <ImageIcon className="h-5 w-5 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground">Click to attach or Ctrl+V to paste</span>
              </Button>
            ) : (
              <div className="relative inline-block">
                <img src={proofPreview} alt="Payment proof" className="max-h-44 rounded-lg border shadow-sm" />
                <button type="button" onClick={clearFile} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 shadow">
                  <X className="h-3.5 w-3.5" />
                </button>
                {ocrLoading && (
                  <div className="absolute inset-0 bg-background/60 rounded-lg flex items-center justify-center">
                    <div className="flex items-center gap-2 bg-background rounded-full px-3 py-1.5 shadow-md border">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-xs font-medium">Extracting info...</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Account verification status */}
            {accountVerified === true && (
              <p className="text-xs text-green-600 font-medium flex items-center gap-1 mt-1">
                <Check className="h-3 w-3" /> অ্যাকাউন্ট নম্বর screenshot এ verified
              </p>
            )}
            {accountVerified === false && (
              <div className="mt-1 p-2 rounded-md bg-destructive/10 border border-destructive/30">
                <p className="text-xs text-destructive font-medium">
                  ⚠️ নির্বাচিত অ্যাকাউন্ট নম্বর ({selectedBankDetails?.account_number}) screenshot এ পাওয়া যায়নি। সঠিক screenshot আপলোড করুন।
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Amount */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Amount (BDT) <span className="text-xs font-normal text-muted-foreground">(edit if needed)</span></Label>
                <Input type="number" min="1" step="1" value={bdtAmount} onChange={(e) => setBdtAmount(e.target.value)} placeholder="10000" className="text-lg" />
                {selectedBankDetails && isMFS(selectedBankDetails.bank_name) && bdtAmount && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">💡 MFS charge বাদ দেওয়া হয়েছে। ভুল হলে সঠিক amount দিন।</p>
                )}
                <p className="text-xs text-muted-foreground">Minimum: ৳500</p>
              </div>

              {canPickWallet && (
                <div className="space-y-2">
                  <Label>Deposit To</Label>
                  <div className={cn("grid gap-2", walletOptions.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
                    {walletOptions.map((o) => (
                      <button
                        key={o.kind}
                        type="button"
                        onClick={() => setTargetWallet(o.kind)}
                        className={cn(
                          "rounded-lg border p-2.5 text-left transition-colors",
                          effectiveTargetWallet === o.kind
                            ? o.kind === "primary"
                              ? "border-primary bg-primary/10"
                              : o.kind === "credit_line"
                                ? "border-sky-500 bg-sky-500/10"
                                : "border-fuchsia-500 bg-fuchsia-500/10"
                            : "border-border/60 hover:bg-muted/50"
                        )}
                      >
                        <p className="text-xs font-semibold">{o.label}</p>
                        <p className="text-[11px] text-muted-foreground">@ ৳{o.rate}/USD ({o.hint})</p>
                        {bdtAmount && parseFloat(bdtAmount) > 0 && o.rate > 0 && (
                          <p className="text-[11px] font-semibold text-foreground mt-0.5">
                            = ${(Math.round((parseFloat(bdtAmount) / o.rate) * 100) / 100).toFixed(2)}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    যে wallet select করবেন, সেই wallet-এর নিজস্ব rate-এ হিসাব হবে।
                  </p>
                </div>
              )}


              {bdtAmount && parseFloat(bdtAmount) > 0 && (
                <div className="space-y-2">
                  {!isSecondaryDeposit && cardDueBdt > 0 && (

                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">⚠️ কার্ড বিল বকেয়া: ৳{cardDueBdt.toLocaleString()}</p>
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="p-1.5 bg-background rounded">
                          <p className="text-[10px] text-muted-foreground">মোট জমা</p>
                          <p className="text-sm font-bold">৳{Number(bdtAmount).toLocaleString()}</p>
                        </div>
                        <div className="p-1.5 bg-background rounded">
                          <p className="text-[10px] text-muted-foreground">কার্ড বিল</p>
                          <p className="text-sm font-bold text-amber-600">-৳{Math.min(cardDueBdt, Number(bdtAmount)).toLocaleString()}</p>
                        </div>
                        <div className="p-1.5 bg-background rounded">
                          <p className="text-[10px] text-muted-foreground">বাকি BDT</p>
                          <p className="text-sm font-bold text-primary">৳{effectiveBdt.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  <AllocationBreakdown />

                  <div className="rounded-lg bg-primary/10 p-4 text-center">
                    <p className="text-xs text-muted-foreground">{isSecondaryDeposit ? `${targetWalletLabel}-এ জমা হবে` : cardDueBdt > 0 ? 'ওয়ালেটে জমা হবে' : 'USD Equivalent'}</p>
                    <p className="text-3xl font-bold text-primary">${usdEquivalent}</p>
                    <p className="text-xs text-muted-foreground">@ ৳{depositRate}/USD{isSecondaryDeposit ? ` (${targetWalletLabel})` : ""}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Transaction Ref */}
            <div className="space-y-2">
                <Label>Transaction Reference / ID <span className="text-xs font-normal text-muted-foreground">(edit if needed)</span></Label>
                <div className="relative">
                  <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="e.g. TXN123456" className={duplicateRefError ? "border-destructive" : ""} />
                  {ocrLoading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
                {duplicateRefError && (
                  <p className="text-xs text-destructive font-medium">{duplicateRefError}</p>
                )}
                {paymentRef && !duplicateRefError && (
                  <p className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <Check className="h-3 w-3" /> Auto-filled — সঠিক না হলে edit করুন
                  </p>
                )}
            </div>
          </div>

          {!proofFile && (
            <p className="text-xs text-destructive font-medium text-center">⚠️ Payment screenshot আপলোড করা বাধ্যতামূলক</p>
          )}
          {amountMismatch && (
            <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30">
              <p className="text-xs text-destructive font-medium">
                ⚠️ Screenshot এর amount (৳{ocrAmountRaw?.toLocaleString()}) আপনার দেওয়া amount (৳{Number(bdtAmount).toLocaleString()}) এর সাথে মিলছে না। সঠিক screenshot আপলোড করুন।
              </p>
            </div>
          )}
          {refMismatch && paymentMethod !== "cash_deposit" && (
            <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30">
              <p className="text-xs text-destructive font-medium">
                ⚠️ Screenshot এর TrxID ({ocrReference || "পাওয়া যায়নি"}) এবং submitted TrxID ({paymentRef || "খালি"}) মিলছে না। সঠিক proof দিন।
              </p>
            </div>
          )}
          {proofFile && ocrAmountRaw === 0 && !ocrLoading && (
            <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30">
              <p className="text-xs text-destructive font-medium">
                ⚠️ Screenshot থেকে amount পড়া যায়নি। স্পষ্ট receipt screenshot আপলোড করুন।
              </p>
            </div>
          )}
          {proofFile && !ocrLoading && accountVerified === false && (
            <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30">
              <p className="text-xs text-destructive font-medium">
                ⚠️ Screenshot এর destination account number ({selectedBankDetails?.account_number}) এর সাথে মিলছে না। সঠিক bank select করুন বা সঠিক receipt আপলোড করুন।
              </p>
            </div>
          )}
          {proofFile && !ocrLoading && accountVerified === null && selectedBankDetails?.account_number && (
            <div className="p-2 rounded-md bg-amber-500/10 border border-amber-500/30">
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                ⚠️ Account verification skipped — screenshot পুনরায় upload করুন।
              </p>
            </div>
          )}
          <Button
            className="w-full"
            onClick={() => setStep(3)}
            disabled={
              !bdtAmount || parseFloat(bdtAmount) <= 0 || !proofFile || ocrLoading ||
              (paymentMethod !== "cash_deposit" && !paymentRef.trim()) ||
              accountVerified !== true ||
              (paymentMethod !== "cash_deposit" && refMismatch) ||
              amountMismatch ||
              ocrAmountRaw === null || ocrAmountRaw <= 0
            }
          >
            Continue to Review <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Step 3: Review & Submit */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(2)} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Edit Details
            </Button>
            <h2 className="text-lg font-semibold">Review & Confirm</h2>
          </div>

          <Card className="border">
            <CardContent className="p-4 space-y-4">
              {/* Method */}
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Payment Method</span>
                <span className="text-sm font-medium">
                  {category === "mfs" ? "MFS Transfer" : methodLabel(paymentMethod)}
                </span>
              </div>

              {/* Bank */}
              {selectedBankDetails && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Payment To</span>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    {category === "mfs" ? (
                      <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: getBkashColor(selectedBankDetails.bank_name).bg }}>
                        <Smartphone className="h-4 w-4 text-white" />
                      </div>
                    ) : selectedBankDetails.logo_url ? (
                      <img src={selectedBankDetails.logo_url} alt="" className="h-9 w-9 rounded-lg border object-contain bg-white shrink-0" />
                    ) : (
                      <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                        <Building2 className="h-4 w-4 text-blue-600" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold">{selectedBankDetails.bank_name}</p>
                      <p className="text-xs text-muted-foreground">{selectedBankDetails.account_name} — {selectedBankDetails.account_number}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Amount */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/50 text-center">
                  <p className="text-xs text-muted-foreground">BDT Amount</p>
                  <p className="text-lg font-bold">৳{Number(bdtAmount).toLocaleString()}</p>
                </div>
                <div className="p-3 rounded-lg bg-primary/10 text-center">
                  <p className="text-xs text-muted-foreground">USD Amount</p>
                  <p className="text-lg font-bold text-primary">${usdEquivalent}</p>
                </div>
              </div>

              <AllocationBreakdown compact />



              {/* Card Bill Due Warning */}
              {!isSecondaryDeposit && cardDueBdt > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-1">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">⚠️ কার্ড বিল বকেয়া</p>
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    আপনার কার্ড বিল বকেয়া: <strong>৳{cardDueBdt.toLocaleString()}</strong>। পেমেন্ট থেকে আগে কার্ড বিল কেটে নেওয়া হবে।
                  </p>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div className="text-center p-2 bg-background rounded">
                      <p className="text-[10px] text-muted-foreground">মোট জমা</p>
                      <p className="text-sm font-bold">৳{bdtAmount ? Number(bdtAmount).toLocaleString() : '0'}</p>
                    </div>
                    <div className="text-center p-2 bg-background rounded">
                      <p className="text-[10px] text-muted-foreground">কার্ড বিল</p>
                      <p className="text-sm font-bold text-amber-600">-৳{cardDueBdt.toLocaleString()}</p>
                    </div>
                    <div className="text-center p-2 bg-background rounded">
                      <p className="text-[10px] text-muted-foreground">ওয়ালেটে</p>
                      <p className="text-sm font-bold text-primary">${usdEquivalent}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Reference */}
              {paymentRef && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Reference</span>
                  <span className="text-sm font-mono font-medium">{paymentRef}</span>
                </div>
              )}

              {/* Proof */}
              {proofPreview && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Payment Proof</span>
                  <img src={proofPreview} alt="Proof" className="max-h-32 rounded-md border" />
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Edit
            </Button>
            <Button
              className="flex-1"
              onClick={() => submitMutation.mutate()}
              disabled={isInactive || !!agencyBlocked || !proofFile || (paymentMethod !== "cash_deposit" && !paymentRef.trim()) || submitMutation.isPending || ocrLoading || amountMismatch || (paymentMethod !== "cash_deposit" && refMismatch) || ocrAmountRaw === null || ocrAmountRaw <= 0 || accountVerified !== true}
            >
              {submitMutation.isPending ? "Submitting..." : isInactive ? "Account Frozen" : agencyBlocked ? "Agency Balance Insufficient" : "Confirm & Submit"}
            </Button>
          </div>
        </div>
      )}

      {/* My Requests History */}
      <Card className="shadow-sm mt-6">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">My Requests</CardTitle>
            <TelegramPollStatus />
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {isMobile ? (
            <div className="space-y-2.5">
              {myRequests?.map((r: any) => (
                <div key={r.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-bold">${Number(r.amount).toLocaleString()}</span>
                      {r.bdt_amount && <span className="text-xs text-muted-foreground ml-1.5">(৳{Number(r.bdt_amount).toLocaleString()})</span>}
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-muted-foreground">{format(new Date(r.created_at), "MMM d, hh:mm a")}</span>
                    {r.payment_reference && <span className="text-[11px] text-muted-foreground">Ref: {r.payment_reference}</span>}
                  </div>
                  {(r.status === "approved" || r.proof_url) && (
                    <div className="flex justify-end gap-1 mt-2">
                      {r.proof_url && (
                        <Button size="sm" variant="ghost" className="gap-1 text-primary hover:underline h-6 px-2 text-xs" onClick={() => openProof(r.proof_url)}>
                          <ImageIcon className="h-3 w-3" />Proof
                        </Button>
                      )}
                      {r.status === "approved" && (
                        <Button size="sm" variant="ghost" className="gap-1 text-primary hover:underline h-6 px-2 text-xs" asChild>
                          <Link to={`/invoice/${r.id}`} target="_blank"><FileText className="h-3 w-3" />Invoice</Link>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {(!myRequests || myRequests.length === 0) && <p className="text-center text-muted-foreground py-6 text-sm">No requests yet</p>}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>BDT</TableHead>
                  <TableHead>USD</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Proof</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myRequests?.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{format(new Date(r.created_at), "MMM d, hh:mm a")}</TableCell>
                    <TableCell>{r.bdt_amount ? `৳${Number(r.bdt_amount).toLocaleString()}` : "—"}</TableCell>
                    <TableCell className="font-semibold">${Number(r.amount).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{r.payment_reference || "—"}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell>
                      {r.proof_url ? (
                        <Button size="sm" variant="ghost" className="gap-1 text-primary hover:underline" onClick={() => openProof(r.proof_url)}>
                          <ImageIcon className="h-3.5 w-3.5" />View
                        </Button>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {r.status === "approved" ? (
                        <Button size="sm" variant="ghost" className="gap-1 text-primary hover:underline" asChild>
                          <Link to={`/invoice/${r.id}`} target="_blank"><FileText className="h-3.5 w-3.5" />Invoice</Link>
                        </Button>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {(!myRequests || myRequests.length === 0) && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No requests yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
