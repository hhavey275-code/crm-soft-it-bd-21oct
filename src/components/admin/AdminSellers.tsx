import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import { DollarSign, Banknote, ImageIcon, UserCog, ArrowLeftRight, Landmark, X, ScanLine, Loader2, Upload, Trash2, Plus, CalendarIcon, Wallet, ArrowDownLeft, ArrowUpRight, RefreshCw, TrendingUp, Clock, CheckCircle2, XCircle, Download } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import { logSystemAction } from "@/lib/systemLog";
import { SellerSubmitUsdtDialog } from "@/components/seller/SellerSubmitUsdtDialog";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";
import { ManageSellerUsdtBanksDialog } from "@/components/admin/ManageSellerUsdtBanksDialog";
// v2026.04.22-balance-display — cache-bust: ensure new TOTAL footer renders
import { computeDueAdvanceRunning, formatDueAdvance, computeTransactionDelta, formatSignedBdt } from "@/lib/sellerRunningTotal";
import * as XLSX from "xlsx";
import {
  getMonthBucket,
  isSameMonth,
  monthLabel,
  prevMonth,
  filterMonth,
  aggregateMonth,
  computeRunningWithOpening,
  closeMonth as closeMonthApi,
  reopenMonth as reopenMonthApi,
  type MonthBucket,
  type MonthlyClosing,
} from "@/lib/sellerMonthlyClose";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock, Unlock } from "lucide-react";

type DatePreset = "all" | "today" | "yesterday" | "last7" | "thisMonth" | "lastMonth" | "custom";
type TypeFilter = "all" | "bdt_payment" | "usdt_received" | "withdraw" | "client_topup";

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "custom", label: "Custom" },
];

function OthersTgGroupField({ value, onSave }: { value: string; onSave: (val: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(!value);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); setEditing(!value); }, [value]);

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs px-2 py-1 rounded bg-muted max-w-xs truncate">{value}</span>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-7 text-xs max-w-xs"
        placeholder="Telegram Group ID for Others Bank"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={async () => {
          const val = draft.trim();
          if (val === value) { if (value) setEditing(false); return; }
          const ok = await onSave(val);
          if (ok && val) setEditing(false);
        }}
      >
        Save
      </Button>
      {value && (
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setDraft(value); setEditing(false); }}>
          Cancel
        </Button>
      )}
    </div>
  );
}

function getPresetRange(preset: DatePreset): { from: Date; to: Date } | null {
  const now = new Date();
  switch (preset) {
    case "today": return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case "last7": return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "thisMonth": return { from: startOfMonth(now), to: endOfDay(now) };
    case "lastMonth": { const lm = subMonths(now, 1); return { from: startOfMonth(lm), to: endOfMonth(lm) }; }
    default: return null;
  }
}

export function AdminSellers() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [showConvert, setShowConvert] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedSeller, setSelectedSeller] = useState<any>(null);
  const [entryType, setEntryType] = useState<"usdt_received" | "bdt_payment" | "withdraw">("usdt_received");
  const [entryForm, setEntryForm] = useState({ usdt_amount: "", bdt_amount: "", rate: "", description: "" });
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [showAssignBank, setShowAssignBank] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState("");
  const [bankToRemove, setBankToRemove] = useState<any>(null);
  const [removeConfirmText, setRemoveConfirmText] = useState("");
  const [showSubmitUsdt, setShowSubmitUsdt] = useState(false);
  const [showUsdtBanksDialog, setShowUsdtBanksDialog] = useState(false);
  const [usdtBanksTargetSeller, setUsdtBanksTargetSeller] = useState<any>(null);

  // Generic confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: React.ReactNode;
    actionLabel: string;
    onConfirm: () => void;
  } | null>(null);

  // Filter states
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [bankFilter, setBankFilter] = useState<string | null>(null);

  // Month-to-month closing state
  const today = new Date();
  const [monthView, setMonthView] = useState<boolean>(false);
  const [activeBucket, setActiveBucket] = useState<MonthBucket>({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showMonthlyExport, setShowMonthlyExport] = useState(false);
  const [exportBucket, setExportBucket] = useState<MonthBucket>({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const ALL_EXPORT_COLS = [
    "Date","Type","Status","BDT Amount","USDT Amount","Rate","Converted (BDT)","Bank","Account Name","Due/Advance (BDT)","Description","Proof URL",
  ] as const;
  type ExportCol = typeof ALL_EXPORT_COLS[number];
  const [exportCols, setExportCols] = useState<ExportCol[]>(["Date","BDT Amount","USDT Amount","Rate","Due/Advance (BDT)"]);

  // Inline edit states
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // OCR states
  const [showOcrDialog, setShowOcrDialog] = useState(false);
  const [ocrUploading, setOcrUploading] = useState(false);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrImageUrl, setOcrImageUrl] = useState<string | null>(null);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<{ bdt_amount: string; date: string; reference: string; bank_name?: string; account_number?: string; account_holder_name?: string } | null>(null);
  const [ocrSelectedBankId, setOcrSelectedBankId] = useState<string | null>(null);
  const [ocrIsOthersBank, setOcrIsOthersBank] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetOcr = () => {
    setOcrUploading(false);
    setOcrProcessing(false);
    setOcrImageUrl(null);
    setOcrPreviewUrl(null);
    setOcrResult(null);
    setOcrSelectedBankId(null);
    setOcrIsOthersBank(false);
  };

  const adminDisplayName = (user as any)?.user_metadata?.full_name || user?.email || "Admin";

  const getApprovedAdminEntryMeta = () => ({
    status: "approved" as const,
    reviewed_by: user?.id,
    reviewed_at: new Date().toISOString(),
    entry_by_name: adminDisplayName,
  });

  const uploadOcrImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }
    setOcrUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `ocr-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("payment-proofs").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      setOcrImageUrl(publicUrl);
      setOcrPreviewUrl(URL.createObjectURL(file));

      // Now call OCR
      setOcrUploading(false);
      setOcrProcessing(true);
      try {
        const { data, error } = await supabase.functions.invoke("ocr-seller-payment", {
          body: { image_url: publicUrl },
        });
        if (error) throw error;
        setOcrResult({
          bdt_amount: data.bdt_amount?.toString() || "",
          date: data.date || "",
          reference: data.reference || "",
          bank_name: data.bank_name || "",
          account_number: data.receiver_account_number || data.account_numbers?.[data.account_numbers.length - 1] || "",
          account_holder_name: data.receiver_account_name || data.account_holder_name || "",
        });
      } catch (ocrErr: any) {
        // OCR failed (e.g. AI credits exhausted). Keep the uploaded image and let the
        // admin fill in details manually so the proof still gets forwarded to the seller.
        const msg = ocrErr?.message || "OCR unavailable";
        toast.warning(`OCR failed (${msg}). Please enter details manually.`);
        setOcrResult({
          bdt_amount: "",
          date: new Date().toISOString().slice(0, 10),
          reference: "",
          bank_name: "",
          account_number: "",
          account_holder_name: "",
        });
      }
    } catch (e: any) {
      toast.error(e.message || "Upload/OCR failed");
      resetOcr();
    } finally {
      setOcrUploading(false);
      setOcrProcessing(false);
    }
  }, []);

  // Handle Ctrl+V paste
  useEffect(() => {
    if (!showOcrDialog) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) uploadOcrImage(file);
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [showOcrDialog, uploadOcrImage]);

  // Save OCR result as seller transaction
  const saveOcrMutation = useMutation({
    mutationFn: async () => {
      if (!ocrResult || !selectedSeller || !ocrImageUrl) throw new Error("Missing data");
      const bdtAmount = Number(ocrResult.bdt_amount);
      if (!bdtAmount || bdtAmount <= 0) throw new Error("Enter a valid BDT amount");
      
      // Build description with bank info for "Others"
      let desc = ocrResult.reference ? `TrxID: ${ocrResult.reference}` : "";
      if (ocrIsOthersBank) {
        const parts: string[] = [];
        if (ocrResult.bank_name) parts.push(`Bank: ${ocrResult.bank_name}`);
        if (ocrResult.account_number) parts.push(`A/C: ${ocrResult.account_number}`);
        if (ocrResult.account_holder_name) parts.push(`Name: ${ocrResult.account_holder_name}`);
        if (parts.length) desc = `[Others] ${parts.join(" | ")}${desc ? ` | ${desc}` : ""}`;
      }
      
      const entry: any = {
        seller_id: selectedSeller.user_id,
        type: "bdt_payment",
        bdt_amount: bdtAmount,
        usdt_amount: 0,
        rate: 0,
        description: desc || undefined,
        proof_url: ocrImageUrl,
        bank_account_id: ocrIsOthersBank ? undefined : (ocrSelectedBankId || undefined),
        ...getApprovedAdminEntryMeta(),
      };
      if (ocrResult.date) entry.created_at = new Date(ocrResult.date).toISOString();
      const { error } = await (supabase as any).from("seller_transactions").insert(entry);
      if (error) throw error;

      // Forward to Telegram
      const shouldForward = ocrIsOthersBank
        ? !!(selectedSeller as any).others_telegram_group_id
        : !!ocrSelectedBankId;
      if (shouldForward && ocrImageUrl) {
        try {
          await supabase.functions.invoke("forward-seller-proof", {
            body: {
              proof_url: ocrImageUrl,
              seller_id: selectedSeller.user_id,
              seller_name: selectedSeller.full_name || selectedSeller.email,
              bdt_amount: bdtAmount,
              bank_account_id: ocrIsOthersBank ? undefined : ocrSelectedBankId,
              reference: ocrResult.reference || null,
              others_telegram_group_id: ocrIsOthersBank ? (selectedSeller as any).others_telegram_group_id : undefined,
              bank_name: ocrIsOthersBank ? ocrResult.bank_name : undefined,
              account_number: ocrIsOthersBank ? ocrResult.account_number : undefined,
              account_holder_name: ocrIsOthersBank ? ocrResult.account_holder_name : undefined,
            },
          });
        } catch (fwdErr) {
          console.error("Telegram forward failed:", fwdErr);
        }
      }
    },
    onSuccess: () => {
      toast.success("BDT Payment recorded from screenshot!");
      logSystemAction("OCR BDT Payment", `Seller: ${selectedSeller.full_name || selectedSeller.email}, Amount: ৳${ocrResult?.bdt_amount}`, user?.id, user?.email);
      queryClient.invalidateQueries({ queryKey: ["admin-seller-txns", selectedSeller.user_id] });
      setShowOcrDialog(false);
      resetOcr();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Fetch all sellers (users with seller role)
  const { data: sellers } = useQuery({
    queryKey: ["admin-sellers"],
    queryFn: async () => {
      const { data: roles } = await (supabase as any).from("user_roles").select("user_id").eq("role", "seller");
      if (!roles?.length) return [];
      const sellerIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("*").in("user_id", sellerIds);
      return (profiles as any[]) ?? [];
    },
  });

  // Fetch all clients (for convert dialog)
  const { data: clients } = useQuery({
    queryKey: ["admin-clients-for-convert"],
    queryFn: async () => {
      const { data: roles } = await (supabase as any).from("user_roles").select("user_id").eq("role", "client");
      if (!roles?.length) return [];
      const clientIds = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("*").in("user_id", clientIds);
      return (profiles as any[]) ?? [];
    },
  });

  // Fetch transactions for selected seller
  const { data: sellerTxns } = useQuery({
    queryKey: ["admin-seller-txns", selectedSeller?.user_id],
    enabled: !!selectedSeller,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("seller_transactions")
        .select("*, bank_accounts(bank_name, account_number, account_name)")
        .eq("seller_id", selectedSeller.user_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      return (data as any[]) ?? [];
    },
  });

  // Fetch assigned banks for selected seller
  const { data: sellerBanks } = useQuery({
    queryKey: ["admin-seller-banks", selectedSeller?.user_id],
    enabled: !!selectedSeller,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("bank_accounts")
        .select("id, bank_name, account_number")
        .eq("seller_id", selectedSeller.user_id)
        .eq("status", "active");
      return (data as any[]) ?? [];
    },
  });

  // Fetch unassigned active banks
  const { data: unassignedBanks } = useQuery({
    queryKey: ["unassigned-banks", selectedSeller?.user_id],
    enabled: !!selectedSeller,
    queryFn: async () => {
      // Show all active banks not already assigned to THIS seller
      const { data } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_number, account_name, seller_id")
        .eq("status", "active");
      // Filter out banks already assigned to this seller
      return (data as any[])?.filter(b => b.seller_id !== selectedSeller.user_id) ?? [];
    },
  });

  // Assign bank to seller
  const assignBankMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBankId || !selectedSeller) throw new Error("Select a bank");
      const { error } = await supabase
        .from("bank_accounts")
        .update({ seller_id: selectedSeller.user_id })
        .eq("id", selectedBankId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bank assigned to seller!");
      logSystemAction("Bank Assigned to Seller", `Bank assigned to ${selectedSeller.full_name || selectedSeller.email}`, user?.id, user?.email);
      queryClient.invalidateQueries({ queryKey: ["admin-seller-banks", selectedSeller.user_id] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-banks"] });
      setShowAssignBank(false);
      setSelectedBankId("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Unassign bank from seller
  const unassignBankMutation = useMutation({
    mutationFn: async (bankId: string) => {
      const { error } = await supabase
        .from("bank_accounts")
        .update({ seller_id: null })
        .eq("id", bankId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bank unassigned!");
      queryClient.invalidateQueries({ queryKey: ["admin-seller-banks", selectedSeller.user_id] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-banks"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Get unique banks from transactions
  const txnBanks = useMemo(() => {
    if (!sellerTxns) return [];
    const bankMap = new Map<string, { id: string; name: string; account: string }>();
    sellerTxns.forEach((t: any) => {
      if (t.bank_account_id && t.bank_accounts) {
        bankMap.set(t.bank_account_id, {
          id: t.bank_account_id,
          name: t.bank_accounts.bank_name,
          account: t.bank_accounts.account_number,
        });
      }
    });
    return Array.from(bankMap.values());
  }, [sellerTxns]);

  // Filter transactions
  const filteredTxns = useMemo(() => {
    if (!sellerTxns) return [];
    let result = sellerTxns;
    if (typeFilter !== "all") {
      if (typeFilter === "bdt_payment") {
        result = result.filter((t: any) => t.type === "bdt_payment" || t.type === "client_topup");
      } else {
        result = result.filter((t: any) => t.type === typeFilter);
      }
    }
    if (bankFilter === "__others__") {
      result = result.filter((t: any) => !t.bank_account_id);
    } else if (bankFilter) {
      result = result.filter((t: any) => t.bank_account_id === bankFilter);
    }
    let range: { from: Date; to: Date } | null = null;
    if (datePreset === "custom" && customFrom && customTo) {
      range = { from: startOfDay(customFrom), to: endOfDay(customTo) };
    } else if (datePreset !== "all") {
      range = getPresetRange(datePreset);
    }
    if (range) {
      result = result.filter((t: any) => {
        const d = new Date(t.created_at);
        return isWithinInterval(d, { start: range!.from, end: range!.to });
      });
    }
    return result;
  }, [sellerTxns, typeFilter, bankFilter, datePreset, customFrom, customTo]);

  // Calculate totals from filtered data — only approved (or legacy) entries
  const sellerTotals = useMemo(() => {
    return filteredTxns.reduce(
      (acc: any, t: any) => {
        const status = t.status || "approved";
        if (status !== "approved") return acc;
        if (t.type === "bdt_payment" || t.type === "tenant_payment") acc.totalBdtPaid += Number(t.bdt_amount || 0);
        if (t.type === "usdt_received") {
          acc.totalUsdt += Number(t.usdt_amount || 0);
          acc.totalConvertedBdt += Number(t.usdt_amount || 0) * Number(t.rate || 0);
        }
        if (t.type === "client_topup") acc.totalClientBdt += Number(t.bdt_amount || 0);
        if (t.type === "withdraw") acc.totalWithdrawn += Number(t.bdt_amount || 0);
        return acc;
      },
      { totalBdtPaid: 0, totalUsdt: 0, totalConvertedBdt: 0, totalClientBdt: 0, totalWithdrawn: 0 }
    );
  }, [filteredTxns]);

  // Approve / reject pending mutation
  const reviewTxnMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await (supabase as any)
        .from("seller_transactions")
        .update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.status === "approved" ? "Approved!" : "Rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-seller-txns", selectedSeller?.user_id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const dueAdvance = sellerTotals.totalBdtPaid + sellerTotals.totalClientBdt - sellerTotals.totalConvertedBdt - sellerTotals.totalWithdrawn;

  // Running Due/Advance balance per row (computed from full unfiltered set so each row reflects its true historical balance)
  const runningTotals = useMemo(() => computeDueAdvanceRunning(sellerTxns || []), [sellerTxns]);

  // ===== Month-to-month closing =====
  const { data: closings } = useQuery({
    queryKey: ["admin-seller-closings", selectedSeller?.user_id],
    enabled: !!selectedSeller,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("seller_monthly_closings")
        .select("*")
        .eq("seller_id", selectedSeller.user_id)
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      return (data as MonthlyClosing[]) ?? [];
    },
  });

  const closingFor = (b: MonthBucket): MonthlyClosing | undefined =>
    closings?.find(c => c.year === b.year && c.month === b.month);

  // Opening balance for a bucket: previous month's closing or 0
  const openingFor = (b: MonthBucket): number => {
    const prev = prevMonth(b);
    const rec = closingFor(prev);
    return rec ? Number(rec.closing_due_advance_bdt || 0) : 0;
  };

  const activeOpening = openingFor(activeBucket);
  const activeMonthAgg = useMemo(
    () => aggregateMonth(sellerTxns || [], activeBucket),
    [sellerTxns, activeBucket]
  );
  const activeClosingLive = activeOpening + activeMonthAgg.delta;
  const activeClosingRecord = closingFor(activeBucket);

  // When in month view, restrict the displayed transactions to the active month
  const monthFilteredTxns = useMemo(() => {
    if (!monthView) return filteredTxns;
    return filterMonth(filteredTxns, activeBucket);
  }, [monthView, filteredTxns, activeBucket]);

  // Running totals for current view: month view uses opening; all-time view uses cumulative
  const viewRunningTotals = useMemo(() => {
    if (!monthView) return runningTotals;
    return computeRunningWithOpening(filterMonth(sellerTxns || [], activeBucket), activeOpening);
  }, [monthView, sellerTxns, activeBucket, activeOpening, runningTotals]);

  const closeMonthMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSeller) throw new Error("No seller");
      return await closeMonthApi({
        sellerId: selectedSeller.user_id,
        bucket: activeBucket,
        txns: sellerTxns || [],
        closedBy: user?.id ?? null,
      });
    },
    onSuccess: () => {
      toast.success(`Closed ${monthLabel(activeBucket)}`);
      queryClient.invalidateQueries({ queryKey: ["admin-seller-closings", selectedSeller?.user_id] });
      setShowCloseConfirm(false);
    },
    onError: (e: any) => toast.error(e.message || "Failed to close month"),
  });

  const reopenMonthMutation = useMutation({
    mutationFn: async () => {
      const rec = activeClosingRecord;
      if (!rec) throw new Error("Not closed");
      await reopenMonthApi(rec.id);
    },
    onSuccess: () => {
      toast.success(`Reopened ${monthLabel(activeBucket)}`);
      queryClient.invalidateQueries({ queryKey: ["admin-seller-closings", selectedSeller?.user_id] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to reopen"),
  });

  // Build available months: union of all txn months + existing closings + current month
  const availableMonths = useMemo<MonthBucket[]>(() => {
    const set = new Map<string, MonthBucket>();
    const add = (b: MonthBucket) => set.set(`${b.year}-${b.month}`, b);
    add({ year: today.getFullYear(), month: today.getMonth() + 1 });
    (sellerTxns || []).forEach((t: any) => add(getMonthBucket(t.created_at)));
    (closings || []).forEach(c => add({ year: c.year, month: c.month }));
    return Array.from(set.values()).sort((a, b) =>
      b.year !== a.year ? b.year - a.year : b.month - a.month
    );
  }, [sellerTxns, closings]);

  const exportMonthlyToExcel = () => {
    if (!selectedSeller) return;
    const monthTxns = filterMonth(sellerTxns || [], exportBucket);
    if (!monthTxns.length) {
      toast.error("No transactions in selected month");
      return;
    }
    const opening = openingFor(exportBucket);
    const running = computeRunningWithOpening(monthTxns, opening);
    // Sort ascending for export readability
    const sorted = [...monthTxns].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const buildRow = (t: any): Record<string, any> => {
      const convBdt = Number(t.usdt_amount || 0) * Number(t.rate || 0);
      const full: Record<ExportCol, any> = {
        "Date": format(new Date(t.created_at), "yyyy-MM-dd HH:mm"),
        "Type": getTypeLabel(t.type),
        "Status": (t.status || "approved").toUpperCase(),
        "BDT Amount": Number(t.bdt_amount || 0),
        "USDT Amount": Number(t.usdt_amount || 0),
        "Rate": Number(t.rate || 0),
        "Converted (BDT)": Number(convBdt.toFixed(2)),
        "Bank": t.bank_accounts ? `${t.bank_accounts.bank_name} ****${(t.bank_accounts.account_number || "").slice(-4)}` : "—",
        "Account Name": t.bank_accounts?.account_name || "",
        "Due/Advance (BDT)": Number((running.get(t.id) || 0).toFixed(2)),
        "Description": t.description || "",
        "Proof URL": t.proof_url || "",
      };
      const picked: Record<string, any> = {};
      for (const c of exportCols) picked[c] = full[c];
      return picked;
    };
    const rows: any[] = [];
    // Opening row
    const openingRow: Record<string, any> = {};
    exportCols.forEach(c => { openingRow[c] = ""; });
    if (exportCols.includes("Date")) openingRow["Date"] = "OPENING";
    if (exportCols.includes("Description")) openingRow["Description"] = `Opening Balance (carry-forward)`;
    if (exportCols.includes("Due/Advance (BDT)")) openingRow["Due/Advance (BDT)"] = Number(opening.toFixed(2));
    rows.push(openingRow);
    sorted.forEach(t => rows.push(buildRow(t)));
    // Closing row
    const agg = aggregateMonth(sellerTxns || [], exportBucket);
    const closing = opening + agg.delta;
    const closingRow: Record<string, any> = {};
    exportCols.forEach(c => { closingRow[c] = ""; });
    if (exportCols.includes("Date")) closingRow["Date"] = "CLOSING";
    if (exportCols.includes("BDT Amount")) closingRow["BDT Amount"] = Number((agg.bdtIn + agg.clientBdt).toFixed(2));
    if (exportCols.includes("USDT Amount")) closingRow["USDT Amount"] = Number(agg.usdtGiven.toFixed(2));
    if (exportCols.includes("Converted (BDT)")) closingRow["Converted (BDT)"] = Number(agg.convertedBdt.toFixed(2));
    if (exportCols.includes("Description")) closingRow["Description"] = closing >= 0 ? `Advance: BDT ${closing.toFixed(2)}` : `Due: BDT ${Math.abs(closing).toFixed(2)}`;
    if (exportCols.includes("Due/Advance (BDT)")) closingRow["Due/Advance (BDT)"] = Number(closing.toFixed(2));
    rows.push(closingRow);

    const ws = XLSX.utils.json_to_sheet(rows, { header: exportCols as unknown as string[] });
    const wb = XLSX.utils.book_new();
    const sheetName = `${exportBucket.year}-${String(exportBucket.month).padStart(2, "0")}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const sellerSlug = (selectedSeller?.full_name || selectedSeller?.email || "seller").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    XLSX.writeFile(wb, `${sellerSlug}-${sheetName}-ledger.xlsx`);
    toast.success(`Exported ${monthLabel(exportBucket)}`);
    setShowMonthlyExport(false);
  };

  const hasActiveFilter = typeFilter !== "all" || bankFilter || datePreset !== "all";
  const clearAllFilters = () => { setTypeFilter("all"); setBankFilter(null); setDatePreset("all"); setCustomFrom(undefined); setCustomTo(undefined); };
  const toggleTypeFilter = (type: TypeFilter) => setTypeFilter(prev => prev === type ? "all" : type);

  const getTypeLabel = (type: string) =>
    type === "usdt_received" ? "USDT Given" : type === "bdt_payment" ? "BDT Payment" : type === "withdraw" ? "Withdraw" : "Client Top-Up";

  const exportToExcel = () => {
    if (!filteredTxns.length) {
      toast.error("No transactions to export");
      return;
    }
    const rows: any[] = filteredTxns.map((t: any) => {
      const convBdt = Number(t.usdt_amount || 0) * Number(t.rate || 0);
      return {
        "Date": format(new Date(t.created_at), "yyyy-MM-dd HH:mm"),
        "Type": getTypeLabel(t.type),
        "Status": (t.status || "approved").toUpperCase(),
        "BDT Amount": Number(t.bdt_amount || 0),
        "USDT Amount": Number(t.usdt_amount || 0),
        "Rate": Number(t.rate || 0),
        "Converted (BDT)": Number(convBdt.toFixed(2)),
        "Bank": t.bank_accounts ? `${t.bank_accounts.bank_name} ****${(t.bank_accounts.account_number || "").slice(-4)}` : "—",
        "Account Name": t.bank_accounts?.account_name || "",
        "Due/Advance (BDT)": Number((runningTotals.get(t.id) || 0).toFixed(2)),
        "Description": t.description || "",
        "Proof URL": t.proof_url || "",
      };
    });
    rows.push({
      "Date": "", "Type": "TOTALS", "Status": "",
      "BDT Amount": sellerTotals.totalBdtPaid + sellerTotals.totalClientBdt,
      "USDT Amount": sellerTotals.totalUsdt,
      "Rate": 0,
      "Converted (BDT)": Number(sellerTotals.totalConvertedBdt.toFixed(2)),
      "Bank": `Withdrawn: BDT ${sellerTotals.totalWithdrawn.toLocaleString()}`,
      "Account Name": "",
      "Due/Advance (BDT)": "",
      "Description": dueAdvance >= 0 ? `Advance: BDT ${dueAdvance.toFixed(2)}` : `Due: BDT ${Math.abs(dueAdvance).toFixed(2)}`,
      "Proof URL": "",
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 16 }, { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 32 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    const sellerSlug = (selectedSeller?.full_name || selectedSeller?.email || "seller").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    XLSX.writeFile(wb, `${sellerSlug}-ledger-${format(new Date(), "yyyy-MM-dd-HHmm")}.xlsx`);
    toast.success("Exported to Excel");
  };

  // Convert client to seller
  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClientId) throw new Error("Select a client");
      const { data, error } = await supabase
        .from("user_roles")
        .update({ role: "seller" as any })
        .eq("user_id", selectedClientId)
        .eq("role", "client" as any)
        .select();
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Client role not found for this user");
    },
    onSuccess: () => {
      const client = clients?.find((c: any) => c.user_id === selectedClientId);
      toast.success(`${client?.full_name || client?.email} converted to seller!`);
      logSystemAction("Client Converted to Seller", `${client?.full_name || client?.email}`, user?.id, user?.email);
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients-for-convert"] });
      setShowConvert(false);
      setSelectedClientId("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Revert seller back to client
  const revertMutation = useMutation({
    mutationFn: async (sellerId: string) => {
      const { error } = await supabase
        .from("user_roles")
        .update({ role: "client" as any })
        .eq("user_id", sellerId)
        .eq("role", "seller" as any);
      if (error) throw error;
      return sellerId;
    },
    onSuccess: (_data, sellerId) => {
      const seller = sellers?.find((s: any) => s.user_id === sellerId);
      toast.success(`${seller?.full_name || seller?.email} reverted to client!`);
      logSystemAction("Seller Reverted to Client", `${seller?.full_name || seller?.email}`, user?.id, user?.email);
      if (selectedSeller?.user_id === sellerId) setSelectedSeller(null);
      queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients-for-convert"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Add entry (USDT received or BDT payment)
  const addEntryMutation = useMutation({
    mutationFn: async () => {
      const entry: any = {
        seller_id: selectedSeller.user_id,
        type: entryType,
        description: entryForm.description || undefined,
        ...getApprovedAdminEntryMeta(),
      };
      if (entryType === "usdt_received") {
        entry.usdt_amount = Number(entryForm.usdt_amount);
        entry.rate = Number(entryForm.rate);
        entry.bdt_amount = 0;
        if (!entry.usdt_amount || !entry.rate) throw new Error("Enter USDT amount and rate");
      } else if (entryType === "withdraw") {
        entry.bdt_amount = Number(entryForm.bdt_amount);
        entry.usdt_amount = 0;
        entry.rate = 0;
        if (!entry.bdt_amount) throw new Error("Enter BDT amount");
      } else {
        entry.bdt_amount = Number(entryForm.bdt_amount);
        entry.usdt_amount = 0;
        entry.rate = 0;
        if (!entry.bdt_amount) throw new Error("Enter BDT amount");
      }
      const { error } = await (supabase as any).from("seller_transactions").insert(entry);
      if (error) throw error;
    },
    onSuccess: () => {
      const label = entryType === "usdt_received" ? "USDT Received" : entryType === "withdraw" ? "Withdraw" : "BDT Payment";
      toast.success(`${label} recorded!`);
      logSystemAction(`Seller ${label}`, `Seller: ${selectedSeller.full_name || selectedSeller.email}`, user?.id, user?.email);
      queryClient.invalidateQueries({ queryKey: ["admin-seller-txns", selectedSeller.user_id] });
      setShowEntryDialog(false);
      setEntryForm({ usdt_amount: "", bdt_amount: "", rate: "", description: "" });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Delete transaction
  const deleteTxnMutation = useMutation({
    mutationFn: async (txnId: string) => {
      const { error } = await (supabase as any).from("seller_transactions").delete().eq("id", txnId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transaction deleted!");
      queryClient.invalidateQueries({ queryKey: ["admin-seller-txns", selectedSeller.user_id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Inline update transaction
  const updateTxnMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const { error } = await (supabase as any).from("seller_transactions").update({ [field]: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-seller-txns", selectedSeller.user_id] });
      setEditingCell(null);
    },
    onError: (e: any) => { toast.error(e.message); setEditingCell(null); },
  });

  // Add empty row
  const addEmptyRowMutation = useMutation({
    mutationFn: async (type: string) => {
      const entry = {
        seller_id: selectedSeller.user_id,
        type,
        bdt_amount: 0,
        usdt_amount: 0,
        rate: 0,
        description: "",
        ...getApprovedAdminEntryMeta(),
      };
      const { error } = await (supabase as any).from("seller_transactions").insert(entry);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("New row added!");
      queryClient.invalidateQueries({ queryKey: ["admin-seller-txns", selectedSeller.user_id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (id: string, field: string, currentValue: any) => {
    setEditingCell({ id, field });
    setEditValue(String(currentValue ?? ""));
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { id, field } = editingCell;
    let finalValue: any = editValue;
    if (["bdt_amount", "usdt_amount", "rate"].includes(field)) {
      finalValue = Number(editValue) || 0;
    }
    // Find current value to compare
    const txn = sellerTxns?.find((t: any) => t.id === id);
    const currentVal = txn?.[field];
    const sameValue = (field === "description")
      ? (String(currentVal || "") === String(editValue || ""))
      : (Number(currentVal || 0) === Number(finalValue || 0));
    if (sameValue) { setEditingCell(null); return; }

    const fieldLabels: Record<string, string> = {
      bdt_amount: "BDT Amount",
      usdt_amount: "USDT Amount",
      rate: "Rate",
      description: "Note / TrxID",
    };
    const label = fieldLabels[field] || field;
    setConfirmDialog({
      title: "Confirm value change",
      description: <>Change <strong>{label}</strong> from <strong>{String(currentVal ?? "—")}</strong> to <strong>{String(finalValue)}</strong>? Type <strong>confirm</strong> to proceed.</>,
      actionLabel: "Update",
      onConfirm: () => updateTxnMutation.mutate({ id, field, value: finalValue }),
    });
    // Hide the inline editor (will reopen via setEditingCell if user cancels — but we close it)
    setEditingCell(null);
  };

  const renderEditableCell = (txn: any, field: string, displayValue: string, className?: string) => {
    const isEditing = editingCell?.id === txn.id && editingCell?.field === field;
    if (isEditing) {
      return (
        <td className="border border-border px-1 py-0.5 text-center">
          <input
            autoFocus
            className="w-full bg-transparent text-center text-[13px] font-semibold outline-none border-b-2 border-primary px-1 py-0.5"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
            style={{ fontFamily: "'Google Sans', 'Roboto', 'Arial', sans-serif" }}
          />
        </td>
      );
    }
    return (
      <td
        className={cn("border border-border px-3 py-1.5 text-center cursor-pointer hover:bg-primary/10 transition-colors", className)}
        onClick={() => startEdit(txn.id, field, field === "description" ? (txn[field] || "") : (txn[field] || 0))}
        title="Click to edit"
      >
        {displayValue}
      </td>
    );
  };

  return (
    <div className="space-y-4 md:space-y-6 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-lg shadow-primary/20">
            <Wallet className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Sellers</h1>
            <p className="text-xs text-muted-foreground">Manage sellers & transactions</p>
          </div>
        </div>
        <Button size={isMobile ? "sm" : "default"} onClick={() => setShowConvert(true)}>
          <UserCog className="mr-1.5 h-4 w-4" /> {isMobile ? "Convert" : "Convert Client to Seller"}
        </Button>
      </div>

      {/* Sellers List */}
      <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3")}>
        {sellers?.map((s: any) => (
          <Card
            key={s.user_id}
            className={cn(
              "cursor-pointer border transition-all duration-200 hover:shadow-lg hover:shadow-primary/5",
              selectedSeller?.user_id === s.user_id ? "ring-2 ring-primary shadow-lg shadow-primary/10 border-primary/30" : "hover:border-primary/30"
            )}
            onClick={() => { setSelectedSeller(s); clearAllFilters(); }}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div className="min-w-0 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-bold text-sm shrink-0">
                  {(s.full_name || s.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate text-foreground">{s.full_name || s.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDialog({
                    title: "Revert seller to client?",
                    description: <>This will revert <strong>{s.full_name || s.email}</strong> back to a Client role. Type <strong>confirm</strong> to proceed.</>,
                    actionLabel: "Revert",
                    onConfirm: () => revertMutation.mutate(s.user_id),
                  });
                }}
                title="Revert to Client"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
        {(!sellers || sellers.length === 0) && (
          <p className="text-muted-foreground text-sm col-span-full text-center py-8">No sellers yet. Convert a client to seller to get started.</p>
        )}
      </div>

      {/* Selected Seller Detail */}
      {selectedSeller && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{selectedSeller.full_name || selectedSeller.email} — Ledger</h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setShowAssignBank(true); setSelectedBankId(""); }}>
                <Landmark className="h-4 w-4 mr-1" /> Assign Bank
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setUsdtBanksTargetSeller(selectedSeller); setShowUsdtBanksDialog(true); }}>
                <Landmark className="h-4 w-4 mr-1" /> USDT Banks
              </Button>
              <Button size="sm" onClick={() => setShowSubmitUsdt(true)}>
                <Plus className="h-4 w-4 mr-1" /> Submit USDT
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEntryType("usdt_received"); setShowEntryDialog(true); }}>
                <DollarSign className="h-4 w-4 mr-1" /> Record USDT
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEntryType("bdt_payment"); setShowEntryDialog(true); }}>
                 <Banknote className="h-4 w-4 mr-1" /> Record BDT
               </Button>
               <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => { setEntryType("withdraw"); setShowEntryDialog(true); }}>
                 <Banknote className="h-4 w-4 mr-1" /> Withdraw
               </Button>
               <Button size="sm" variant="outline" onClick={exportToExcel}>
                 <Download className="h-4 w-4 mr-1" /> Excel
               </Button>
               <Button size="sm" variant="outline" onClick={() => { setExportBucket(activeBucket); setShowMonthlyExport(true); }}>
                 <Download className="h-4 w-4 mr-1" /> Monthly Excel
               </Button>
            </div>
          </div>

          {/* Month-to-month closing toolbar */}
          <div className="rounded-xl border bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={monthView ? "default" : "outline"}
                  onClick={() => setMonthView(v => !v)}
                >
                  {monthView ? "Month View: ON" : "Month View: OFF"}
                </Button>
                <Select
                  value={`${activeBucket.year}-${activeBucket.month}`}
                  onValueChange={(v) => {
                    const [y, m] = v.split("-").map(Number);
                    setActiveBucket({ year: y, month: m });
                  }}
                >
                  <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {availableMonths.map(b => (
                      <SelectItem key={`${b.year}-${b.month}`} value={`${b.year}-${b.month}`}>
                        {monthLabel(b)}{closingFor(b) ? " 🔒" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Pills */}
              <div className="flex flex-wrap items-center gap-2 ml-auto">
                <span className={cn(
                  "text-xs px-2.5 py-1 rounded-full border font-medium",
                  activeOpening >= 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
                                    : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900"
                )}>
                  Opening: {activeOpening >= 0 ? "+" : "−"}৳{Math.abs(activeOpening).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span className={cn(
                  "text-xs px-2.5 py-1 rounded-full border font-medium",
                  activeMonthAgg.delta >= 0 ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900"
                                            : "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-900"
                )}>
                  This Month Net: {activeMonthAgg.delta >= 0 ? "+" : "−"}৳{Math.abs(activeMonthAgg.delta).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span className={cn(
                  "text-xs px-2.5 py-1 rounded-full border font-semibold",
                  activeClosingLive >= 0 ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800"
                                        : "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800"
                )}>
                  Closing: {activeClosingLive >= 0 ? "+" : "−"}৳{Math.abs(activeClosingLive).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>

                {activeClosingRecord ? (
                  <>
                    <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800 font-medium inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Closed {format(new Date(activeClosingRecord.closed_at), "MMM d, HH:mm")}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => closeMonthMutation.mutate()}
                      disabled={closeMonthMutation.isPending}
                      title="Recalculate using current transactions"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> Recalc
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600"
                      onClick={() => reopenMonthMutation.mutate()}
                      disabled={reopenMonthMutation.isPending}
                    >
                      <Unlock className="h-3.5 w-3.5 mr-1" /> Reopen
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setShowCloseConfirm(true)}
                  >
                    <Lock className="h-3.5 w-3.5 mr-1" /> Close Month
                  </Button>
                )}
              </div>
            </div>
            {monthView && (
              <p className="text-[11px] text-muted-foreground">
                Showing only {monthLabel(activeBucket)} transactions. Running balance starts from opening (carry-forward from previous month's closing).
              </p>
            )}
          </div>

          {/* Summary — Clickable for filtering */}
          <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-5")}>
            {/* Due/Advance — Hero Card */}
            <div className={cn(
              "col-span-2 md:col-span-1 relative overflow-hidden rounded-xl p-[1px]",
              dueAdvance >= 0
                ? "bg-gradient-to-br from-emerald-500 to-teal-600"
                : "bg-gradient-to-br from-rose-500 to-red-600"
            )}>
              <div className="h-full rounded-[11px] bg-card/95 backdrop-blur-sm p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg",
                    dueAdvance >= 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                  )}>
                    <Wallet className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {dueAdvance >= 0 ? "Advance" : "Due"}
                  </span>
                </div>
                <p className={cn("text-2xl md:text-3xl font-extrabold tracking-tight", dueAdvance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  {dueAdvance >= 0 ? "+" : "−"}৳{Math.abs(dueAdvance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">After all transactions</p>
              </div>
            </div>

            {/* BDT Received */}
            <button
              onClick={() => toggleTypeFilter("bdt_payment")}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:shadow-lg hover:shadow-primary/5",
                typeFilter === "bdt_payment" ? "ring-2 ring-primary shadow-lg shadow-primary/10" : "hover:border-primary/30"
              )}
            >
              <div className="p-3 md:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ArrowDownLeft className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">BDT Received</span>
                </div>
                <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">৳{(sellerTotals.totalBdtPaid + sellerTotals.totalClientBdt).toLocaleString()}</p>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary/60 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            {/* USDT Given */}
            <button
              onClick={() => toggleTypeFilter("usdt_received")}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:shadow-lg hover:shadow-sky-500/5",
                typeFilter === "usdt_received" ? "ring-2 ring-sky-500 shadow-lg shadow-sky-500/10" : "hover:border-sky-500/30"
              )}
            >
              <div className="p-3 md:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USDT Given</span>
                </div>
                <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">${sellerTotals.totalUsdt.toLocaleString()}</p>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-500/60 to-sky-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            {/* USDT Value (BDT) */}
            <div className="relative overflow-hidden rounded-xl border bg-card">
              <div className="p-3 md:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">USDT (BDT)</span>
                </div>
                <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">৳{sellerTotals.totalConvertedBdt.toLocaleString()}</p>
              </div>
            </div>

            {/* Withdrawn */}
            <button
              onClick={() => toggleTypeFilter("withdraw")}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-card text-left transition-all duration-200 hover:shadow-lg hover:shadow-rose-500/5",
                typeFilter === "withdraw" ? "ring-2 ring-rose-500 shadow-lg shadow-rose-500/10" : "hover:border-rose-500/30"
              )}
            >
              <div className="p-3 md:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Withdrawn</span>
                </div>
                <p className="text-lg md:text-2xl font-extrabold tracking-tight text-foreground">৳{sellerTotals.totalWithdrawn.toLocaleString()}</p>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-rose-500/60 to-rose-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>

          {/* Bank filter chips from transactions */}
          {(txnBanks.length > 0 || sellerTxns?.some((t: any) => !t.bank_account_id)) && (
            <div className="flex flex-wrap gap-2">
              {txnBanks.map((b) => {
                const bankTotal = filteredTxns
                  .filter((t: any) => t.bank_account_id === b.id)
                  .reduce((s: number, t: any) => s + Number(t.bdt_amount || 0), 0);
                return (
                  <button
                    key={b.id}
                    onClick={() => setBankFilter(prev => prev === b.id ? null : b.id)}
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200",
                      bankFilter === b.id
                        ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20"
                        : "bg-card hover:bg-muted/80 border-border hover:border-primary/30"
                    )}
                  >
                    {b.name} ****{b.account?.slice(-4)} — ৳{bankTotal.toLocaleString()}
                  </button>
                );
              })}
              {/* Others Bank chip */}
              {sellerTxns?.some((t: any) => !t.bank_account_id) && (() => {
                const othersTotal = sellerTxns
                  .filter((t: any) => !t.bank_account_id)
                  .reduce((s: number, t: any) => s + Number(t.bdt_amount || 0), 0);
                return (
                  <button
                    onClick={() => setBankFilter(prev => prev === "__others__" ? null : "__others__")}
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-full border font-medium transition-all duration-200",
                      bankFilter === "__others__"
                        ? "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/20"
                        : "bg-card hover:bg-muted/80 border-border hover:border-amber-500/30"
                    )}
                  >
                    Others Bank — ৳{othersTotal.toLocaleString()}
                  </button>
                );
              })()}
            </div>
          )}

          {/* Date Range Presets */}
          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.filter(p => p.key !== "custom").map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={datePreset === p.key ? "default" : "outline"}
                className={cn("text-xs h-7 rounded-full", datePreset === p.key && "shadow-md shadow-primary/20")}
                onClick={() => setDatePreset(p.key)}
              >
                {p.label}
              </Button>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant={datePreset === "custom" ? "default" : "outline"} className="text-xs h-7 gap-1">
                  <CalendarIcon className="h-3 w-3" /> Custom
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="p-3 space-y-2">
                  <Calendar
                    mode="range"
                    selected={customFrom && customTo ? { from: customFrom, to: customTo } : customFrom ? { from: customFrom, to: undefined } : undefined}
                    onSelect={(range: any) => {
                      setCustomFrom(range?.from ?? undefined);
                      setCustomTo(range?.to ?? undefined);
                      setDatePreset("custom");
                    }}
                    numberOfMonths={1}
                    className="p-2 pointer-events-auto"
                  />
                  {customFrom && (
                    <p className="text-xs text-muted-foreground text-center">
                      {format(customFrom, "MMM d, yyyy")} {customTo ? `— ${format(customTo, "MMM d, yyyy")}` : "— select end date"}
                    </p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {hasActiveFilter && (
              <Button size="sm" variant="ghost" className="text-xs h-7 gap-1 text-red-600" onClick={clearAllFilters}>
                <X className="h-3 w-3" /> Clear Filters
              </Button>
            )}
          </div>

          {/* Assigned Banks */}
          {sellerBanks && sellerBanks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground self-center">Assigned Banks:</span>
              {sellerBanks.map((b: any) => (
                <span key={b.id} className="text-xs bg-muted px-2 py-1 rounded-md inline-flex items-center gap-1">
                  {b.bank_name} ****{b.account_number?.slice(-4)}
                  <button onClick={() => setBankToRemove(b)} className="hover:text-destructive ml-0.5" title="Unassign">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Others Bank Telegram Group */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Others TG Group:</Label>
            <OthersTgGroupField
              key={selectedSeller.user_id}
              value={(selectedSeller as any).others_telegram_group_id || ""}
              onSave={async (val) => {
                const { error } = await supabase.from("profiles").update({ others_telegram_group_id: val || null } as any).eq("user_id", selectedSeller.user_id);
                if (error) { toast.error("Failed to save"); return false; }
                toast.success("Others TG Group saved");
                setSelectedSeller({ ...selectedSeller, others_telegram_group_id: val || null });
                queryClient.invalidateQueries({ queryKey: ["admin-sellers"] });
                return true;
              }}
            />
          </div>

          {/* Pending USDT Approvals — only seller-submitted USDT, not client/admin top-ups */}
          {sellerTxns?.some((t: any) => t.status === "pending" && t.type === "usdt_received") && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Pending Seller Submissions
                  <span className="text-xs text-muted-foreground font-normal">
                    ({sellerTxns.filter((t: any) => t.status === "pending" && t.type === "usdt_received").length})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-2 space-y-2">
                {sellerTxns.filter((t: any) => t.status === "pending" && t.type === "usdt_received").map((t: any) => {
                  const convBdt = Number(t.usdt_amount || 0) * Number(t.rate || 0);
                  return (
                    <div key={t.id} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-card">
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-foreground">${Number(t.usdt_amount || 0).toFixed(2)}</span>
                          <span className="text-xs text-muted-foreground">@ {Number(t.rate || 0).toFixed(2)}</span>
                          <span className="text-xs font-semibold text-foreground">≈ ৳{convBdt.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {format(new Date(t.created_at), "MMM d, yyyy h:mm a")}
                          {t.description && <span> · {t.description}</span>}
                        </div>
                      </div>
                      {t.proof_url && (
                        <Button size="sm" variant="outline" onClick={() => setProofUrl(t.proof_url)}>
                          <ImageIcon className="h-3.5 w-3.5 mr-1" /> Proof
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => reviewTxnMutation.mutate({ id: t.id, status: "approved" })}
                        disabled={reviewTxnMutation.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950"
                        onClick={() => setConfirmDialog({
                          title: "Reject this submission?",
                          description: <>This pending USDT submission will be marked as <strong>Rejected</strong>. Type <strong>confirm</strong> to proceed.</>,
                          actionLabel: "Reject",
                          onConfirm: () => reviewTxnMutation.mutate({ id: t.id, status: "rejected" }),
                        })}
                        disabled={reviewTxnMutation.isPending}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Transaction Table — Google Sheets style */}
          {isMobile ? (
            /* Mobile: Card-based layout */
            <div className="space-y-2 pb-20">
              {filteredTxns?.map((t: any) => {
                const convertedBdt = Number(t.usdt_amount || 0) * Number(t.rate || 0);
                const typeLabel = t.type === "usdt_received" ? "USDT Given" : t.type === "bdt_payment" ? "BDT Payment" : t.type === "withdraw" ? "Withdraw" : "Client Top-Up";
                const typeColor = t.type === "usdt_received" ? "text-sky-600 dark:text-sky-400" : t.type === "bdt_payment" ? "text-emerald-600 dark:text-emerald-400" : t.type === "withdraw" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400";
                const typeIcon = t.type === "usdt_received" ? <ArrowUpRight className="h-3.5 w-3.5" /> : t.type === "bdt_payment" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : t.type === "withdraw" ? <RefreshCw className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />;
                return (
                  <Card key={t.id} className="border hover:shadow-md transition-all duration-200">
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className={cn("text-sm font-bold flex items-center gap-1.5", typeColor)}>{typeIcon}{typeLabel}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-medium">{format(new Date(t.created_at), "MMM d, yyyy")}</span>
                          <button
                            onClick={() => setConfirmDialog({
                              title: "Delete this entry?",
                              description: <>This transaction will be permanently deleted. Type <strong>confirm</strong> to proceed.</>,
                              actionLabel: "Delete",
                              onConfirm: () => deleteTxnMutation.mutate(t.id),
                            })}
                            className="text-muted-foreground hover:text-destructive p-0.5"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {t.entry_by_name && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <span>👤</span>
                          <span className="font-medium text-foreground">{t.entry_by_name}</span>
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs">BDT</span>
                          <p className="font-semibold">৳{Number(t.bdt_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs">USDT</span>
                          <p className="font-semibold">${Number(t.usdt_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs">Rate</span>
                          <p className="font-semibold">{Number(t.rate || 0).toFixed(1)}</p>
                        </div>
                        <div className="text-center">
                          <span className="text-muted-foreground text-xs">Conv. BDT</span>
                          <p className="font-semibold">৳{convertedBdt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                      {t.bank_accounts ? (
                        <p className="text-[10px] text-muted-foreground">
                          🏦 {t.bank_accounts.bank_name} — {t.bank_accounts.account_number}
                          {t.bank_accounts.account_name && <span className="block pl-4">{t.bank_accounts.account_name}</span>}
                        </p>
                      ) : (() => {
                        const m = t.description?.match(/\[Others\][^|]*?(?:Bank:\s*([^|]+?))?(?:\s*\|\s*A\/C:\s*([^|]+?))?(?:\s*\|\s*Name:\s*([^|]+?))?(?:\s*\||$)/);
                        if (!m) return null;
                        const bn = m[1]?.trim(), ac = m[2]?.trim(), nm = m[3]?.trim();
                        if (!bn && !ac && !nm) return null;
                        return (
                          <p className="text-[10px] text-amber-600 dark:text-amber-400">
                            🏦 {bn || "Others"}{ac ? ` — ${ac}` : ""}
                            {nm && <span className="block pl-4">{nm}</span>}
                          </p>
                        );
                      })()}
                      <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
                        <span className="text-muted-foreground truncate max-w-[60%]">{t.description || "—"}</span>
                        {t.proof_url ? (
                          <button onClick={() => setProofUrl(t.proof_url)} className="text-primary hover:underline flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" /> View
                          </button>
                        ) : null}
                      </div>
                      {/* Running Due/Advance balance — enhanced TOTAL footer with delta + new running balance */}
                      {(() => {
                        const newBalance = runningTotals.get(t.id) || 0;
                        const delta = computeTransactionDelta(t);
                        const prevBalance = newBalance - delta;
                        const da = formatDueAdvance(newBalance);
                        const prev = formatDueAdvance(prevBalance);
                        const positiveDelta = delta >= 0;
                        return (
                          <div className={cn(
                            "mt-1.5 -mx-3 -mb-3 px-3 py-2.5 border-t-2 space-y-1.5",
                            da.isZero
                              ? "border-border bg-muted/40"
                              : da.isAdvance
                              ? "border-sky-500/40 bg-sky-500/5"
                              : "border-rose-500/40 bg-rose-500/5"
                          )}>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                                📊 Running Balance
                              </span>
                              <span className={cn(
                                "text-xs font-bold tabular-nums px-1.5 py-0.5 rounded",
                                delta === 0
                                  ? "text-muted-foreground bg-muted"
                                  : positiveDelta
                                  ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/15"
                                  : "text-rose-700 dark:text-rose-400 bg-rose-500/15"
                              )}>
                                {formatSignedBdt(delta)}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between">
                              <span className="text-[11px] font-bold uppercase tracking-wider">
                                <span className={cn(
                                  da.isZero ? "text-muted-foreground" : da.isAdvance ? "text-sky-700 dark:text-sky-400" : "text-rose-700 dark:text-rose-400"
                                )}>TOTAL · {da.isZero ? "—" : da.isAdvance ? "Advance" : "Due"}</span>
                              </span>
                              <span className={cn(
                                "text-base font-extrabold tabular-nums",
                                da.isZero ? "text-muted-foreground" : da.isAdvance ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
                              )}>{da.text}</span>
                            </div>
                            {delta !== 0 && (
                              <div className="text-[10px] text-muted-foreground tabular-nums leading-tight pt-0.5 border-t border-border/40">
                                <span className="opacity-70">Prev:</span> <span className="font-semibold">{prev.text}</span>
                                <span className="mx-1 opacity-50">→</span>
                                <span className={cn("font-bold", positiveDelta ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                                  {formatSignedBdt(delta)}
                                </span>
                                <span className="mx-1 opacity-50">→</span>
                                <span className={cn("font-bold", da.isAdvance ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400")}>{da.text}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                );
              })}
              {(!filteredTxns || filteredTxns.length === 0) && (
                <p className="text-muted-foreground text-sm text-center py-8">No transactions</p>
              )}
            </div>
          ) : (
            /* Desktop: Table layout */
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] font-semibold border-collapse" style={{ fontFamily: "'Google Sans', 'Roboto', 'Arial', sans-serif", fontFeatureSettings: '"tnum", "ss01"', letterSpacing: '0.01em' }}>
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Date</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Type</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Account</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Payment (BDT)</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">USDT</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Rate</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Converted BDT</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">TrxID / Note</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap">Proof</th>
                        <th className="border border-border px-3 py-2 text-center font-semibold text-primary whitespace-nowrap">Due/Advance (৳)</th>
                        <th className="border border-border px-2 py-2 text-center font-semibold text-muted-foreground whitespace-nowrap w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTxns?.map((t: any) => {
                        const convertedBdt = Number(t.usdt_amount || 0) * Number(t.rate || 0);
                        const typeLabel = t.type === "usdt_received" ? "USDT Given" : t.type === "bdt_payment" ? "BDT Payment" : t.type === "withdraw" ? "Withdraw" : "Client Top-Up";
                        const typeColor = t.type === "usdt_received" ? "text-sky-600 dark:text-sky-400" : t.type === "bdt_payment" ? "text-emerald-600 dark:text-emerald-400" : t.type === "withdraw" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400";
                        return (
                          <tr key={t.id} className="hover:bg-muted/30 group">
                            <td className="border border-border px-3 py-1.5 text-center whitespace-nowrap font-medium">{format(new Date(t.created_at), "MMM d, yyyy")}</td>
                            <td className={cn("border border-border px-3 py-1.5 text-center font-bold", typeColor)}>{typeLabel}</td>
                            <td className="border border-border px-3 py-1.5 text-center text-xs whitespace-nowrap">
                              {t.bank_accounts ? (
                                <div className="leading-tight">
                                  <div className="font-medium">{t.bank_accounts.bank_name} — {t.bank_accounts.account_number}</div>
                                  {t.bank_accounts.account_name && (
                                    <div className="text-[11px] text-muted-foreground font-normal">{t.bank_accounts.account_name}</div>
                                  )}
                                  {t.entry_by_name && (
                                    <div className="text-[11px] text-primary font-medium mt-0.5">👤 {t.entry_by_name}</div>
                                  )}
                                </div>
                              ) : (() => {
                                const desc = t.description || "";
                                const bn = desc.startsWith("[Others]") ? desc.match(/Bank:\s*([^|]+?)(?:\s*\||$)/)?.[1]?.trim() : null;
                                const ac = desc.startsWith("[Others]") ? desc.match(/A\/C:\s*([^|]+?)(?:\s*\||$)/)?.[1]?.trim() : null;
                                const nm = desc.startsWith("[Others]") ? desc.match(/Name:\s*([^|]+?)(?:\s*\||$)/)?.[1]?.trim() : null;
                                if (!desc.startsWith("[Others]")) {
                                  return t.entry_by_name ? <span className="text-primary font-medium">👤 {t.entry_by_name}</span> : "—";
                                }
                                return (
                                  <div className="leading-tight text-amber-600 dark:text-amber-400">
                                    <div className="font-medium">{bn || "Others"}{ac ? ` — ${ac}` : ""}</div>
                                    {nm && <div className="text-[11px] font-normal opacity-80">{nm}</div>}
                                    {t.entry_by_name && (
                                      <div className="text-[11px] text-primary font-medium mt-0.5">👤 {t.entry_by_name}</div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            {renderEditableCell(t, "bdt_amount", `৳${Number(t.bdt_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "font-semibold")}
                            {renderEditableCell(t, "usdt_amount", `$${Number(t.usdt_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, "font-semibold")}
                            {renderEditableCell(t, "rate", Number(t.rate || 0).toFixed(1), "font-semibold")}
                            <td className="border border-border px-3 py-1.5 text-center font-semibold">৳{convertedBdt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            {renderEditableCell(t, "description", t.description || "—", "max-w-[140px] truncate font-medium")}
                            <td className="border border-border px-3 py-1.5 text-center font-medium">
                              {t.proof_url ? (
                                <button onClick={() => setProofUrl(t.proof_url)} className="text-primary hover:underline inline-flex items-center gap-1 mx-auto">
                                  <ImageIcon className="h-3.5 w-3.5" /> View
                                </button>
                              ) : "—"}
                            </td>
                            {(() => {
                              const da = formatDueAdvance(runningTotals.get(t.id) || 0);
                              const isPending = (t.status || "approved").toLowerCase() !== "approved";
                              return (
                                <td className={cn(
                                  "border border-border px-3 py-1.5 text-right font-extrabold tabular-nums whitespace-nowrap",
                                  isPending ? "text-muted-foreground/60 italic" :
                                    da.isZero ? "text-muted-foreground" : da.isAdvance ? "text-sky-600 dark:text-sky-400" : "text-rose-600 dark:text-rose-400"
                                )}>
                                  {da.text}
                                  {isPending && <div className="text-[10px] font-normal not-italic text-amber-600 dark:text-amber-400">(pending — not counted)</div>}
                                </td>
                              );
                            })()}
                            <td className="border border-border px-1 py-1.5 text-center">
                              <button
                                onClick={() => setConfirmDialog({
                                  title: "Delete this row?",
                                  description: <>This transaction row will be permanently deleted from the ledger. Type <strong>confirm</strong> to proceed.</>,
                                  actionLabel: "Delete",
                                  onConfirm: () => deleteTxnMutation.mutate(t.id),
                                })}
                                className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                                title="Delete row"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {(!filteredTxns || filteredTxns.length === 0) && (
                        <tr><td colSpan={11} className="border border-border text-center text-muted-foreground py-8">No transactions</td></tr>
                      )}
                    </tbody>
                  </table>
                  {/* Add Row Buttons */}
                  <div className="flex gap-2 p-2 border-t border-border bg-muted/30">
                    <Button size="sm" variant="ghost" className="text-xs h-7 gap-1" onClick={() => addEmptyRowMutation.mutate("bdt_payment")}>
                      <Plus className="h-3 w-3" /> BDT Row
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs h-7 gap-1" onClick={() => addEmptyRowMutation.mutate("usdt_received")}>
                      <Plus className="h-3 w-3" /> USDT Row
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs h-7 gap-1 text-red-600" onClick={() => addEmptyRowMutation.mutate("withdraw")}>
                      <Plus className="h-3 w-3" /> Withdraw Row
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Floating OCR Button — visible when a seller is selected */}
      {selectedSeller && (
        <button
          onClick={() => { setShowOcrDialog(true); resetOcr(); }}
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          title="OCR BDT Payment"
        >
          <ScanLine className="h-6 w-6" />
        </button>
      )}

      {/* Convert Client to Seller Dialog */}
      <Dialog open={showConvert} onOpenChange={setShowConvert}>
        <DialogContent>
          <DialogHeader><DialogTitle>Convert Client to Seller</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Select Client</Label>
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((c: any) => (
                    <SelectItem key={c.user_id} value={c.user_id}>
                      {c.full_name || c.email} — {c.email}
                    </SelectItem>
                  ))}
                  {(!clients || clients.length === 0) && (
                    <SelectItem value="_none" disabled>No approved clients available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvert(false)}>Cancel</Button>
            <Button onClick={() => convertMutation.mutate()} disabled={!selectedClientId || convertMutation.isPending}>
              {convertMutation.isPending ? "Converting..." : "Convert to Seller"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Entry Dialog */}
      <Dialog open={showEntryDialog} onOpenChange={setShowEntryDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{entryType === "usdt_received" ? "Record USDT Received" : entryType === "withdraw" ? "Withdraw from Seller" : "Record BDT Payment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {entryType === "usdt_received" ? (
              <>
                <div><Label>USDT Amount</Label><Input type="number" placeholder="e.g. 500" value={entryForm.usdt_amount} onChange={e => setEntryForm(f => ({ ...f, usdt_amount: e.target.value }))} /></div>
                <div><Label>Rate (BDT per USDT)</Label><Input type="number" placeholder="e.g. 125" value={entryForm.rate} onChange={e => setEntryForm(f => ({ ...f, rate: e.target.value }))} /></div>
                {entryForm.usdt_amount && entryForm.rate && (
                  <p className="text-sm text-muted-foreground">Converted: ৳{(Number(entryForm.usdt_amount) * Number(entryForm.rate)).toLocaleString()}</p>
                )}
              </>
            ) : (
              <div><Label>{entryType === "withdraw" ? "Withdraw Amount (BDT)" : "BDT Amount"}</Label><Input type="number" placeholder="e.g. 50000" value={entryForm.bdt_amount} onChange={e => setEntryForm(f => ({ ...f, bdt_amount: e.target.value }))} /></div>
            )}
            <div><Label>Note (optional)</Label><Input value={entryForm.description} onChange={e => setEntryForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEntryDialog(false)}>Cancel</Button>
            <Button onClick={() => addEntryMutation.mutate()} disabled={addEntryMutation.isPending}>
              {addEntryMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proof Dialog */}
      <Dialog open={!!proofUrl} onOpenChange={() => setProofUrl(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-auto">
          {proofUrl && <img src={proofUrl} alt="Proof" className="max-h-[75vh] w-auto mx-auto rounded-md object-contain" />}
        </DialogContent>
      </Dialog>

      {/* Assign Bank Dialog */}
      <Dialog open={showAssignBank} onOpenChange={setShowAssignBank}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Bank to {selectedSeller?.full_name || selectedSeller?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Select Bank</Label>
              <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a bank..." />
                </SelectTrigger>
                <SelectContent>
                  {unassignedBanks?.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.bank_name} — {b.account_number} ({b.account_name})
                    </SelectItem>
                  ))}
                  {(!unassignedBanks || unassignedBanks.length === 0) && (
                    <SelectItem value="_none" disabled>No unassigned banks available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignBank(false)}>Cancel</Button>
            <Button onClick={() => assignBankMutation.mutate()} disabled={!selectedBankId || assignBankMutation.isPending}>
              {assignBankMutation.isPending ? "Assigning..." : "Assign Bank"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OCR BDT Payment Dialog */}
      <Dialog open={showOcrDialog} onOpenChange={(v) => { setShowOcrDialog(v); if (!v) resetOcr(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>OCR BDT Payment</DialogTitle></DialogHeader>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadOcrImage(f);
              e.target.value = "";
            }}
          />

          {/* Step 1: Bank Selection */}
          {!ocrSelectedBankId && !ocrIsOthersBank && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">কোন অ্যাকাউন্টে পেমেন্ট এসেছে?</p>
              <div className="grid gap-2">
                {sellerBanks?.map((b: any) => (
                  <button
                    key={b.id}
                    onClick={() => setOcrSelectedBankId(b.id)}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:border-primary/50 hover:shadow-md transition-all text-left"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <Landmark className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-foreground">{b.bank_name}</p>
                      <p className="text-xs text-muted-foreground">{b.account_number}</p>
                    </div>
                  </button>
                ))}
                {/* Others Bank Option */}
                <button
                  onClick={() => { setOcrIsOthersBank(true); setOcrSelectedBankId("__others__"); }}
                  className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/20 hover:border-amber-500 hover:shadow-md transition-all text-left"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                    <Plus className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground">Others Bank</p>
                    <p className="text-xs text-muted-foreground">বাইরের ব্যাংকে পেমেন্ট — OCR থেকে তথ্য নেবে</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Upload + OCR (after bank selected) */}
          {(ocrSelectedBankId || ocrIsOthersBank) && (
            <>
              {/* Metadata: Uploader + Selected Bank */}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="bg-muted px-2.5 py-1 rounded-md font-medium">👤 {user?.email}</span>
                {ocrIsOthersBank ? (
                  <span className="bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-md font-medium">
                    🏦 Others Bank {ocrResult?.bank_name ? `— ${ocrResult.bank_name}` : ""} {ocrResult?.account_number ? `(${ocrResult.account_number})` : ""}
                  </span>
                ) : (
                  <span className="bg-primary/10 text-primary px-2.5 py-1 rounded-md font-medium">
                    🏦 {sellerBanks?.find((b: any) => b.id === ocrSelectedBankId)?.bank_name} — {sellerBanks?.find((b: any) => b.id === ocrSelectedBankId)?.account_number}
                  </span>
                )}
                <button onClick={() => { setOcrSelectedBankId(null); setOcrIsOthersBank(false); }} className="text-muted-foreground hover:text-destructive px-1">
                  <X className="h-3 w-3" />
                </button>
              </div>

              {!ocrPreviewUrl && !ocrUploading && (
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload or <strong>Ctrl+V</strong> to paste screenshot</p>
                </div>
              )}

              {ocrUploading && (
                <div className="flex items-center justify-center py-8 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm text-muted-foreground">Uploading...</span>
                </div>
              )}

              {ocrPreviewUrl && (
                <img src={ocrPreviewUrl} alt="Payment screenshot" className="w-full rounded-md max-h-48 object-contain border" />
              )}

              {ocrProcessing && (
                <div className="flex items-center justify-center py-4 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm text-muted-foreground">Extracting data with AI...</span>
                </div>
              )}

              {ocrResult && (
                <div className="space-y-3">
                  <div>
                    <Label>BDT Amount</Label>
                    <Input type="number" value={ocrResult.bdt_amount} onChange={(e) => setOcrResult({ ...ocrResult, bdt_amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>Transaction Date</Label>
                    <Input type="date" value={ocrResult.date} onChange={(e) => setOcrResult({ ...ocrResult, date: e.target.value })} />
                  </div>
                  <div>
                    <Label>Reference / TrxID</Label>
                    <Input value={ocrResult.reference} onChange={(e) => setOcrResult({ ...ocrResult, reference: e.target.value })} />
                  </div>
                  {/* Extra fields for Others bank */}
                  {ocrIsOthersBank && (
                    <>
                      <div>
                        <Label>Bank / MFS Name</Label>
                        <Input value={ocrResult.bank_name || ""} onChange={(e) => setOcrResult({ ...ocrResult, bank_name: e.target.value })} placeholder="e.g. DBBL, bKash, City Bank" />
                      </div>
                      <div>
                        <Label>Account Number</Label>
                        <Input value={ocrResult.account_number || ""} onChange={(e) => setOcrResult({ ...ocrResult, account_number: e.target.value })} placeholder="Account number" />
                      </div>
                      <div>
                        <Label>Account Holder Name</Label>
                        <Input value={ocrResult.account_holder_name || ""} onChange={(e) => setOcrResult({ ...ocrResult, account_holder_name: e.target.value })} placeholder="Beneficiary name" />
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowOcrDialog(false); resetOcr(); }}>Cancel</Button>
            {ocrResult && (
              <Button onClick={() => saveOcrMutation.mutate()} disabled={saveOcrMutation.isPending}>
                {saveOcrMutation.isPending ? "Saving..." : "Confirm & Save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Bank Removal Confirmation Dialog */}
      <AlertDialog open={!!bankToRemove} onOpenChange={(open) => { if (!open) { setBankToRemove(null); setRemoveConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Bank Removal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{bankToRemove?.bank_name} ****{bankToRemove?.account_number?.slice(-4)}</strong> from this seller? Type <strong>confirm</strong> to proceed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder='Type "confirm" to remove'
            value={removeConfirmText}
            onChange={(e) => setRemoveConfirmText(e.target.value)}
            className="mt-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setBankToRemove(null); setRemoveConfirmText(""); }}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeConfirmText !== "confirm"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                unassignBankMutation.mutate(bankToRemove.id);
                setBankToRemove(null);
                setRemoveConfirmText("");
              }}
            >
              Remove Bank
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Submit USDT (Admin acting on behalf of selected seller) */}
      {selectedSeller && (
        <SellerSubmitUsdtDialog
          open={showSubmitUsdt}
          onOpenChange={setShowSubmitUsdt}
          sellerId={selectedSeller.user_id}
          invalidateQueryKey={["admin-seller-txns", selectedSeller.user_id]}
        />
      )}
      {/* Generic Confirm Dialog (typed-confirm) for edits/deletes */}
      <ConfirmActionDialog
        open={!!confirmDialog}
        onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}
        title={confirmDialog?.title}
        description={confirmDialog?.description}
        actionLabel={confirmDialog?.actionLabel}
        onConfirm={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
      />

      {/* Manage USDT Banks Dialog */}
      <ManageSellerUsdtBanksDialog
        open={showUsdtBanksDialog}
        onOpenChange={setShowUsdtBanksDialog}
        seller={usdtBanksTargetSeller}
      />
    </div>
  );
}
