import { useState, useMemo } from "react";
import { useParams, useNavigate } from "@/lib/router-compat";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWallets, formatBdt } from "@/hooks/useWallets";
import { SecondaryWalletCard, CombinedTotalCard, SecondaryWalletToggle, CreditLineWalletCard, CreditLineWalletToggle } from "@/components/admin/SecondaryWalletPanel";
import { SpendCapWithdrawToggle } from "@/components/admin/SpendCapWithdrawToggle";
import { SecondaryDepositToggle } from "@/components/admin/SecondaryDepositToggle";
import { ExternalTopUpDialog } from "@/components/admin/ExternalTopUpDialog";
import { useLimitWatches } from "@/hooks/useLimitUpdateWatch";
import { LimitUpdateIndicator } from "@/components/client/LimitUpdateIndicator";


import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { SpendProgressBar } from "@/components/SpendProgressBar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, friendlyEdgeError } from "@/lib/utils";
import { toast } from "sonner";
import {
  User,
  Building2,
  Phone,
  CalendarDays,
  Wallet,
  Scale,
  MonitorSmartphone,
  CheckCircle,
  XCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  CalendarIcon,
  Save,
  Plus,
  Minus,
  ArrowUpCircle,
  CreditCard,
  Shield,
  Receipt,
  ShoppingCart,
  RefreshCw,
  ListChecks,
  Search,
  LayoutDashboard,
  FileText,
  LogIn,
  AppWindow,
  ExternalLink,
  Loader2,
  KeyRound,
  Landmark,
  Banknote,
  Eye,
  Trash2,
  Lock,
  Unlock,
} from "lucide-react";
import { MainWalletDebitCard } from "@/components/MainWalletDebitCard";
import { SecondaryWalletDebitCard } from "@/components/SecondaryWalletDebitCard";
import { CreditLineWalletDebitCard } from "@/components/CreditLineWalletDebitCard";
import { Badge } from "@/components/ui/badge";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { CardBrandIcon } from "@/components/CardBrandIcon";
import { fetchPeriodSpendFromMeta } from "@/lib/fetchPeriodSpend";
import { UnusedAccountsView } from "@/components/UnusedAccountsView";
import { logSystemAction } from "@/lib/systemLog";
import { StripeLinkDialog } from "@/components/admin/StripeLinkDialog";
import { TransactionHistoryPanel } from "@/components/TransactionHistoryPanel";
import { MonthlyUsageExport } from "@/components/client/MonthlyUsageExport";
import { openProof } from "@/lib/proofUrl";


export default function ClientDetailPage() {
  const params = useParams<{ userId?: string; id?: string }>();
  const userId = params.userId || params.id;
  const { user: currentUser, isSuperAdmin, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [dateFrom, setDateFrom] = useState<Date | undefined>(startOfMonth(new Date()));
  const [dateTo, setDateTo] = useState<Date | undefined>(endOfMonth(new Date()));
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyInput, setCompanyInput] = useState("");
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [editingSpend, setEditingSpend] = useState(false);
  const [spendInput, setSpendInput] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [editingDueLimit, setEditingDueLimit] = useState(false);
  const [dueLimitInput, setDueLimitInput] = useState("");
  const [dueLimitExpiry, setDueLimitExpiry] = useState<string>("never");
  const [editingSecDueLimit, setEditingSecDueLimit] = useState(false);
  const [secDueLimitInput, setSecDueLimitInput] = useState("");
  const [secDueLimitExpiry, setSecDueLimitExpiry] = useState<string>("never");
  const [editingClDueLimit, setEditingClDueLimit] = useState(false);
  const [clDueLimitInput, setClDueLimitInput] = useState("");
  const [clDueLimitExpiry, setClDueLimitExpiry] = useState<string>("never");

  // Wallet adjust dialog
  const [walletDialogType, setWalletDialogType] = useState<"credit" | "debit" | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");

  // Main page tab (controlled so mobile wallet cards can show on Overview only)
  const [mainTab, setMainTab] = useState<string>("overview");
  // Top-up / withdraw tabbed dialog
  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false);
  // External CRM top-up (per ad account, per wallet)
  const [extTopUp, setExtTopUp] = useState<{ account: any; wallet: "primary" | "secondary" | "credit_line" } | null>(null);
  const limitWatches = useLimitWatches();

  const [topUpWallet, setTopUpWallet] = useState<"primary" | "secondary" | "credit_line">("primary");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [dialogTab, setDialogTab] = useState<"topup" | "withdraw">("topup");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawWallet, setWithdrawWallet] = useState<"primary" | "secondary">("primary");

  const [withdrawMeta, setWithdrawMeta] = useState<{
    max_withdrawable: number;
    current_spend_cap: number;
    real_amount_spent: number;
  } | null>(null);
  const [fetchingWithdrawMeta, setFetchingWithdrawMeta] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");

  // Bulk assign/unassign
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignSelectedIds, setAssignSelectedIds] = useState<Set<string>>(new Set());
  const [unassignSelectedIds, setUnassignSelectedIds] = useState<Set<string>>(new Set());
  const [showUnassignCheckboxes, setShowUnassignCheckboxes] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [assignSearch, setAssignSearch] = useState("");
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // Total Spending calendar state
  const [totalSpendPeriod, setTotalSpendPeriod] = useState<"month" | "alltime" | "custom">("month");
  const [totalSpendFrom, setTotalSpendFrom] = useState<Date>(startOfMonth(new Date()));
  const [totalSpendTo, setTotalSpendTo] = useState<Date>(new Date());

  const { data: profile } = useQuery({
    queryKey: ["client-detail-profile", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("user_id", userId!).single();
      return data as any;
    },
    enabled: !!userId,
  });

  const { data: globalRate } = useQuery({
    queryKey: ["usd-rate"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "usd_rate")
        .single();
      return data?.value ?? "140";
    },
  });

  const { data: globalDelta = 0 } = useQuery({
    queryKey: ["global-rate-delta"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "global_rate_delta")
        .maybeSingle();
      return Number(data?.value ?? 0) || 0;
    },
  });

  const { data: wallet } = useQuery({
    queryKey: ["client-detail-wallet", userId],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("*").eq("user_id", userId!).single();
      return data as any;
    },
    enabled: !!userId,
  });

  const wallets = useWallets(userId);


  const { data: adAccounts, refetch: refetchAdAccounts } = useQuery({
    queryKey: ["client-detail-ad-accounts", userId],
    queryFn: async () => {
      const { data: assignments } = await (supabase as any)
        .from("user_ad_accounts")
        .select("ad_account_id")
        .eq("user_id", userId!);
      if (!assignments || assignments.length === 0) return [];
      const ids = assignments.map((a: any) => a.ad_account_id);
      const { data } = await supabase.from("ad_accounts").select("*").in("id", ids);
      return (data as any[]) ?? [];
    },
    enabled: !!userId,
  });

  const [adAccountSearch, setAdAccountSearch] = useState("");
  const [adAccountStatusFilter, setAdAccountStatusFilter] = useState<"all" | "active" | "disabled">("all");
  const [adAccountSort, setAdAccountSort] = useState<{ field: "balance" | "today" | "yesterday" | null; dir: "asc" | "desc" }>({ field: null, dir: "desc" });
  const toggleAdAccountSort = (field: "balance" | "today" | "yesterday") => {
    setAdAccountSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { field, dir: "desc" },
    );
  };

  const { data: allAdAccounts } = useQuery({
    queryKey: ["all-ad-accounts-for-assign"],
    queryFn: async () => {
      const { data } = await supabase.from("ad_accounts").select("id, account_name, account_id");
      return (data as any[]) ?? [];
    },
    enabled: showAssignDialog,
  });

  const [insightsLoading, setInsightsLoading] = useState(false);

  const { data: insights, refetch: refetchInsights } = useQuery({
    queryKey: ["client-detail-insights", userId, adAccounts?.map((a: any) => a.id)],
    queryFn: async () => {
      if (!adAccounts || adAccounts.length === 0) return {};
      const ids = adAccounts.map((a: any) => a.id);
      const { data } = await supabase.functions.invoke("get-account-insights", {
        body: { ad_account_ids: ids, source: "cache" },
      });
      return data?.insights ?? {};
    },
    enabled: !!adAccounts && adAccounts.length > 0,
  });

  const filteredAdAccounts = useMemo(() => {
    const q = adAccountSearch.trim().toLowerCase();
    let list = (adAccounts ?? []).slice();
    if (q) {
      list = list.filter((a: any) => {
        const name = String(a.account_name ?? "").toLowerCase();
        const id = String(a.account_id ?? "").toLowerCase();
        return name.includes(q) || id.includes(q) || id.replace(/^act_/, "").includes(q);
      });
    }
    if (adAccountStatusFilter !== "all") {
      list = list.filter((a: any) => {
        const s = String(a.status ?? "").toLowerCase();
        if (adAccountStatusFilter === "active") return s === "active";
        return s !== "active";
      });
    }
    if (adAccountSort.field) {
      const key =
        adAccountSort.field === "balance"
          ? "balance"
          : adAccountSort.field === "today"
            ? "today_spend"
            : "yesterday_spend";
      const dir = adAccountSort.dir === "asc" ? 1 : -1;
      list.sort((a: any, b: any) => {
        const av = Number((insights as any)?.[a.id]?.[key] ?? 0) || 0;
        const bv = Number((insights as any)?.[b.id]?.[key] ?? 0) || 0;
        return (av - bv) * dir;
      });
    }
    return list;
  }, [adAccounts, adAccountSearch, adAccountStatusFilter, adAccountSort, insights]);

  // Auto top-up permission check
  const { data: hasAutoTopupPerm = false } = useQuery({
    queryKey: ["client-auto-topup-perm", userId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("menu_permissions")
        .select("id")
        .eq("user_id", userId!)
        .eq("menu_key", "auto_topup")
        .maybeSingle();
      return !!data;
    },
    enabled: !!userId,
  });

  const toggleAutoTopupPerm = useMutation({
    mutationFn: async () => {
      if (hasAutoTopupPerm) {
        await (supabase as any)
          .from("menu_permissions")
          .delete()
          .eq("user_id", userId!)
          .eq("menu_key", "auto_topup");
      } else {
        await (supabase as any)
          .from("menu_permissions")
          .insert({ user_id: userId!, menu_key: "auto_topup" });
      }
    },
    onSuccess: () => {
      toast.success(hasAutoTopupPerm ? "Auto top-up disabled" : "Auto top-up enabled");
      queryClient.invalidateQueries({ queryKey: ["client-auto-topup-perm", userId] });
    },
    onError: (err: any) => toast.error(err.message || "Failed"),
  });

  const { data: topUpTotal } = useQuery({
    queryKey: ["client-detail-topup-total", userId, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("top_up_requests")
        .select("amount")
        .eq("user_id", userId!)
        .eq("status", "approved");
      if (dateFrom) query = query.gte("created_at", dateFrom.toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
      }
      const { data } = await query;
      return (data as any[])?.reduce((sum: number, r: any) => sum + Number(r.amount), 0) ?? 0;
    },
    enabled: !!userId,
  });

  const { data: totalSpendingFiltered } = useQuery({
    queryKey: ["client-detail-spending", userId, dateFrom?.toISOString(), dateTo?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("transactions")
        .select("amount")
        .eq("user_id", userId!)
        .eq("type", "ad_topup");
      if (dateFrom) query = query.gte("created_at", dateFrom.toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
      }
      const { data } = await query;
      return (
        (data as any[])?.reduce((sum: number, r: any) => sum + Math.abs(Number(r.amount)), 0) ?? 0
      );
    },
    enabled: !!userId,
  });

  // Period-based total spending from Meta (accurate range total)
  const { data: periodSpendData } = useQuery({
    queryKey: [
      "client-detail-period-spend",
      userId,
      totalSpendPeriod,
      format(totalSpendFrom, "yyyy-MM-dd"),
      format(totalSpendTo, "yyyy-MM-dd"),
      (adAccounts ?? [])
        .map((a: any) => a.id)
        .sort()
        .join(","),
    ],
    queryFn: async () => {
      if (totalSpendPeriod === "alltime") return null;
      const accountIds = (adAccounts ?? []).map((a: any) => a.id).filter(Boolean);
      if (!accountIds.length) return 0;
      return fetchPeriodSpendFromMeta(accountIds, totalSpendFrom, totalSpendTo);
    },
    enabled: !!userId && totalSpendPeriod !== "alltime" && !!adAccounts?.length,
    staleTime: 0,
  });

  const { data: transactions } = useQuery({
    queryKey: ["client-detail-transactions", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
    enabled: !!userId,
  });

  // Bank info queries
  const { data: assignedBanks, refetch: refetchBanks } = useQuery({
    queryKey: ["client-detail-banks", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("client_banks")
        .select(
          "id, bank_account_id, assigned_at, bank_accounts(id, bank_name, account_name, account_number, branch, status, logo_url)",
        )
        .eq("user_id", userId!);
      return (data as any[]) ?? [];
    },
    enabled: !!userId,
  });

  const { data: allBanks } = useQuery({
    queryKey: ["all-banks-for-assign"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_name, account_number, status")
        .eq("status", "active");
      return (data as any[]) ?? [];
    },
  });

  const [showBankAssignDialog, setShowBankAssignDialog] = useState(false);
  const [bankAssignSelected, setBankAssignSelected] = useState<Set<string>>(new Set());

  // Top-up history query
  const { data: topUpRequests } = useQuery({
    queryKey: ["client-detail-topup-history", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("top_up_requests")
        .select("*, invoices(id, invoice_number, amount, bdt_amount, usd_rate)")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(100);
      return (data as any[]) ?? [];
    },
    enabled: !!userId,
  });

  const adminProfileIds = [
    ...new Set(
      (transactions ?? [])
        .map((tx: any) => {
          const pb = tx.processed_by || "";
          if (pb.startsWith("admin:")) return pb.split(":")[1];
          return null;
        })
        .filter(Boolean),
    ),
  ];

  const { data: allProfiles } = useQuery({
    queryKey: ["admin-profiles-for-tx", adminProfileIds.join(",")],
    queryFn: async () => {
      if (adminProfileIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", adminProfileIds);
      return (data as any[]) ?? [];
    },
    enabled: adminProfileIds.length > 0,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-wallet", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-transactions", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-ad-accounts", userId] });
  };

  const saveProfileMutation = useMutation({
    mutationFn: async (fields: Record<string, any>) => {
      const { error } = await supabase
        .from("profiles")
        .update(fields as any)
        .eq("user_id", userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated!");
      queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const walletAdjustMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(walletAmount);
      if (!amt || amt <= 0) throw new Error("Invalid amount");

      const isCredit = walletDialogType === "credit";
      // Atomic RPC: locks the wallet, re-derives the balance from its own
      // ledger, then writes balance + transaction together. No stale reads,
      // no way for the balance to move without a matching history row.
      const { data: res, error } = await (supabase as any).rpc("adjust_wallet_atomic", {
        p_user_id: userId!,
        p_amount: isCredit ? amt : -amt,
        p_type: isCredit ? "admin_credit" : "admin_debit",
        p_description:
          walletNote.trim() || (isCredit ? "Admin added balance" : "Admin deducted balance"),
        p_processed_by: `admin:${currentUser!.id}`,
        p_wallet_kind: "primary",
      });
      if (error) throw error;
      if (res && res.ok === false) throw new Error(res.error || "Adjustment failed");
    },

    onSuccess: () => {
      toast.success(walletDialogType === "credit" ? "Balance added!" : "Balance deducted!");
      setWalletDialogType(null);
      setWalletAmount("");
      setWalletNote("");
      invalidateAll();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const setPasswordMutation = useMutation({
    mutationFn: async () => {
      if (!newPassword || newPassword.length < 6)
        throw new Error("Password must be at least 6 characters");
      const res = await supabase.functions.invoke("admin-set-password", {
        body: { target_user_id: userId, new_password: newPassword },
      });
      if (res.error) throw new Error(res.error.message || "Failed");
      if (res.data?.error) throw new Error(res.data.error);
    },
    onSuccess: () => {
      toast.success("Password updated successfully!");
      setPasswordDialog(false);
      setNewPassword("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const topUpMutation = useMutation({
    mutationFn: async (walletKind: "primary" | "secondary" | "credit_line" = "primary") => {
      const amt = parseFloat(topUpAmount);
      if (!amt || amt <= 0) throw new Error("Invalid amount");
      const { data, error } = await supabase.functions.invoke("spend-cap-update", {
        body: {
          ad_account_id: selectedAccountId,
          amount: amt,
          deduct_wallet: true,
          target_user_id: userId,
          wallet_kind: walletKind,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        `Spend cap updated: $${Number(data.old_spend_cap).toLocaleString()} → $${Number(data.new_spend_cap).toLocaleString()}`,
      );
      setTopUpDialogOpen(false);
      setSelectedAccountId("");
      setTopUpAmount("");
      invalidateAll();
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const fetchWithdrawMeta = async (accountId: string) => {
    setWithdrawAmount("");
    setWithdrawMeta(null);
    setFetchingWithdrawMeta(true);
    try {
      const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", {
        body: { ad_account_id: accountId, amount: 1, dry_run: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setWithdrawMeta({
        max_withdrawable: data.max_withdrawable,
        current_spend_cap: data.current_spend_cap,
        real_amount_spent: data.real_amount_spent,
      });
    } catch (err: any) {
      const acc = adAccounts?.find((a: any) => a.id === accountId);
      setWithdrawMeta({
        real_amount_spent: Number(acc?.amount_spent ?? 0),
        current_spend_cap: Number(acc?.spend_cap ?? 0),
        max_withdrawable: Math.max(0, Number(acc?.spend_cap ?? 0) - Number(acc?.amount_spent ?? 0)),
      });
    } finally {
      setFetchingWithdrawMeta(false);
    }
  };

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(withdrawAmount);
      if (!amt || amt <= 0) throw new Error("Invalid amount");
      const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", {
        body: { ad_account_id: selectedAccountId, amount: amt, wallet_kind: withdrawWallet },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        `Withdrawn! Cap: $${Number(data.old_spend_cap).toLocaleString()} → $${Number(data.new_spend_cap).toLocaleString()}`,
      );
      setTopUpDialogOpen(false);
      setSelectedAccountId("");
      setWithdrawAmount("");
      setWithdrawMeta(null);
      setDialogTab("topup");
      invalidateAll();
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const [singleRefreshingId, setSingleRefreshingId] = useState<string | null>(null);
  const refreshSingleMutation = useMutation({
    mutationFn: async (accountId: string) => {
      setSingleRefreshingId(accountId);
      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
      return await chunkedMetaSync([accountId]);
    },
    onSuccess: async () => {
      toast.success("Account synced from Meta");
      await Promise.all([refetchInsights(), refetchAdAccounts()]);
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
    onSettled: () => setSingleRefreshingId(null),
  });

  const activeAccounts = adAccounts?.filter((a: any) => a.status === "active") ?? [];
  const disabledAccounts = adAccounts?.filter((a: any) => a.status !== "active") ?? [];
  const totalRemaining =
    adAccounts?.reduce(
      (sum: number, a: any) => sum + (Number(a.spend_cap) - Number(a.amount_spent)),
      0,
    ) ?? 0;
  const totalSpending =
    adAccounts?.reduce((sum: number, a: any) => sum + Number(a.amount_spent), 0) ?? 0;
  const displayTotalSpend = totalSpendPeriod === "alltime" ? totalSpending : (periodSpendData ?? 0);
  const totalSpendLabel =
    totalSpendPeriod === "alltime"
      ? "Total Spend (All)"
      : totalSpendPeriod === "month"
        ? `Spend (${format(new Date(), "MMM")})`
        : `Spend (${format(totalSpendFrom, "MMM d")}-${format(totalSpendTo, "d")})`;
  const isActive = (profile?.status ?? "active") === "active";
  const clientRate = profile?.usd_rate;
  const dueLimit = (profile as any)?.due_limit;
  const walletBalance = Number(wallet?.balance ?? 0);

  const todaySpend = insights
    ? Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.today_spend ?? 0), 0)
    : 0;
  const yesterdaySpend = insights
    ? Object.values(insights).reduce(
        (sum: number, i: any) => sum + Number(i.yesterday_spend ?? 0),
        0,
      )
    : 0;
  const todayOrders = insights
    ? Object.values(insights).reduce((sum: number, i: any) => sum + Number(i.today_orders ?? 0), 0)
    : 0;
  const yesterdayOrders = insights
    ? Object.values(insights).reduce(
        (sum: number, i: any) => sum + Number(i.yesterday_orders ?? 0),
        0,
      )
    : 0;

  // --- Mobile Ad Account Cards ---
  const renderMobileAdAccountCards = () => (
    <div className="space-y-3">
      {filteredAdAccounts?.map((acc: any) => {
        const ins = insights?.[acc.id];

        return (
          <Card
            key={acc.id}
            className="border border-border/60 shadow-sm cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => navigate(`/ad-accounts/${acc.id}`)}
          >
            <CardContent className="p-4">
              {/* Header */}
              <div className="flex items-start justify-between mb-1">
                {showUnassignCheckboxes && (
                  <div className="pt-0.5 mr-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={unassignSelectedIds.has(acc.id)}
                      onCheckedChange={() => {
                        setUnassignSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(acc.id)) next.delete(acc.id);
                          else next.add(acc.id);
                          return next;
                        });
                      }}
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-foreground truncate">
                    {acc.account_name}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {acc.account_id.replace(/^act_/, "")}
                    </span>
                    <a
                      href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${acc.account_id.replace(/^act_/, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                <StatusBadge status={acc.status} />
              </div>

              {/* Remaining + Progress */}
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                <SpendProgressBar
                  amountSpent={Number(acc.amount_spent)}
                  spendCap={Number(acc.spend_cap)}
                  balanceAfterTopup={Number((acc as any).balance_after_topup ?? 0)}
                />
              </div>

              {/* Spent / Limit + Top Up */}
              <div className="mt-2.5 space-y-2">
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>
                    Spent:{" "}
                    <span className="font-medium text-foreground">
                      $
                      {Number(acc.amount_spent).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </span>
                  <span>
                    Limit:{" "}
                    <span className="font-medium text-foreground">
                      $
                      {Number(acc.spend_cap).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </span>
                </div>
                <LimitUpdateIndicator state={limitWatches[acc.id]} />
                <div
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {(acc.external_topup_required ? !!acc.external_topup_url : true) && (
                    <Button
                      size="sm"
                      className="flex-1 min-w-[110px] gap-1 bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/25 rounded-full font-semibold text-xs h-8"
                      onClick={() => {
                        if (acc.external_topup_required) {
                          setExtTopUp({ account: acc, wallet: "primary" });
                          return;
                        }
                        setSelectedAccountId(acc.id);
                        setTopUpWallet("primary");
                        setTopUpDialogOpen(true);
                        setTopUpAmount("");
                        setDialogTab("topup");
                      }}
                    >
                      <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{acc.external_topup_required ? "Ext. Top Up" : "Top Up"}</span>
                    </Button>
                  )}
                  {(acc.external_topup_required ? !!acc.external_topup_url_secondary : wallets.secondaryEnabled) && (
                    <Button
                      size="sm"
                      className="flex-1 min-w-[110px] gap-1 rounded-full bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-semibold text-xs h-8"
                      title="Top Up (Secondary Wallet)"
                      onClick={() => {
                        if (acc.external_topup_required) {
                          setExtTopUp({ account: acc, wallet: "secondary" });
                          return;
                        }
                        setSelectedAccountId(acc.id);
                        setTopUpWallet("secondary");
                        setTopUpDialogOpen(true);
                        setTopUpAmount("");
                        setDialogTab("topup");
                      }}
                    >
                      <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{acc.external_topup_required ? "Ext. Secondary" : "Secondary"}</span>
                    </Button>
                  )}
                  {!!acc.external_topup_url_credit_line && (
                    <Button
                      size="sm"
                      className="flex-1 min-w-[110px] gap-1 rounded-full bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs h-8"
                      title="Top Up (Credit Line Wallet)"
                      onClick={() => {
                        setExtTopUp({ account: acc, wallet: "credit_line" });
                      }}
                    >
                      <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Credit Line</span>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant={acc.client_topup_disabled ? "destructive" : "outline"}
                    className="h-8 w-8 shrink-0 rounded-full"
                    title={acc.client_topup_disabled ? "Client top-up disabled" : "Disable client top-up"}
                    onClick={async () => {
                      const next = !acc.client_topup_disabled;
                      const { error } = await (supabase as any)
                        .from("ad_accounts")
                        .update({ client_topup_disabled: next })
                        .eq("id", acc.id);
                      if (error) { toast.error(error.message); return; }
                      toast.success(next ? "Client top-up disabled" : "Client top-up enabled");
                      refetchAdAccounts();
                    }}
                  >
                    {acc.client_topup_disabled ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {/* Insights row */}
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                <div className="bg-muted/50 rounded-md p-1.5">
                  <p className="text-[10px] text-muted-foreground">Today Spend</p>
                  <p className="text-xs font-semibold">
                    ${Number(ins?.today_spend ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-md p-1.5">
                  <p className="text-[10px] text-muted-foreground">Yesterday</p>
                  <p className="text-xs font-semibold">
                    ${Number(ins?.yesterday_spend ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="relative bg-muted/50 rounded-md p-1.5 pr-7">
                  <p className="text-[10px] text-muted-foreground">Balance</p>
                  <p className="text-xs font-semibold">
                    ${Number(ins?.balance ?? 0).toLocaleString()}
                  </p>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute -top-1.5 -right-1.5 h-7 w-7 rounded-full border-primary/40 bg-background text-primary shadow-sm hover:bg-primary hover:text-primary-foreground"
                    disabled={singleRefreshingId === acc.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      refreshSingleMutation.mutate(acc.id);
                    }}
                    aria-label="Sync ad account"
                  >
                    <RefreshCw
                      className={cn("h-3.5 w-3.5", singleRefreshingId === acc.id && "animate-spin")}
                    />
                  </Button>
                </div>
              </div>

              {/* Card info */}
              {ins?.cards?.[0] && (
                <div className="mt-2 flex items-center justify-end text-xs">
                  <div className="flex items-center gap-1">
                    <CardBrandIcon displayString={ins.cards[0].display_string} size="xs" />
                    <span className="text-muted-foreground">{ins.cards[0].display_string}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {(!filteredAdAccounts || filteredAdAccounts.length === 0) && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          {adAccountSearch ? "No accounts match your search" : "No ad accounts assigned"}
        </p>
      )}
    </div>
  );

  // --- Mobile Transaction Cards ---
  const renderMobileTransactionCards = () => (
    <div className="space-y-2">
      {transactions?.map((tx: any) => {
        const linkedAccount =
          tx.reference_id && tx.type === "ad_topup"
            ? adAccounts?.find((a: any) => a.id === tx.reference_id)
            : null;
        const desc = tx.description || "—";
        const hasNewline = desc.includes("\n");
        const [descName] = hasNewline ? desc.split("\n") : [desc];
        const isPositive = Number(tx.amount) >= 0;

        return (
          <div key={tx.id} className="border border-border/60 rounded-lg p-3 bg-card">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium capitalize">{tx.type.replace(/_/g, " ")}</p>
                <p className="text-[11px] text-muted-foreground truncate">{descName}</p>
                {linkedAccount && (
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    {linkedAccount.account_name}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    isPositive ? "text-emerald-600" : "text-destructive",
                  )}
                >
                  {isPositive ? "+" : ""}${Math.abs(Number(tx.amount)).toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Bal: ${Number(tx.balance_after ?? 0).toLocaleString()}
                </p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {format(new Date(tx.created_at), "MMM d, yyyy HH:mm")}
            </p>
          </div>
        );
      })}
      {(!transactions || transactions.length === 0) && (
        <p className="text-center text-muted-foreground py-8 text-sm">No transactions yet</p>
      )}
    </div>
  );

  return (
    <DashboardLayout>
      <div className={cn("space-y-5", isMobile && "space-y-4")}>
        {/* Header */}
        {isMobile ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-foreground truncate">
                    {profile?.full_name || "Client"}
                  </h1>
                  <StatusBadge status={isActive ? "active" : "inactive"} />
                </div>
                <p className="text-xs text-muted-foreground truncate">{profile?.email || ""}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-blue-600 border-blue-300 h-8 text-xs rounded-full"
                  onClick={async () => {
                    try {
                      const res = await supabase.functions.invoke("impersonate-client", {
                        body: { target_user_id: userId },
                      });
                      if (res.error) throw new Error(res.error.message);
                      if (res.data?.error) throw new Error(res.data.error);
                      if (res.data?.url) {
                        window.open(res.data.url, "_blank");
                        toast.success("Opening client dashboard...");
                      }
                    } catch (err: any) {
                      toast.error(err.message || "Failed");
                    }
                  }}
                >
                  <LogIn className="h-3 w-3 mr-1" />
                  Login
                </Button>
              )}
              <Button
                size="sm"
                className="bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/25 rounded-full px-4 font-semibold text-xs h-8"
                onClick={() => {
                  setTopUpDialogOpen(true);
                  setSelectedAccountId("");
                  setTopUpAmount("");
                  setDialogTab("topup");
                }}
              >
                <ArrowUpCircle className="h-3 w-3 mr-1" />
                Top Up
              </Button>
              {(isAdmin || isSuperAdmin) && userId && (
                <StripeLinkDialog
                  targetUserId={userId}
                  targetUserName={profile?.full_name || profile?.email}
                  trigger={
                    <Button size="sm" variant="outline" className="h-8 text-xs rounded-full">
                      <CreditCard className="h-3 w-3 mr-1" />
                      Stripe Link
                    </Button>
                  }
                />
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs rounded-full"
                onClick={() => {
                  setWalletDialogType("credit");
                  setWalletAmount("");
                  setWalletNote("");
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs rounded-full text-destructive"
                onClick={() => {
                  setWalletDialogType("debit");
                  setWalletAmount("");
                  setWalletNote("");
                }}
              >
                <Minus className="h-3 w-3 mr-1" />
                Deduct
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs rounded-full"
                onClick={() => {
                  setPasswordDialog(true);
                  setNewPassword("");
                }}
              >
                <KeyRound className="h-3 w-3 mr-1" />
                Password
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {profile?.full_name || "Client Details"}
                </h1>
                <p className="text-xs text-muted-foreground">{profile?.email || ""}</p>
              </div>
              <StatusBadge status={isActive ? "active" : "inactive"} />
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  onClick={async () => {
                    try {
                      const res = await supabase.functions.invoke("impersonate-client", {
                        body: { target_user_id: userId },
                      });
                      if (res.error) throw new Error(res.error.message);
                      if (res.data?.error) throw new Error(res.data.error);
                      if (res.data?.url) {
                        window.open(res.data.url, "_blank");
                        toast.success("Opening client dashboard in new tab...");
                      }
                    } catch (err: any) {
                      toast.error(err.message || "Failed to impersonate");
                    }
                  }}
                >
                  <LogIn className="h-3.5 w-3.5 mr-1" />
                  Login as Client
                </Button>
              )}
              <Button
                className="bg-gradient-to-r from-primary to-primary/75 hover:from-primary/90 hover:to-primary/70 text-primary-foreground shadow-md shadow-primary/25 rounded-full px-5 font-semibold"
                onClick={() => {
                  setTopUpDialogOpen(true);
                  setSelectedAccountId("");
                  setTopUpAmount("");
                  setDialogTab("topup");
                }}
              >
                <ArrowUpCircle className="h-4 w-4 mr-2" />
                Top Up
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPasswordDialog(true);
                  setNewPassword("");
                }}
              >
                <KeyRound className="h-3.5 w-3.5 mr-1" />
                Set Password
              </Button>
            </div>
          </div>
        )}

        {!isActive && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive font-medium">
            ⚠️ This account is currently frozen/inactive.
          </div>
        )}

        <Tabs value={mainTab} onValueChange={setMainTab} className="space-y-4">
          <div
            className={cn(
              "flex items-center gap-3 flex-wrap",
              isMobile && "flex-col items-stretch gap-2",
            )}
          >
            {/* Date Range Filter inline */}
            {!isMobile && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Period:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-[140px] justify-start text-left font-normal",
                        !dateFrom && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {dateFrom ? format(dateFrom, "MMM d, yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateFrom}
                      onSelect={setDateFrom}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-muted-foreground">—</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-[140px] justify-start text-left font-normal",
                        !dateTo && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {dateTo ? format(dateTo, "MMM d, yyyy") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateTo}
                      onSelect={setDateTo}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <div className={cn(isMobile && "w-full overflow-x-auto -mx-1 px-1 scrollbar-hide")}>
              <TabsList
                className={cn("bg-muted/60 p-1 rounded-lg", isMobile && "w-max min-w-full")}
              >
                <TabsTrigger
                  value="info"
                  className={cn(
                    "gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm",
                    isMobile && "text-xs px-3 whitespace-nowrap",
                  )}
                >
                  <User className="h-3.5 w-3.5" />
                  {isMobile ? "Info" : "Client Info"}
                </TabsTrigger>
                <TabsTrigger
                  value="overview"
                  className={cn(
                    "gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm",
                    isMobile && "text-xs px-3 whitespace-nowrap",
                  )}
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="transactions"
                  className={cn(
                    "gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm",
                    isMobile && "text-xs px-3 whitespace-nowrap",
                  )}
                >
                  <Receipt className="h-3.5 w-3.5" />
                  {isMobile ? "Txns" : "Transactions"}
                </TabsTrigger>
                <TabsTrigger
                  value="banks"
                  className={cn(
                    "gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm",
                    isMobile && "text-xs px-3 whitespace-nowrap",
                  )}
                >
                  <Landmark className="h-3.5 w-3.5" />
                  {isMobile ? "Banks" : "Bank Info"}
                </TabsTrigger>
                <TabsTrigger
                  value="topups"
                  className={cn(
                    "gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm",
                    isMobile && "text-xs px-3 whitespace-nowrap",
                  )}
                >
                  <Banknote className="h-3.5 w-3.5" />
                  {isMobile ? "Top-Ups" : "Top Up History"}
                </TabsTrigger>
                <TabsTrigger
                  value="unused"
                  className={cn(
                    "gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm",
                    isMobile && "text-xs px-3 whitespace-nowrap",
                  )}
                >
                  <AppWindow className="h-3.5 w-3.5" />
                  Unused
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          {isMobile && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-full rounded-lg"
              disabled={insightsLoading || !adAccounts || adAccounts.length === 0}
              onClick={async () => {
                if (!adAccounts || adAccounts.length === 0) return;
                setInsightsLoading(true);
                try {
                  const ids = adAccounts.map((a: any) => a.id);
                  const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
                  await chunkedMetaSync(ids);
                  await Promise.all([refetchInsights(), refetchAdAccounts()]);
                  toast.success("Insights updated from Meta!");
                } catch {
                  toast.error("Failed to update from Meta");
                } finally {
                  setInsightsLoading(false);
                }
              }}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", insightsLoading && "animate-spin")} />
              {insightsLoading ? "Updating..." : "Update from Meta"}
            </Button>
          )}

          {/* Mobile-only colorful wallet summary — Overview tab only */}
          {isMobile && userId && mainTab === "overview" && (

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* Main Wallet — keep the same debit-card view used everywhere else */}
              <MainWalletDebitCard
                title="Wallet Balance"
                balanceLabel={`$${walletBalance.toLocaleString()}`}
                footer={wallet?.currency ?? "USD"}
              />

              {/* Secondary Wallet — Chime-style green card (only when enabled) */}
              {wallets.secondaryEnabled && (
                <SecondaryWalletDebitCard
                  balanceLabel={`$${wallets.secondaryBalance.toLocaleString()}`}
                  footer={`Rate ৳${wallets.secondaryRate}/USD`}
                />
              )}

              {wallets.creditLineEnabled && (
                <CreditLineWalletDebitCard
                  balanceLabel={`$${wallets.creditLineBalance.toLocaleString()}`}
                  footer={`Rate ৳${wallets.creditLineRate}/USD`}
                />
              )}

              {/* Combined Due / Adv — purple gradient (only when enabled) */}
              {(wallets.secondaryEnabled || wallets.creditLineEnabled) && (
                <div className="rounded-xl border border-border/60 bg-card p-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-accent-foreground">Combined Due / Adv</p>
                      <p className="mt-0.5 text-2xl font-bold tracking-tight text-accent-foreground">
                        {wallets.totalBdt < 0 ? "-" : ""}{formatBdt(wallets.totalBdt)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {wallets.totalBdt < 0 ? "Due" : "Advance"}
                      </p>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent">
                      <Scale className="h-4.5 w-4.5 text-accent-foreground" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Client Info Tab */}
          <TabsContent value="info" className="mt-0">
            <Card
              className={cn(
                "border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]",
                !isActive && "border-destructive/50 bg-destructive/5",
              )}
            >
              <CardHeader className={cn("pb-4", isMobile && "p-4 pb-3")}>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Client Information
                </CardTitle>
              </CardHeader>
              <CardContent className={cn(isMobile && "px-4 pb-4")}>
                <div
                  className={cn(
                    "grid gap-3",
                    isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
                  )}
                >
                  {/* Full Name */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Full Name
                      </p>
                      {editingName ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input
                            className="w-32 h-7 text-sm"
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                          />
                          <Button
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              saveProfileMutation.mutate({ full_name: nameInput });
                              setEditingName(false);
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditingName(false)}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p
                          className="font-semibold text-sm cursor-pointer hover:text-primary transition-colors"
                          onClick={() => {
                            setNameInput(profile?.full_name ?? "");
                            setEditingName(true);
                          }}
                        >
                          {profile?.full_name || "—"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Business Name */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                      <Building2 className="h-4 w-4 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Business Name
                      </p>
                      {editingCompany ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input
                            className="w-24 h-7 text-sm"
                            value={companyInput}
                            onChange={(e) => setCompanyInput(e.target.value)}
                          />
                          <Button
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              saveProfileMutation.mutate({ company: companyInput });
                              setEditingCompany(false);
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditingCompany(false)}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p
                          className="font-semibold text-sm cursor-pointer hover:text-primary transition-colors"
                          onClick={() => {
                            setCompanyInput(profile?.company ?? "");
                            setEditingCompany(true);
                          }}
                        >
                          {profile?.company || "—"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                      <Phone className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Phone Number
                      </p>
                      {editingPhone ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input
                            className="w-28 h-7 text-sm"
                            value={phoneInput}
                            onChange={(e) => setPhoneInput(e.target.value)}
                          />
                          <Button
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              saveProfileMutation.mutate({ phone: phoneInput });
                              setEditingPhone(false);
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditingPhone(false)}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p
                          className="font-semibold text-sm cursor-pointer hover:text-primary transition-colors"
                          onClick={() => {
                            setPhoneInput(profile?.phone ?? "");
                            setEditingPhone(true);
                          }}
                        >
                          {profile?.phone || "—"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Monthly Spend */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10">
                      <TrendingUp className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Monthly Spend
                      </p>
                      {editingSpend ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Select value={spendInput} onValueChange={setSpendInput}>
                            <SelectTrigger className="h-7 w-36 text-xs">
                              <SelectValue placeholder="Select range" />
                            </SelectTrigger>
                            <SelectContent>
                              {["$0 - $500", "$500 - $2,000", "$2,000 - $5,000", "$5,000 - $10,000", "$10,000+"].map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              saveProfileMutation.mutate({ monthly_spend: spendInput } as any);
                              setEditingSpend(false);
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingSpend(false)}>
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p
                          className="font-semibold text-sm cursor-pointer hover:text-primary transition-colors"
                          onClick={() => {
                            setSpendInput((profile as any)?.monthly_spend ?? "");
                            setEditingSpend(true);
                          }}
                        >
                          {(profile as any)?.monthly_spend || "—"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Business Address */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10">
                      <Building2 className="h-4 w-4 text-rose-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Business Address
                      </p>
                      {editingAddress ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input
                            className="h-7 text-sm"
                            value={addressInput}
                            onChange={(e) => setAddressInput(e.target.value)}
                          />
                          <Button
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => {
                              saveProfileMutation.mutate({ business_address: addressInput } as any);
                              setEditingAddress(false);
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEditingAddress(false)}>
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p
                          className="font-semibold text-sm break-words cursor-pointer hover:text-primary transition-colors"
                          onClick={() => {
                            setAddressInput((profile as any)?.business_address ?? "");
                            setEditingAddress(true);
                          }}
                        >
                          {(profile as any)?.business_address || "—"}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Onboarding Date */}
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 p-4 transition-colors hover:bg-muted/50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                      <CalendarDays className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Onboarding Date
                      </p>
                      <p className="font-semibold text-sm">
                        {profile?.created_at
                          ? format(new Date(profile.created_at), "MMM d, yyyy")
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Default USD Rate (editable — client's onboarding rate / floor) */}
                  <div className="flex items-center gap-3 rounded-xl border border-cyan-200/60 bg-cyan-50/40 dark:bg-cyan-950/20 dark:border-cyan-800/40 p-4 transition-colors hover:bg-cyan-50/60">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
                      <DollarSign className="h-4 w-4 text-cyan-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Default Rate (floor)
                      </p>
                      {editingRate ? (
                        <div className="flex items-center gap-1 mt-1">
                          <Input
                            type="number"
                            step="0.01"
                            className="w-20 h-7 text-sm"
                            value={rateInput}
                            onChange={(e) => setRateInput(e.target.value)}
                            placeholder="e.g. 129"
                          />
                          <Button
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => {
                              const parsed = rateInput.trim() === "" ? null : parseFloat(rateInput);
                              const fields: Record<string, any> = { default_usd_rate: parsed };
                              // Keep effective rate in sync: usd_rate = default + global delta
                              if (parsed !== null && !isNaN(parsed)) {
                                fields.usd_rate = parsed + Number(globalDelta || 0);
                              }
                              saveProfileMutation.mutate(fields);
                              setEditingRate(false);
                            }}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditingRate(false)}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <p
                          className="font-semibold text-sm text-cyan-700 dark:text-cyan-400 cursor-pointer hover:text-cyan-500 transition-colors"
                          onClick={() => {
                            setRateInput(
                              (profile as any)?.default_usd_rate?.toString() ??
                                clientRate?.toString() ??
                                "",
                            );
                            setEditingRate(true);
                          }}
                        >
                          {(profile as any)?.default_usd_rate
                            ? `৳${(profile as any).default_usd_rate}`
                            : clientRate
                              ? `৳${clientRate}`
                              : `Global (৳${globalRate})`}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Effective USD Rate (read-only = default + global delta) */}
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-200/60 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-800/40 p-4">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                      <DollarSign className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Current Rate {Number(globalDelta) > 0 ? `(+${globalDelta} ৳)` : ""}
                      </p>
                      <p className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">
                        {clientRate ? `৳${clientRate}` : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Due Limit */}
                  <div className="rounded-xl border border-amber-200/60 bg-amber-50/40 dark:bg-amber-950/20 dark:border-amber-800/40 p-4 transition-colors hover:bg-amber-50/60">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                        <Shield className="h-4 w-4 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Due Limit
                        </p>
                        {editingDueLimit ? (
                          <div className="space-y-2 mt-1.5">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="1"
                                className="w-24 h-8 text-sm"
                                value={dueLimitInput}
                                onChange={(e) => setDueLimitInput(e.target.value)}
                                placeholder="e.g. 500"
                              />
                              <Select value={dueLimitExpiry} onValueChange={setDueLimitExpiry}>
                                <SelectTrigger className="h-8 w-36 text-xs">
                                  <SelectValue placeholder="Auto-reset" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="never">Never expire</SelectItem>
                                  <SelectItem value="12h">12 hours</SelectItem>
                                  <SelectItem value="24h">24 hours</SelectItem>
                                  <SelectItem value="2d">2 days</SelectItem>
                                  <SelectItem value="3d">3 days</SelectItem>
                                  <SelectItem value="7d">1 week</SelectItem>
                                  <SelectItem value="30d">1 month</SelectItem>
                                  <SelectItem value="365d">1 year</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  const amt =
                                    dueLimitInput.trim() === "" ? null : parseFloat(dueLimitInput);
                                  let expires_at: string | null = null;
                                  let set_at: string | null = null;
                                  if (amt && amt > 0 && dueLimitExpiry !== "never") {
                                    const map: Record<string, number> = {
                                      "12h": 12 * 3600e3,
                                      "24h": 24 * 3600e3,
                                      "2d": 2 * 86400e3,
                                      "3d": 3 * 86400e3,
                                      "7d": 7 * 86400e3,
                                      "30d": 30 * 86400e3,
                                      "365d": 365 * 86400e3,
                                    };
                                    expires_at = new Date(
                                      Date.now() + map[dueLimitExpiry],
                                    ).toISOString();
                                    set_at = new Date().toISOString();
                                  }
                                  saveProfileMutation.mutate({
                                    due_limit: amt,
                                    due_limit_expires_at: expires_at,
                                    due_limit_set_at: set_at,
                                  } as any);
                                  // Log who set/changed the due limit
                                  const prev = Number((profile as any)?.due_limit ?? 0);
                                  const next = Number(amt ?? 0);
                                  const clientName =
                                    (profile as any)?.full_name ||
                                    (profile as any)?.email ||
                                    "Unknown client";
                                  const adminName =
                                    (currentUser as any)?.user_metadata?.full_name ||
                                    currentUser?.email ||
                                    "Admin";
                                  const expiryLabel =
                                    dueLimitExpiry === "never" || !expires_at
                                      ? "never expires"
                                      : `expires ${format(new Date(expires_at), "dd MMM yyyy, hh:mm a")}`;
                                  const action =
                                    prev === 0 && next > 0
                                      ? "Due Limit Set"
                                      : next === 0
                                        ? "Due Limit Removed"
                                        : "Due Limit Updated";
                                  const details =
                                    next === 0
                                      ? `${clientName} — Due limit removed (was $${prev.toLocaleString()}) by ${adminName}`
                                      : `${clientName} — Due limit $${prev.toLocaleString()} → $${next.toLocaleString()} (${expiryLabel}) by ${adminName}`;
                                  void logSystemAction(
                                    action,
                                    details,
                                    currentUser?.id ?? null,
                                    adminName,
                                  );
                                  setEditingDueLimit(false);
                                }}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingDueLimit(false)}
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                            {dueLimitInput &&
                              parseFloat(dueLimitInput) > 0 &&
                              dueLimitExpiry !== "never" &&
                              (() => {
                                const map: Record<string, number> = {
                                  "12h": 12 * 3600e3,
                                  "24h": 24 * 3600e3,
                                  "2d": 2 * 86400e3,
                                  "3d": 3 * 86400e3,
                                  "7d": 7 * 86400e3,
                                  "30d": 30 * 86400e3,
                                  "365d": 365 * 86400e3,
                                };
                                const when = new Date(Date.now() + map[dueLimitExpiry]);
                                return (
                                  <p className="text-[11px] text-muted-foreground">
                                    ↳ Will reset on: {format(when, "MMM d, yyyy 'at' h:mm a")}
                                  </p>
                                );
                              })()}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <p
                              className="font-semibold text-sm text-amber-700 dark:text-amber-400 cursor-pointer hover:text-amber-500 transition-colors"
                              onClick={() => {
                                setDueLimitInput(dueLimit?.toString() ?? "");
                                setDueLimitExpiry("never");
                                setEditingDueLimit(true);
                              }}
                            >
                              {dueLimit ? `$${Number(dueLimit).toLocaleString()}` : "No due limit"}
                            </p>
                            {dueLimit > 0 &&
                              (profile as any)?.due_limit_expires_at &&
                              (() => {
                                const expires = new Date((profile as any).due_limit_expires_at);
                                const ms = expires.getTime() - Date.now();
                                if (ms <= 0)
                                  return (
                                    <Badge variant="destructive" className="text-[10px]">
                                      Expired
                                    </Badge>
                                  );
                                const hrs = Math.floor(ms / 3600e3);
                                const mins = Math.floor((ms % 3600e3) / 60e3);
                                const days = Math.floor(hrs / 24);
                                const label =
                                  days > 0
                                    ? `${days}d ${hrs % 24}h`
                                    : hrs > 0
                                      ? `${hrs}h ${mins}m`
                                      : `${mins}m`;
                                const cls =
                                  ms < 2 * 3600e3
                                    ? "bg-destructive/15 text-destructive border-destructive/30"
                                    : ms < 24 * 3600e3
                                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
                                return (
                                  <Badge
                                    variant="outline"
                                    className={cn("text-[10px] gap-1", cls)}
                                    title={`Resets on ${format(expires, "MMM d, yyyy 'at' h:mm a")}`}
                                  >
                                    <CalendarDays className="h-2.5 w-2.5" />
                                    Expires in {label}
                                  </Badge>
                                );
                              })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Secondary Wallet Due Limit — used only for secondary-wallet top-ups */}
                  <div className="rounded-xl border border-violet-200/60 bg-violet-50/40 dark:bg-violet-950/20 dark:border-violet-800/40 p-4 transition-colors hover:bg-violet-50/60">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
                        <Shield className="h-4 w-4 text-violet-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Secondary Due Limit
                        </p>
                        {editingSecDueLimit ? (
                          <div className="space-y-2 mt-1.5">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="1"
                                className="w-24 h-8 text-sm"
                                value={secDueLimitInput}
                                onChange={(e) => setSecDueLimitInput(e.target.value)}
                                placeholder="e.g. 500"
                              />
                              <Select value={secDueLimitExpiry} onValueChange={setSecDueLimitExpiry}>
                                <SelectTrigger className="h-8 w-36 text-xs">
                                  <SelectValue placeholder="Auto-reset" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="never">Never expire</SelectItem>
                                  <SelectItem value="12h">12 hours</SelectItem>
                                  <SelectItem value="24h">24 hours</SelectItem>
                                  <SelectItem value="2d">2 days</SelectItem>
                                  <SelectItem value="3d">3 days</SelectItem>
                                  <SelectItem value="7d">1 week</SelectItem>
                                  <SelectItem value="30d">1 month</SelectItem>
                                  <SelectItem value="365d">1 year</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  const amt =
                                    secDueLimitInput.trim() === "" ? null : parseFloat(secDueLimitInput);
                                  let expires_at: string | null = null;
                                  let set_at: string | null = null;
                                  if (amt && amt > 0 && secDueLimitExpiry !== "never") {
                                    const map: Record<string, number> = {
                                      "12h": 12 * 3600e3,
                                      "24h": 24 * 3600e3,
                                      "2d": 2 * 86400e3,
                                      "3d": 3 * 86400e3,
                                      "7d": 7 * 86400e3,
                                      "30d": 30 * 86400e3,
                                      "365d": 365 * 86400e3,
                                    };
                                    expires_at = new Date(Date.now() + map[secDueLimitExpiry]).toISOString();
                                    set_at = new Date().toISOString();
                                  }
                                  saveProfileMutation.mutate({
                                    secondary_due_limit: amt,
                                    secondary_due_limit_expires_at: expires_at,
                                    secondary_due_limit_set_at: set_at,
                                  } as any);
                                  const prev = Number((profile as any)?.secondary_due_limit ?? 0);
                                  const next = Number(amt ?? 0);
                                  const clientName =
                                    (profile as any)?.full_name || (profile as any)?.email || "Unknown client";
                                  const adminName =
                                    (currentUser as any)?.user_metadata?.full_name || currentUser?.email || "Admin";
                                  const expiryLabel =
                                    secDueLimitExpiry === "never" || !expires_at
                                      ? "never expires"
                                      : `expires ${format(new Date(expires_at), "dd MMM yyyy, hh:mm a")}`;
                                  void logSystemAction(
                                    next === 0
                                      ? "Secondary Due Limit Removed"
                                      : prev === 0
                                        ? "Secondary Due Limit Set"
                                        : "Secondary Due Limit Updated",
                                    next === 0
                                      ? `${clientName} — Secondary due limit removed (was $${prev.toLocaleString()}) by ${adminName}`
                                      : `${clientName} — Secondary due limit $${prev.toLocaleString()} → $${next.toLocaleString()} (${expiryLabel}) by ${adminName}`,
                                    currentUser?.id ?? null,
                                    adminName,
                                  );
                                  setEditingSecDueLimit(false);
                                }}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingSecDueLimit(false)}
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              ↳ Only usable for secondary-wallet top-ups
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <p
                              className="font-semibold text-sm text-violet-700 dark:text-violet-400 cursor-pointer hover:text-violet-500 transition-colors"
                              onClick={() => {
                                setSecDueLimitInput(
                                  (profile as any)?.secondary_due_limit?.toString() ?? "",
                                );
                                setSecDueLimitExpiry("never");
                                setEditingSecDueLimit(true);
                              }}
                            >
                              {(profile as any)?.secondary_due_limit
                                ? `$${Number((profile as any).secondary_due_limit).toLocaleString()}`
                                : "No due limit"}
                            </p>
                            {Number((profile as any)?.secondary_due_limit ?? 0) > 0 &&
                              (profile as any)?.secondary_due_limit_expires_at &&
                              (() => {
                                const expires = new Date((profile as any).secondary_due_limit_expires_at);
                                const ms = expires.getTime() - Date.now();
                                if (ms <= 0)
                                  return (
                                    <Badge variant="destructive" className="text-[10px]">
                                      Expired
                                    </Badge>
                                  );
                                const hrs = Math.floor(ms / 3600e3);
                                const mins = Math.floor((ms % 3600e3) / 60e3);
                                const days = Math.floor(hrs / 24);
                                const label =
                                  days > 0 ? `${days}d ${hrs % 24}h` : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                                return (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] gap-1 bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30"
                                    title={`Resets on ${format(expires, "MMM d, yyyy 'at' h:mm a")}`}
                                  >
                                    <CalendarDays className="h-2.5 w-2.5" />
                                    Expires in {label}
                                  </Badge>
                                );
                              })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Credit Line Wallet Due Limit — used only for credit-line top-ups */}
                  <div className="rounded-xl border border-sky-200/60 bg-sky-50/40 dark:bg-sky-950/20 dark:border-sky-800/40 p-4 transition-colors hover:bg-sky-50/60">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
                        <Shield className="h-4 w-4 text-sky-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Credit Line Due Limit
                        </p>
                        {editingClDueLimit ? (
                          <div className="space-y-2 mt-1.5">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step="1"
                                className="w-24 h-8 text-sm"
                                value={clDueLimitInput}
                                onChange={(e) => setClDueLimitInput(e.target.value)}
                                placeholder="e.g. 500"
                              />
                              <Select value={clDueLimitExpiry} onValueChange={setClDueLimitExpiry}>
                                <SelectTrigger className="h-8 w-36 text-xs">
                                  <SelectValue placeholder="Auto-reset" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="never">Never expire</SelectItem>
                                  <SelectItem value="12h">12 hours</SelectItem>
                                  <SelectItem value="24h">24 hours</SelectItem>
                                  <SelectItem value="2d">2 days</SelectItem>
                                  <SelectItem value="3d">3 days</SelectItem>
                                  <SelectItem value="7d">1 week</SelectItem>
                                  <SelectItem value="30d">1 month</SelectItem>
                                  <SelectItem value="365d">1 year</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  const amt =
                                    clDueLimitInput.trim() === "" ? null : parseFloat(clDueLimitInput);
                                  let expires_at: string | null = null;
                                  let set_at: string | null = null;
                                  if (amt && amt > 0 && clDueLimitExpiry !== "never") {
                                    const map: Record<string, number> = {
                                      "12h": 12 * 3600e3,
                                      "24h": 24 * 3600e3,
                                      "2d": 2 * 86400e3,
                                      "3d": 3 * 86400e3,
                                      "7d": 7 * 86400e3,
                                      "30d": 30 * 86400e3,
                                      "365d": 365 * 86400e3,
                                    };
                                    expires_at = new Date(Date.now() + map[clDueLimitExpiry]).toISOString();
                                    set_at = new Date().toISOString();
                                  }
                                  saveProfileMutation.mutate({
                                    credit_line_due_limit: amt,
                                    credit_line_due_limit_expires_at: expires_at,
                                    credit_line_due_limit_set_at: set_at,
                                  } as any);
                                  const prev = Number((profile as any)?.credit_line_due_limit ?? 0);
                                  const next = Number(amt ?? 0);
                                  const clientName =
                                    (profile as any)?.full_name || (profile as any)?.email || "Unknown client";
                                  const adminName =
                                    (currentUser as any)?.user_metadata?.full_name || currentUser?.email || "Admin";
                                  const expiryLabel =
                                    clDueLimitExpiry === "never" || !expires_at
                                      ? "never expires"
                                      : `expires ${format(new Date(expires_at), "dd MMM yyyy, hh:mm a")}`;
                                  void logSystemAction(
                                    next === 0
                                      ? "Credit Line Due Limit Removed"
                                      : prev === 0
                                        ? "Credit Line Due Limit Set"
                                        : "Credit Line Due Limit Updated",
                                    next === 0
                                      ? `${clientName} — Credit line due limit removed (was $${prev.toLocaleString()}) by ${adminName}`
                                      : `${clientName} — Credit line due limit $${prev.toLocaleString()} → $${next.toLocaleString()} (${expiryLabel}) by ${adminName}`,
                                    currentUser?.id ?? null,
                                    adminName,
                                  );
                                  setEditingClDueLimit(false);
                                }}
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingClDueLimit(false)}
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              ↳ Only usable for credit-line wallet top-ups
                            </p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <p
                              className="font-semibold text-sm text-sky-700 dark:text-sky-400 cursor-pointer hover:text-sky-500 transition-colors"
                              onClick={() => {
                                setClDueLimitInput(
                                  (profile as any)?.credit_line_due_limit?.toString() ?? "",
                                );
                                setClDueLimitExpiry("never");
                                setEditingClDueLimit(true);
                              }}
                            >
                              {(profile as any)?.credit_line_due_limit
                                ? `$${Number((profile as any).credit_line_due_limit).toLocaleString()}`
                                : "No due limit"}
                            </p>
                            {Number((profile as any)?.credit_line_due_limit ?? 0) > 0 &&
                              (profile as any)?.credit_line_due_limit_expires_at &&
                              (() => {
                                const expires = new Date((profile as any).credit_line_due_limit_expires_at);
                                const ms = expires.getTime() - Date.now();
                                if (ms <= 0)
                                  return (
                                    <Badge variant="destructive" className="text-[10px]">
                                      Expired
                                    </Badge>
                                  );
                                const hrs = Math.floor(ms / 3600e3);
                                const mins = Math.floor((ms % 3600e3) / 60e3);
                                const days = Math.floor(hrs / 24);
                                const label =
                                  days > 0 ? `${days}d ${hrs % 24}h` : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                                return (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] gap-1 bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/30"
                                    title={`Resets on ${format(expires, "MMM d, yyyy 'at' h:mm a")}`}
                                  >
                                    <CalendarDays className="h-2.5 w-2.5" />
                                    Expires in {label}
                                  </Badge>
                                );
                              })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Auto Top-Up Permission */}
                  <div className="flex items-center justify-between pt-3 border-t">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Auto Top-Up
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Allow this client to set auto top-up rules
                      </p>
                    </div>
                    <Switch
                      checked={hasAutoTopupPerm}
                      onCheckedChange={() => toggleAutoTopupPerm.mutate()}
                      disabled={toggleAutoTopupPerm.isPending}
                    />
                  </div>
                  {/* Campaign Management Permission */}
                  <div className="flex items-center justify-between pt-3 border-t">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Campaign Management
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Allow this client to view & pause campaigns (uses Meta API)
                      </p>
                    </div>
                    <Switch
                      checked={!!(profile as any)?.campaign_management_enabled}
                      onCheckedChange={(checked) =>
                        saveProfileMutation.mutate({ campaign_management_enabled: checked } as any)
                      }
                      disabled={saveProfileMutation.isPending}
                    />
                  </div>
                  {/* Ad Account Rename Permission */}
                  <div className="flex items-center justify-between pt-3 border-t">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Account Rename
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Allow this client to rename their ad accounts
                      </p>
                    </div>
                    <Switch
                      checked={!!(profile as any)?.account_rename_enabled}
                      onCheckedChange={(checked) =>
                        saveProfileMutation.mutate({ account_rename_enabled: checked } as any)
                      }
                      disabled={saveProfileMutation.isPending}
                    />
                  </div>
                  {/* Secondary (sheet-rate) wallet on/off + rate */}
                  {userId && <SecondaryWalletToggle userId={userId} />}
                  {userId && <CreditLineWalletToggle userId={userId} />}
                  {/* Client-side spend cap withdraw permission */}
                  {userId && <SpendCapWithdrawToggle userId={userId} />}
                  {userId && <SecondaryDepositToggle userId={userId} />}

                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-0">
            {/* Performance header */}
            <div
              className={cn(
                "flex items-center justify-between",
                isMobile && "flex-col items-start gap-2",
              )}
            >
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Today's Performance
              </h3>
              {!isMobile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={insightsLoading || !adAccounts || adAccounts.length === 0}
                  onClick={async () => {
                    if (!adAccounts || adAccounts.length === 0) return;
                    setInsightsLoading(true);
                    try {
                      const ids = adAccounts.map((a: any) => a.id);
                      const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
                      await chunkedMetaSync(ids);
                      await Promise.all([refetchInsights(), refetchAdAccounts()]);
                      toast.success("Insights updated from Meta!");
                    } catch {
                      toast.error("Failed to update from Meta");
                    } finally {
                      setInsightsLoading(false);
                    }
                  }}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", insightsLoading && "animate-spin")} />
                  {insightsLoading ? "Updating..." : "Update from Meta"}
                </Button>
              )}
            </div>

            {/* Metrics */}
            {isMobile ? (
              <div className="space-y-3">
                {/* 2x2 compact metrics */}
                <div className="grid grid-cols-2 gap-2">
                  <Card className="bg-card border border-border/60">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] text-muted-foreground font-medium">Ad Accounts</p>
                      <p className="text-lg font-bold text-foreground">{adAccounts?.length ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {activeAccounts.length} active
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border border-border/60">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] text-muted-foreground font-medium">Remaining</p>
                      <p className="text-lg font-bold text-foreground">
                        ${totalRemaining.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border border-border/60">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] text-muted-foreground font-medium">Today Spend</p>
                      <p className="text-lg font-bold text-foreground">
                        ${todaySpend.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Y: ${yesterdaySpend.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border border-border/60">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] text-muted-foreground font-medium">Today Orders</p>
                      <p className="text-lg font-bold text-foreground">
                        {todayOrders.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Y: {yesterdayOrders.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Bottom row: Top-Up + Spending */}
                <div className="grid grid-cols-2 gap-2">
                  <Card className="bg-card border border-border/60">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] text-muted-foreground font-medium">Total Top-Up</p>
                      <p className="text-lg font-bold text-foreground">
                        ${Number(topUpTotal ?? 0).toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card border border-border/60 relative">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] text-muted-foreground font-medium">
                        {totalSpendLabel}
                      </p>
                      <p className="text-lg font-bold text-foreground">
                        ${displayTotalSpend.toLocaleString()}
                      </p>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded hover:bg-muted/60">
                            <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="end">
                          <div className="flex flex-wrap gap-1 mb-2">
                            <Button
                              size="sm"
                              variant={totalSpendPeriod === "month" ? "default" : "outline"}
                              className="h-6 text-[10px] px-2"
                              onClick={() => {
                                setTotalSpendPeriod("month");
                                setTotalSpendFrom(startOfMonth(new Date()));
                                setTotalSpendTo(new Date());
                              }}
                            >
                              This Month
                            </Button>
                            <Button
                              size="sm"
                              variant={totalSpendPeriod === "alltime" ? "default" : "outline"}
                              className="h-6 text-[10px] px-2"
                              onClick={() => setTotalSpendPeriod("alltime")}
                            >
                              All Time
                            </Button>
                          </div>
                          <Calendar
                            mode="range"
                            selected={{ from: totalSpendFrom, to: totalSpendTo }}
                            onSelect={(range: any) => {
                              if (range?.from) {
                                setTotalSpendFrom(range.from);
                                setTotalSpendPeriod("custom");
                              }
                              if (range?.to) setTotalSpendTo(range.to);
                            }}
                            numberOfMonths={1}
                            className="p-2 pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              /* Desktop Metrics */
              <div className="space-y-3">
                {/* Top row — colored banner chips like reference */}
                <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
                  {[
                    {
                      label: "Today's Spend",
                      value: `$${todaySpend.toLocaleString()}`,
                      sub: `Yesterday: $${yesterdaySpend.toLocaleString()}`,
                      bg: "bg-emerald-50 dark:bg-emerald-950/30",
                      accent: "bg-emerald-500",
                      icon: DollarSign,
                      iconColor: "text-white",
                    },
                    {
                      label: "Today's Orders",
                      value: todayOrders.toLocaleString(),
                      sub: `Yesterday: ${yesterdayOrders.toLocaleString()}`,
                      bg: "bg-sky-50 dark:bg-sky-950/30",
                      accent: "bg-sky-500",
                      icon: ShoppingCart,
                      iconColor: "text-white",
                    },
                    {
                      label: "Total Top-Up",
                      value: `$${Number(topUpTotal ?? 0).toLocaleString()}`,
                      sub:
                        dateFrom && dateTo
                          ? `${format(dateFrom, "MMM d")} - ${format(dateTo, "MMM d, yyyy")}`
                          : "All time",
                      bg: "bg-amber-50 dark:bg-amber-950/30",
                      accent: "bg-amber-500",
                      icon: TrendingUp,
                      iconColor: "text-white",
                    },
                    {
                      label: "Total Spending",
                      value: `$${displayTotalSpend.toLocaleString()}`,
                      sub: totalSpendLabel,
                      bg: "bg-violet-50 dark:bg-violet-950/30",
                      accent: "bg-violet-500",
                      icon: TrendingDown,
                      iconColor: "text-white",
                      hasCalendar: true,
                    },
                    {
                      label: "Remaining Balance",
                      value: `$${totalRemaining.toLocaleString()}`,
                      sub: "All ad accounts",
                      bg: "bg-rose-50 dark:bg-rose-950/30",
                      accent: "bg-rose-500",
                      icon: Wallet,
                      iconColor: "text-white",
                    },
                  ].map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={i}
                        className={cn(
                          "rounded-2xl px-5 py-5 flex items-center gap-3.5 relative",
                          item.bg,
                        )}
                      >
                        <div
                          className={cn(
                            "flex shrink-0 items-center justify-center rounded-xl h-11 w-11",
                            item.accent,
                          )}
                        >
                          <Icon className={cn("h-5 w-5", item.iconColor)} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80 leading-tight"
                            style={{
                              fontFeatureSettings: '"ss01", "cv01"',
                              textShadow: "0 1px 2px rgba(255,255,255,0.7)",
                            }}
                          >
                            {item.label}
                          </p>
                          <p
                            className="text-xl font-extrabold tracking-tight text-foreground leading-snug mt-1"
                            style={{
                              fontFeatureSettings: '"tnum", "ss01"',
                              textShadow: "0 1px 3px rgba(255,255,255,0.6)",
                            }}
                          >
                            {item.value}
                          </p>
                          <p
                            className="text-[11px] font-medium text-muted-foreground/70 leading-none mt-1"
                            style={{ textShadow: "0 1px 2px rgba(255,255,255,0.5)" }}
                          >
                            {item.sub}
                          </p>
                        </div>
                        {(item as any).hasCalendar && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted/40">
                                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-2" align="end">
                              <div className="flex flex-wrap gap-1 mb-2">
                                <Button
                                  size="sm"
                                  variant={totalSpendPeriod === "month" ? "default" : "outline"}
                                  className="h-6 text-[10px] px-2"
                                  onClick={() => {
                                    setTotalSpendPeriod("month");
                                    setTotalSpendFrom(startOfMonth(new Date()));
                                    setTotalSpendTo(new Date());
                                  }}
                                >
                                  This Month
                                </Button>
                                <Button
                                  size="sm"
                                  variant={totalSpendPeriod === "alltime" ? "default" : "outline"}
                                  className="h-6 text-[10px] px-2"
                                  onClick={() => setTotalSpendPeriod("alltime")}
                                >
                                  All Time
                                </Button>
                              </div>
                              <Calendar
                                mode="range"
                                selected={{ from: totalSpendFrom, to: totalSpendTo }}
                                onSelect={(range: any) => {
                                  if (range?.from) {
                                    setTotalSpendFrom(range.from);
                                    setTotalSpendPeriod("custom");
                                  }
                                  if (range?.to) setTotalSpendTo(range.to);
                                }}
                                numberOfMonths={1}
                                className="p-2 pointer-events-auto"
                              />
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Wallet summaries stay together before account statistics. */}
                <div className="grid grid-cols-1 gap-2 sm:gap-3 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">


                  {/* Wallet Balance */}
                  <MainWalletDebitCard
                    title="Wallet Balance"
                    balanceLabel={`$${walletBalance.toLocaleString()}`}
                    actions={
                      <div className="flex items-center gap-1">
                        <button
                          className="h-6 w-6 rounded-md flex items-center justify-center bg-primary-foreground/20 hover:bg-primary-foreground/35 transition-colors"
                          onClick={() => {
                            setWalletDialogType("credit");
                            setWalletAmount("");
                            setWalletNote("");
                          }}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          className="h-6 w-6 rounded-md flex items-center justify-center bg-primary-foreground/20 hover:bg-primary-foreground/35 transition-colors"
                          onClick={() => {
                            setWalletDialogType("debit");
                            setWalletAmount("");
                            setWalletNote("");
                          }}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                      </div>
                    }
                  />

                  {/* Extra wallets + combined total — admin controlled */}
                  {userId && <SecondaryWalletCard userId={userId} />}
                  {userId && <CreditLineWalletCard userId={userId} />}
                  {userId && <CombinedTotalCard userId={userId} />}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Card className="border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-teal-100 dark:bg-teal-900/40">
                          <MonitorSmartphone className="h-4.5 w-4.5 text-teal-600" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">Total Ad Accounts</p>
                      </div>
                      <p className="text-2xl font-bold tracking-tight text-foreground">
                        {adAccounts?.length ?? 0}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Active Accounts */}
                  <Card className="border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-emerald-100 dark:bg-emerald-900/40">
                          <CheckCircle className="h-4.5 w-4.5 text-emerald-600" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">Active Accounts</p>
                      </div>
                      <p className="text-2xl font-bold tracking-tight text-foreground">
                        {activeAccounts.length}
                      </p>
                    </CardContent>
                  </Card>

                  {/* Disabled Accounts */}
                  <Card className="border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-red-100 dark:bg-red-900/40">
                          <XCircle className="h-4.5 w-4.5 text-red-600" />
                        </div>
                        <p className="text-sm font-semibold text-foreground">Disabled Accounts</p>
                      </div>
                      <p className="text-2xl font-bold tracking-tight text-foreground">
                        {disabledAccounts.length}
                      </p>
                    </CardContent>
                  </Card>
                </div>

              </div>
            )}

            {/* Ad Accounts */}
            <div>
              <div className={cn("flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between", isMobile && "mb-2")}>
                <h2 className="text-base font-semibold text-foreground">
                  Ad Accounts ({adAccounts?.length ?? 0})
                </h2>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {showUnassignCheckboxes && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full text-xs h-7"
                      onClick={() => {
                        const all = filteredAdAccounts ?? [];
                        if (all.length > 0 && all.every((a: any) => unassignSelectedIds.has(a.id)))
                          setUnassignSelectedIds(new Set());
                        else setUnassignSelectedIds(new Set(all.map((a: any) => a.id)));
                      }}
                    >
                      {(filteredAdAccounts?.length ?? 0) > 0 &&
                      filteredAdAccounts?.every((a: any) => unassignSelectedIds.has(a.id))
                        ? "Clear all"
                        : "Select all"}
                    </Button>
                  )}
                  {showUnassignCheckboxes && unassignSelectedIds.size > 0 && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full text-xs h-7"
                        disabled={bulkBusy}
                        onClick={async () => {
                          const ids = Array.from(unassignSelectedIds);
                          setBulkBusy(true);
                          try {
                            const { chunkedMetaSync } = await import("@/lib/chunkedMetaSync");
                            const res = await chunkedMetaSync(ids);
                            const failed = res?.failed_account_ids?.length ?? 0;
                            if (failed > 0)
                              toast.warning(`${ids.length - failed}/${ids.length} updated · ${failed} failed`);
                            else toast.success(`${ids.length} account(s) updated from Meta`);
                            refetchAdAccounts();
                            queryClient.invalidateQueries({ queryKey: ["admin-insights-cache"] });
                          } catch (err: any) {
                            toast.error(err?.message || "Update failed");
                          } finally {
                            setBulkBusy(false);
                          }
                        }}
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5 mr-1", bulkBusy && "animate-spin")} />
                        Update {unassignSelectedIds.size}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full text-xs h-7"
                        disabled={bulkBusy}
                        onClick={async () => {
                          const ids = Array.from(unassignSelectedIds);
                          setBulkBusy(true);
                          try {
                            const { error } = await (supabase as any)
                              .from("user_ad_accounts")
                              .delete()
                              .eq("user_id", userId!)
                              .in("ad_account_id", ids);
                            if (error) throw error;
                            toast.success(`${ids.length} account(s) unassigned`);
                            setUnassignSelectedIds(new Set());
                            setShowUnassignCheckboxes(false);
                            refetchAdAccounts();
                            queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
                          } catch (err: any) {
                            toast.error(err?.message || "Unassign failed");
                          } finally {
                            setBulkBusy(false);
                          }
                        }}
                      >
                        Unassign {unassignSelectedIds.size}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="rounded-full text-xs h-7"
                        disabled={bulkBusy}
                        onClick={async () => {
                          const ids = Array.from(unassignSelectedIds);
                          if (
                            !window.confirm(
                              `Delete ${ids.length} ad account(s) permanently? This removes all associated data.`,
                            )
                          )
                            return;
                          setBulkBusy(true);
                          try {
                            try {
                              await Promise.all([
                                (supabase as any).from("bm_access_requests").delete().in("ad_account_id", ids),
                                (supabase as any).from("top_up_requests").delete().in("ad_account_id", ids),
                                (supabase as any)
                                  .from("ad_account_requests")
                                  .update({ assigned_ad_account_id: null })
                                  .in("assigned_ad_account_id", ids),
                                supabase.from("ad_account_insights").delete().in("ad_account_id", ids),
                              ]);
                            } catch (cleanupErr: any) {
                              console.warn("Pre-delete cleanup warning:", cleanupErr?.message || cleanupErr);
                            }
                            const { error } = await supabase.from("ad_accounts").delete().in("id", ids);
                            if (error) throw error;
                            const names = ids
                              .map(
                                (id) =>
                                  adAccounts?.find((a: any) => a.id === id)?.account_name || id.slice(0, 8),
                              )
                              .join(", ");
                            void logSystemAction("Ad Account Deleted", names);
                            toast.success(`${ids.length} ad account(s) deleted`);
                            setUnassignSelectedIds(new Set());
                            setShowUnassignCheckboxes(false);
                            refetchAdAccounts();
                            queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
                            queryClient.invalidateQueries({ queryKey: ["admin-insights-cache"] });
                            queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
                          } catch (err: any) {
                            toast.error(err?.message || "Delete failed");
                          } finally {
                            setBulkBusy(false);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete {unassignSelectedIds.size}
                      </Button>
                    </>
                  )}

                  <Button
                    variant={showUnassignCheckboxes ? "secondary" : "ghost"}
                    size="icon"
                    className="h-7 w-7 rounded-full"
                    onClick={() => {
                      setShowUnassignCheckboxes((v) => !v);
                      if (showUnassignCheckboxes) setUnassignSelectedIds(new Set());
                    }}
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-full h-7 text-xs"
                    onClick={() => {
                      setShowAssignDialog(true);
                      setAssignSelectedIds(new Set());
                      setAssignSearch("");
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Assign
                  </Button>
                </div>
              </div>

              {/* Search bar for ad accounts */}
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={adAccountSearch}
                    onChange={(e) => setAdAccountSearch(e.target.value)}
                    placeholder="Search ad account by name or ID..."
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <Select
                  value={adAccountStatusFilter}
                  onValueChange={(v) => setAdAccountStatusFilter(v as any)}
                >
                  <SelectTrigger className="h-9 text-sm sm:w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isMobile ? (
                renderMobileAdAccountCards()
              ) : (
                <Card className="border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
                  <CardContent className="p-0">
                    {filteredAdAccounts?.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        {adAccountSearch ? "No accounts match your search" : "No ad accounts assigned"}
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              {showUnassignCheckboxes && (
                                <TableHead className="w-[40px]">
                                  <Checkbox
                                    checked={
                                      (filteredAdAccounts?.length ?? 0) > 0 &&
                                      filteredAdAccounts?.every((a: any) => unassignSelectedIds.has(a.id))
                                    }
                                    onCheckedChange={() => {
                                      if (
                                        filteredAdAccounts?.every((a: any) => unassignSelectedIds.has(a.id))
                                      )
                                        setUnassignSelectedIds(new Set());
                                      else
                                        setUnassignSelectedIds(
                                          new Set(filteredAdAccounts?.map((a: any) => a.id)),
                                        );
                                    }}
                                  />
                                </TableHead>
                              )}
                              <TableHead className="w-[200px]">
                                <span className="text-xs font-medium">Ad Account</span>
                              </TableHead>
                              <TableHead className="w-[100px]">
                                <span className="text-xs font-medium">Budget</span>
                              </TableHead>
                              <TableHead className="w-[90px]">
                                <span className="text-xs font-medium">Status</span>
                              </TableHead>
                              <TableHead className="w-[90px]">
                                <button
                                  type="button"
                                  className="text-xs font-medium inline-flex items-center gap-1 hover:text-primary"
                                  onClick={() => toggleAdAccountSort("balance")}
                                >
                                  Balance
                                  {adAccountSort.field === "balance" ? (adAccountSort.dir === "desc" ? "↓" : "↑") : "↕"}
                                </button>
                              </TableHead>
                              <TableHead className="w-[100px]">
                                <button
                                  type="button"
                                  className="text-xs font-medium inline-flex items-center gap-1 hover:text-primary"
                                  onClick={() => toggleAdAccountSort("today")}
                                >
                                  Today
                                  {adAccountSort.field === "today" ? (adAccountSort.dir === "desc" ? "↓" : "↑") : "↕"}
                                </button>
                              </TableHead>
                              <TableHead className="w-[100px]">
                                <button
                                  type="button"
                                  className="text-xs font-medium inline-flex items-center gap-1 hover:text-primary"
                                  onClick={() => toggleAdAccountSort("yesterday")}
                                >
                                  Yesterday
                                  {adAccountSort.field === "yesterday" ? (adAccountSort.dir === "desc" ? "↓" : "↑") : "↕"}
                                </button>
                              </TableHead>
                              <TableHead className="w-[110px]">
                                <span className="text-xs font-medium">Card</span>
                              </TableHead>
                              <TableHead className="w-[50px]">
                                <span className="text-xs font-medium">Actions</span>
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredAdAccounts?.map((acc: any) => {
                              const ins = insights?.[acc.id];
                              return (
                                <TableRow
                                  key={acc.id}
                                  className="cursor-pointer hover:bg-muted/50"
                                  onClick={() => navigate(`/ad-accounts/${acc.id}`)}
                                >
                                  {showUnassignCheckboxes && (
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                      <Checkbox
                                        checked={unassignSelectedIds.has(acc.id)}
                                        onCheckedChange={() => {
                                          setUnassignSelectedIds((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(acc.id)) next.delete(acc.id);
                                            else next.add(acc.id);
                                            return next;
                                          });
                                        }}
                                      />
                                    </TableCell>
                                  )}
                                  <TableCell>
                                    <div className="flex items-center gap-3">
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                                        <AppWindow className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                      <div>
                                        <div className="text-sm text-primary">
                                          {acc.account_name}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5">
                                          <span className="text-xs text-muted-foreground font-mono">
                                            {acc.account_id.replace(/^act_/, "")}
                                          </span>
                                          <a
                                            href={`https://business.facebook.com/billing_hub/accounts/details?asset_id=${acc.account_id.replace(/^act_/, "")}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-muted-foreground hover:text-primary"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                          </a>
                                        </div>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell onClick={(e) => e.stopPropagation()}>
                                    <SpendProgressBar
                                      amountSpent={Number(acc.amount_spent)}
                                      spendCap={Number(acc.spend_cap)}
                                      balanceAfterTopup={Number(
                                        (acc as any).balance_after_topup ?? 0,
                                      )}
                                    />
                                    {limitWatches[acc.id] && (
                                      <div className="mt-1 max-w-[130px] whitespace-normal">
                                        <LimitUpdateIndicator state={limitWatches[acc.id]} />
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <StatusBadge status={acc.status} />
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    <div className="flex items-center gap-1">
                                      <span className="text-sm">
                                        $
                                        {ins?.balance?.toLocaleString(undefined, {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        }) ?? "—"}
                                      </span>
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-6 w-6 border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground"
                                        disabled={singleRefreshingId === acc.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          refreshSingleMutation.mutate(acc.id);
                                        }}
                                      >
                                        <RefreshCw
                                          className={cn(
                                            "h-3 w-3",
                                            singleRefreshingId === acc.id && "animate-spin",
                                          )}
                                        />
                                      </Button>
                                    </div>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    <span className="text-sm">
                                      $
                                      {ins?.today_spend?.toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      }) ?? "—"}
                                    </span>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap">
                                    <span className="text-sm">
                                      $
                                      {ins?.yesterday_spend?.toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      }) ?? "—"}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <div className="text-sm whitespace-nowrap">
                                      {ins?.cards && ins.cards.length > 0 ? (
                                        ins.cards.map((card: any, i: number) => (
                                          <div key={i} className="flex items-center gap-1.5">
                                            <CardBrandIcon
                                              displayString={card.display_string}
                                              size="xs"
                                            />
                                            <span>{card.display_string}</span>
                                          </div>
                                        ))
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center gap-1.5">
                                      {(acc.external_topup_required ? !!acc.external_topup_url : true) && (
                                      <Button
                                        size="icon"
                                        variant="default"
                                        className="h-8 w-8"
                                        onClick={() => {
                                          if (acc.external_topup_required) {
                                            setExtTopUp({ account: acc, wallet: "primary" });
                                            return;
                                          }
                                          setSelectedAccountId(acc.id);
                                          setTopUpWallet("primary");
                                          setTopUpDialogOpen(true);
                                          setTopUpAmount("");
                                          setDialogTab("topup");
                                        }}
                                        title={acc.external_topup_required ? "Top Up via External CRM (Main Wallet)" : "Top Up (Main Wallet)"}
                                      >
                                        <ArrowUpCircle className="h-4 w-4" />
                                      </Button>
                                      )}
                                      {(acc.external_topup_required ? !!acc.external_topup_url_secondary : wallets.secondaryEnabled) && (
                                        <Button
                                          size="icon"
                                          className="h-8 w-8 bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
                                          onClick={() => {
                                            if (acc.external_topup_required) {
                                              setExtTopUp({ account: acc, wallet: "secondary" });
                                              return;
                                            }
                                            setSelectedAccountId(acc.id);
                                            setTopUpWallet("secondary");
                                            setTopUpDialogOpen(true);
                                            setTopUpAmount("");
                                            setDialogTab("topup");
                                          }}
                                          title={acc.external_topup_required ? "Top Up via External CRM (Secondary Wallet)" : "Top Up (Secondary Wallet)"}
                                        >
                                          <ArrowUpCircle className="h-4 w-4" />
                                        </Button>
                                       )}
                                        {!!acc.external_topup_url_credit_line && (
                                          <Button
                                            size="sm"
                                            className="h-8 gap-1 px-2.5 text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white"
                                            onClick={() => {
                                              setExtTopUp({ account: acc, wallet: "credit_line" });
                                            }}
                                            title="Top Up via External CRM (Credit Line Wallet)"
                                          >
                                            <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
                                            <span className="truncate">Credit Line</span>
                                          </Button>
                                        )}
                                      <Button
                                        size="icon"
                                        variant={acc.client_topup_disabled ? "destructive" : "outline"}
                                        className="h-8 w-8"
                                        title={acc.client_topup_disabled ? "Client top-up is disabled — click to enable" : "Disable client top-up (admin only)"}
                                        onClick={async () => {
                                          const next = !acc.client_topup_disabled;
                                          const { error } = await (supabase as any)
                                            .from("ad_accounts")
                                            .update({ client_topup_disabled: next })
                                            .eq("id", acc.id);
                                          if (error) { toast.error(error.message); return; }
                                          toast.success(next ? "Client top-up disabled" : "Client top-up enabled");
                                          refetchAdAccounts();
                                        }}
                                      >
                                        {acc.client_topup_disabled ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Transactions Tab */}
          <TabsContent value="transactions" className="mt-0 space-y-4">
            <MonthlyUsageExport
              transactions={transactions}
              adAccounts={adAccounts}
              secondaryEnabled={wallets.secondaryEnabled}
              clientName={profile?.full_name || profile?.email || undefined}
            />
            <TransactionHistoryPanel
              transactions={transactions}
              adAccounts={adAccounts}
              secondaryEnabled={wallets.secondaryEnabled}
              isMobile={isMobile}
              resolveProcessedBy={(tx: any) => {
                const pb = tx.processed_by || "";
                if (pb === "system") return "Auto Approved by System";
                if (pb.startsWith("admin:")) {
                  const adminId = pb.split(":")[1];
                  const adminProf = allProfiles?.find((p: any) => p.user_id === adminId);
                  return adminProf?.full_name || adminProf?.email || adminId.slice(0, 8);
                }
                if (pb.startsWith("client:")) return profile?.full_name || profile?.email || "Client";
                return "—";
              }}
            />
          </TabsContent>


          {/* Bank Info Tab */}
          <TabsContent value="banks" className="mt-0 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Assigned Banks</h2>
              <Button
                size="sm"
                className="rounded-full h-7 text-xs"
                onClick={() => {
                  setShowBankAssignDialog(true);
                  setBankAssignSelected(new Set());
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Assign Bank
              </Button>
            </div>
            {!assignedBanks || assignedBanks.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  No banks assigned to this client
                </CardContent>
              </Card>
            ) : (
              <div
                className={cn(
                  "grid gap-3",
                  isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3",
                )}
              >
                {assignedBanks.map((cb: any) => {
                  const bank = cb.bank_accounts;
                  if (!bank) return null;
                  return (
                    <Card key={cb.id} className="border border-border/50">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                              <Landmark className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-semibold text-sm">{bank.bank_name}</p>
                              <p className="text-xs text-muted-foreground">{bank.account_name}</p>
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={async () => {
                              if (!confirm("Remove this bank from client?")) return;
                              await supabase.from("client_banks").delete().eq("id", cb.id);
                              toast.success("Bank removed");
                              refetchBanks();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                          <p>
                            Account:{" "}
                            <span className="font-mono text-foreground">{bank.account_number}</span>
                          </p>
                          {bank.branch && <p>Branch: {bank.branch}</p>}
                          <p>
                            Assigned:{" "}
                            {cb.assigned_at ? format(new Date(cb.assigned_at), "MMM d, yyyy") : "—"}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Top Up History Tab */}
          <TabsContent value="topups" className="mt-0">
            <Card className="border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Top-Up History</CardTitle>
              </CardHeader>
              <CardContent>
                {isMobile ? (
                  <div className="space-y-2.5">
                    {topUpRequests?.map((r: any) => (
                      <Card key={r.id} className="border border-border/60 shadow-sm">
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-semibold">
                                ${Number(r.amount).toLocaleString()}
                              </p>
                              {r.bdt_amount && (
                                <p className="text-xs text-muted-foreground">
                                  ৳{Number(r.bdt_amount).toLocaleString()}
                                </p>
                              )}
                            </div>
                            <Badge
                              variant={
                                r.status === "approved"
                                  ? "default"
                                  : r.status === "pending"
                                    ? "secondary"
                                    : "destructive"
                              }
                            >
                              {r.status}
                            </Badge>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                            <p>{format(new Date(r.created_at), "MMM d, yyyy HH:mm")}</p>
                            {r.payment_method && (
                              <p>Method: {r.payment_method.replace(/_/g, " ")}</p>
                            )}
                            {r.usd_rate && <p>Rate: ৳{r.usd_rate}</p>}
                            {r.invoices && r.invoices.length > 0 && (
                              <p className="text-primary font-medium">
                                Invoice: {r.invoices[0].invoice_number}
                              </p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {(!topUpRequests || topUpRequests.length === 0) && (
                      <p className="text-center text-muted-foreground py-8 text-sm">
                        No top-up requests yet
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Date</TableHead>
                          <TableHead>Amount (USD)</TableHead>
                          <TableHead>BDT Amount</TableHead>
                          <TableHead>Rate</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Proof</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topUpRequests?.map((r: any) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {format(new Date(r.created_at), "MMM d, yyyy HH:mm")}
                            </TableCell>
                            <TableCell className="font-semibold text-sm">
                              ${Number(r.amount).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-sm">
                              {r.bdt_amount ? `৳${Number(r.bdt_amount).toLocaleString()}` : "—"}
                            </TableCell>
                            <TableCell className="text-sm">
                              {r.usd_rate ? `৳${r.usd_rate}` : "—"}
                            </TableCell>
                            <TableCell className="text-xs capitalize">
                              {r.payment_method?.replace(/_/g, " ") || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  r.status === "approved"
                                    ? "default"
                                    : r.status === "pending"
                                      ? "secondary"
                                      : "destructive"
                                }
                              >
                                {r.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {r.invoices && r.invoices.length > 0 ? (
                                <span className="text-primary font-medium">
                                  {r.invoices[0].invoice_number}
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell>
                              {r.proof_url ? (
                                <a
                                  href={r.proof_url}
                                  onClick={(e) => { e.preventDefault(); openProof(r.proof_url); }}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline text-xs flex items-center gap-1"
                                >
                                  <Eye className="h-3 w-3" /> View
                                </a>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {(!topUpRequests || topUpRequests.length === 0) && (
                          <TableRow>
                            <TableCell
                              colSpan={8}
                              className="text-center text-muted-foreground py-8"
                            >
                              No top-up requests yet
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Unused Accounts Tab */}
          <TabsContent value="unused" className="mt-0">
            <Card className="border-border/40 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              <CardHeader className={cn("pb-4", isMobile && "p-4 pb-3")}>
                <CardTitle className="text-base flex items-center gap-2">
                  <AppWindow className="h-4 w-4 text-primary" />
                  Unused Ad Accounts
                </CardTitle>
              </CardHeader>
              <CardContent className={cn(isMobile && "p-4 pt-0")}>
                <UnusedAccountsView
                  accounts={(adAccounts ?? []).map((a: any) => ({
                    id: a.id,
                    account_id: a.account_id,
                    account_name: a.account_name,
                    status: a.status,
                    spend_cap: a.spend_cap,
                    amount_spent: a.amount_spent,
                    created_at: a.created_at,
                    business_managers: a.business_managers,
                    last_spend_date: insights?.[a.id]?.last_spend_date ?? null,
                    balance: insights?.[a.id]?.balance ?? null,
                  }))}
                  emptyMessage="🎉 This client has no inactive accounts in this range."
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Assign Accounts Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className={cn("max-h-[80vh] overflow-y-auto", isMobile && "max-w-[95vw]")}>
          <DialogHeader>
            <DialogTitle>Assign Ad Accounts</DialogTitle>
            <DialogDescription>Select accounts to assign to this client.</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or ID..."
                value={assignSearch}
                onChange={(e) => setAssignSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto space-y-1">
              {(() => {
                const assignedIds = new Set(adAccounts?.map((a: any) => a.id) ?? []);
                const q = assignSearch.toLowerCase();
                const unassigned =
                  allAdAccounts?.filter((a: any) => {
                    if (assignedIds.has(a.id)) return false;
                    if (
                      q &&
                      !a.account_name?.toLowerCase().includes(q) &&
                      !a.account_id?.toLowerCase().includes(q)
                    )
                      return false;
                    return true;
                  }) ?? [];
                if (unassigned.length === 0)
                  return (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No unassigned accounts found
                    </p>
                  );
                return unassigned.map((acc: any) => (
                  <label
                    key={acc.id}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                  >
                    <Checkbox
                      checked={assignSelectedIds.has(acc.id)}
                      onCheckedChange={() => {
                        setAssignSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(acc.id)) next.delete(acc.id);
                          else next.add(acc.id);
                          return next;
                        });
                      }}
                    />
                    <div>
                      <p className="text-sm font-medium">{acc.account_name}</p>
                      <p className="text-xs text-muted-foreground">{acc.account_id}</p>
                    </div>
                  </label>
                ));
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={assignSelectedIds.size === 0}
              onClick={async () => {
                const ids = Array.from(assignSelectedIds);
                // Delete existing assignments first to avoid unique constraint violation
                await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", ids);
                const { error } = await (supabase as any)
                  .from("user_ad_accounts")
                  .insert(
                    ids.map((adAccountId) => ({ user_id: userId, ad_account_id: adAccountId })),
                  );
                if (error) {
                  toast.error(error.message);
                  return;
                }
                toast.success(`${ids.length} account(s) assigned`);
                setShowAssignDialog(false);
                setAssignSelectedIds(new Set());
                refetchAdAccounts();
                queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
              }}
            >
              Assign {assignSelectedIds.size > 0 ? `${assignSelectedIds.size} ` : ""}Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet Adjust Dialog */}
      <Dialog open={!!walletDialogType} onOpenChange={(open) => !open && setWalletDialogType(null)}>
        <DialogContent className="max-w-[95vw] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {walletDialogType === "credit" ? "Add Balance" : "Deduct Balance"}
            </DialogTitle>
            <DialogDescription>
              Current balance:{" "}
              <span className="font-semibold">${walletBalance.toLocaleString()}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Amount (USD)</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
                placeholder="100.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Textarea
                value={walletNote}
                onChange={(e) => setWalletNote(e.target.value)}
                placeholder="Reason for adjustment..."
                rows={2}
              />
            </div>
            {walletDialogType === "credit" && parseFloat(walletAmount) > 0 && (
              <p className="text-sm text-muted-foreground">
                New balance:{" "}
                <span className="font-semibold text-emerald-600">
                  ${(walletBalance + parseFloat(walletAmount)).toLocaleString()}
                </span>
              </p>
            )}
            {walletDialogType === "debit" && parseFloat(walletAmount) > 0 && (
              <p className="text-sm text-muted-foreground">
                New balance:{" "}
                <span
                  className={cn(
                    "font-semibold",
                    walletBalance - parseFloat(walletAmount) < 0
                      ? "text-destructive"
                      : "text-emerald-600",
                  )}
                >
                  ${(walletBalance - parseFloat(walletAmount)).toLocaleString()}
                </span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletDialogType(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => walletAdjustMutation.mutate()}
              disabled={
                !walletAmount || parseFloat(walletAmount) <= 0 || walletAdjustMutation.isPending
              }
            >
              {walletAdjustMutation.isPending
                ? "Processing..."
                : walletDialogType === "credit"
                  ? "Add Balance"
                  : "Deduct Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* External CRM Top-Up Dialog */}
      {extTopUp && (
        <ExternalTopUpDialog
          open={!!extTopUp}
          onOpenChange={(open) => { if (!open) setExtTopUp(null); }}
          account={extTopUp.account}
          walletKind={extTopUp.wallet}
        />
      )}

      {/* Top Up / Withdraw Tabbed Dialog */}
      <Dialog
        open={topUpDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTopUpDialogOpen(false);
            setDialogTab("topup");
            setWithdrawMeta(null);
            setWithdrawAmount("");
            setTopUpAmount("");
            setSelectedAccountId("");
          }
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {selectedAccountId
                ? (adAccounts?.find((a: any) => a.id === selectedAccountId)?.account_name ??
                  "Ad Account")
                : "Ad Account Action"}
            </DialogTitle>
            <DialogDescription>
              {selectedAccountId
                ? adAccounts
                    ?.find((a: any) => a.id === selectedAccountId)
                    ?.account_id?.replace(/^act_/, "")
                : "Select an ad account and choose an action"}
            </DialogDescription>
          </DialogHeader>

          {/* Account selector - show if no account pre-selected */}
          {!selectedAccountId && (
            <div className="space-y-2">
              <Label>Ad Account</Label>
              <Select
                value={selectedAccountId}
                onValueChange={(val) => {
                  setSelectedAccountId(val);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select ad account" />
                </SelectTrigger>
                <SelectContent>
                  {adAccounts?.map((acc: any) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_name} ({acc.account_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedAccountId && (
            <Tabs
              value={dialogTab}
              onValueChange={(v) => {
                const tab = v as "topup" | "withdraw";
                setDialogTab(tab);
                if (tab === "withdraw" && !withdrawMeta && !fetchingWithdrawMeta)
                  fetchWithdrawMeta(selectedAccountId);
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="topup">Increase Limit</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>
              <TabsContent value="topup" className="space-y-4 pt-2">
                <div className="flex justify-between items-center text-sm p-3 rounded-lg bg-muted">
                  <span className="flex items-center gap-2">
                    <Wallet className="h-4 w-4" /> Client Wallet
                  </span>
                  <span
                    className={cn("font-semibold", walletBalance < 0 ? "text-destructive" : "")}
                  >
                    ${walletBalance.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current Spend Cap</span>
                  <span className="font-medium">
                    $
                    {Number(
                      adAccounts?.find((a: any) => a.id === selectedAccountId)?.spend_cap ?? 0,
                    ).toLocaleString()}
                  </span>
                </div>
                <div className="space-y-2">
                  <Label>Amount to Add (USD)</Label>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    placeholder="500.00"
                  />
                </div>
                {selectedAccountId && parseFloat(topUpAmount) > 0 && (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">New Spend Cap</span>
                      <span className="font-medium text-primary">
                        $
                        {(
                          Number(
                            adAccounts?.find((a: any) => a.id === selectedAccountId)?.spend_cap ??
                              0,
                          ) + parseFloat(topUpAmount)
                        ).toLocaleString()}
                      </span>
                    </div>
                    {topUpWallet === "primary" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Main Wallet After</span>
                        <span
                          className={cn(
                            "font-medium",
                            walletBalance - parseFloat(topUpAmount) < 0 ? "text-destructive" : "",
                          )}
                        >
                          ${(walletBalance - parseFloat(topUpAmount)).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {topUpWallet === "credit_line" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Credit Line Wallet After</span>
                        <span
                          className={cn(
                            "font-medium",
                            wallets.creditLineBalance - parseFloat(topUpAmount) < 0 ? "text-destructive" : "",
                          )}
                        >
                          ${(wallets.creditLineBalance - parseFloat(topUpAmount)).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {wallets.secondaryEnabled && topUpWallet === "secondary" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Secondary Wallet After</span>
                        <span
                          className={cn(
                            "font-medium",
                            wallets.secondaryBalance - parseFloat(topUpAmount) < 0 ? "text-destructive" : "",
                          )}
                        >
                          ${(wallets.secondaryBalance - parseFloat(topUpAmount)).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setTopUpDialogOpen(false)}>
                    Cancel
                  </Button>
                  {topUpWallet === "credit_line" ? (
                    <Button
                      className="bg-sky-600 hover:bg-sky-700 text-white"
                      onClick={() => topUpMutation.mutate("credit_line")}
                      disabled={
                        !selectedAccountId ||
                        !topUpAmount ||
                        parseFloat(topUpAmount) <= 0 ||
                        topUpMutation.isPending
                      }
                    >
                      {topUpMutation.isPending ? "Processing..." : "Top Up (Credit Line)"}
                    </Button>
                  ) : wallets.secondaryEnabled && topUpWallet === "secondary" ? (
                    <Button
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => topUpMutation.mutate("secondary")}
                      disabled={
                        !selectedAccountId ||
                        !topUpAmount ||
                        parseFloat(topUpAmount) <= 0 ||
                        topUpMutation.isPending
                      }
                    >
                      {topUpMutation.isPending ? "Processing..." : "Top Up (Secondary)"}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => topUpMutation.mutate("primary")}
                      disabled={
                        !selectedAccountId ||
                        !topUpAmount ||
                        parseFloat(topUpAmount) <= 0 ||
                        topUpMutation.isPending
                      }
                    >
                      {topUpMutation.isPending ? "Processing..." : "Top Up Now"}
                    </Button>
                  )}
                </DialogFooter>


              </TabsContent>
              <TabsContent value="withdraw" className="space-y-4 pt-2">
                {fetchingWithdrawMeta ? (
                  <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Fetching real-time data from Meta...</span>
                  </div>
                ) : withdrawMeta ? (
                  <>
                    {/* Destination wallet — admin picks where the withdrawn balance lands */}
                    <div className="space-y-2">
                      <Label>Credit To Wallet</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setWithdrawWallet("primary")}
                          className={cn(
                            "rounded-lg border p-2.5 text-left transition-colors",
                            withdrawWallet === "primary"
                              ? "border-primary bg-primary/10"
                              : "border-border hover:bg-muted/60",
                          )}
                        >
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Wallet className="h-3.5 w-3.5" /> Main Wallet
                          </span>
                          <span className="mt-0.5 block text-sm font-semibold">
                            ${walletBalance.toLocaleString()}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={!wallets.secondaryEnabled}
                          onClick={() => setWithdrawWallet("secondary")}
                          className={cn(
                            "rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                            withdrawWallet === "secondary"
                              ? "border-emerald-500 bg-emerald-500/10"
                              : "border-border hover:bg-muted/60",
                          )}
                        >
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <Wallet className="h-3.5 w-3.5" /> Secondary Wallet
                          </span>
                          <span className="mt-0.5 block text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            ${wallets.secondaryBalance.toLocaleString()}
                          </span>
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Withdrawn balance{" "}
                        <span className="font-medium">
                          {withdrawWallet === "secondary" ? "Secondary Wallet" : "Main Wallet"}
                        </span>{" "}
                        e joma hobe.
                      </p>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current Spend Cap (Meta)</span>
                      <span className="font-medium">
                        $
                        {withdrawMeta.current_spend_cap.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Amount Spent (Real-time)</span>
                      <span className="font-medium">
                        $
                        {withdrawMeta.real_amount_spent.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold">
                      <span className="text-muted-foreground">Max Withdrawable</span>
                      <span className="text-primary">
                        $
                        {withdrawMeta.max_withdrawable.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <Label>Withdraw Amount (USD)</Label>
                      <Input
                        type="number"
                        min="1"
                        max={withdrawMeta.max_withdrawable}
                        step="0.01"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder={`Max $${withdrawMeta.max_withdrawable.toFixed(2)}`}
                      />
                      {parseFloat(withdrawAmount) > withdrawMeta.max_withdrawable && (
                        <p className="text-sm text-destructive">
                          Amount exceeds maximum withdrawable
                        </p>
                      )}
                    </div>
                    {parseFloat(withdrawAmount) > 0 &&
                      parseFloat(withdrawAmount) <= withdrawMeta.max_withdrawable && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">New Spend Cap</span>
                          <span className="font-medium text-primary">
                            $
                            {(
                              withdrawMeta.current_spend_cap - parseFloat(withdrawAmount)
                            ).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setTopUpDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => withdrawMutation.mutate()}
                        disabled={
                          !withdrawAmount ||
                          parseFloat(withdrawAmount) <= 0 ||
                          !withdrawMeta ||
                          parseFloat(withdrawAmount) > withdrawMeta.max_withdrawable ||
                          withdrawMutation.isPending
                        }
                        variant="destructive"
                      >
                        {withdrawMutation.isPending ? "Processing..." : "Withdraw Now"}
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <div className="text-center py-6 text-sm text-muted-foreground">
                    Unable to fetch data. Please try again.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
      {/* Set Password Dialog */}
      <Dialog open={passwordDialog} onOpenChange={setPasswordDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Set Password
            </DialogTitle>
            <DialogDescription>
              Set a new password for <strong>{profile?.full_name || profile?.email}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>New Password</Label>
              <Input
                type="text"
                placeholder="Enter new password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newPassword || newPassword.length < 6 || setPasswordMutation.isPending}
              onClick={() => setPasswordMutation.mutate()}
            >
              {setPasswordMutation.isPending ? "Updating..." : "Set Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bank Assign Dialog */}
      <Dialog open={showBankAssignDialog} onOpenChange={setShowBankAssignDialog}>
        <DialogContent className={cn("max-h-[80vh] overflow-y-auto", isMobile && "max-w-[95vw]")}>
          <DialogHeader>
            <DialogTitle>Assign Bank Accounts</DialogTitle>
            <DialogDescription>Select banks to assign to this client.</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-1 max-h-[50vh] overflow-y-auto">
            {(() => {
              const assignedIds = new Set(
                assignedBanks?.map((cb: any) => cb.bank_account_id) ?? [],
              );
              const unassigned = allBanks?.filter((b: any) => !assignedIds.has(b.id)) ?? [];
              if (unassigned.length === 0)
                return (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No available banks
                  </p>
                );
              return unassigned.map((bank: any) => (
                <label
                  key={bank.id}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted cursor-pointer"
                >
                  <Checkbox
                    checked={bankAssignSelected.has(bank.id)}
                    onCheckedChange={() => {
                      setBankAssignSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(bank.id)) next.delete(bank.id);
                        else next.add(bank.id);
                        return next;
                      });
                    }}
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {bank.bank_name} — {bank.account_name}
                    </p>
                    <p className="text-xs text-muted-foreground">{bank.account_number}</p>
                  </div>
                </label>
              ));
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBankAssignDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={bankAssignSelected.size === 0}
              onClick={async () => {
                const ids = Array.from(bankAssignSelected);
                const rows = ids.map((bankId) => ({ user_id: userId!, bank_account_id: bankId }));
                const { error } = await supabase
                  .from("client_banks")
                  .upsert(rows, { onConflict: "user_id,bank_account_id" } as any);
                if (error) {
                  toast.error(error.message);
                  return;
                }
                toast.success(`${ids.length} bank(s) assigned`);
                setShowBankAssignDialog(false);
                setBankAssignSelected(new Set());
                refetchBanks();
              }}
            >
              Assign {bankAssignSelected.size > 0 ? `${bankAssignSelected.size} ` : ""}Selected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
