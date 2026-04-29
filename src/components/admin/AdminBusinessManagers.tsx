import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, RefreshCw, Building2, ChevronDown, ChevronRight, Clock, AlertCircle, CheckCircle2, Search, Pencil, Trash2, ShieldCheck, Activity, KeyRound, Link2Off, ExternalLink, ShieldAlert, MoreHorizontal, UserPlus } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SilentRecoveryDialog } from "@/components/admin/SilentRecoveryDialog";
import { InviteToBmDialog } from "@/components/admin/InviteToBmDialog";
import { logSystemAction } from "@/lib/systemLog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { TenantRequestsPanel } from "@/components/admin/TenantRequestsPanel";

interface SyncedAccount {
  account_id: string;
  account_name: string;
  business_manager_id: string;
  business_name: string | null;
  status: string;
  spend_cap: number;
  amount_spent: number;
}

async function invokeBmFunction<T = any>(functionName: string, body?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }
  return data as T;
}

export function AdminBusinessManagers() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [bmId, setBmId] = useState("");
  const [bmName, setBmName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [expandedBm, setExpandedBm] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [syncingBmId, setSyncingBmId] = useState<string | null>(null);

  // Selective import state
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [syncedAccounts, setSyncedAccounts] = useState<SyncedAccount[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [importStatusFilter, setImportStatusFilter] = useState("all");
  const [importSearch, setImportSearch] = useState("");
  const [existingAccountIds, setExistingAccountIds] = useState<Set<string>>(new Set());

  // Edit BM state
  const [editOpen, setEditOpen] = useState(false);
  const [editBmId, setEditBmId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMetaId, setEditMetaId] = useState("");
  const [editAccessToken, setEditAccessToken] = useState("");
  const [deleteBmId, setDeleteBmId] = useState<string | null>(null);
  const [unlinkAccount, setUnlinkAccount] = useState<{ id: string; name: string } | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [revokeAllConfirm, setRevokeAllConfirm] = useState(false);
  const [recoveryDialogBmId, setRecoveryDialogBmId] = useState<string | null>(null);
  const [inviteDialogBm, setInviteDialogBm] = useState<{ id: string; name: string } | null>(null);
  const [checkingPermBmId, setCheckingPermBmId] = useState<string | null>(null);
  const [revokeSingleId, setRevokeSingleId] = useState<string | null>(null);

  // Manual single ad-account add
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualAdAccountId, setManualAdAccountId] = useState("");
  const [manualBmId, setManualBmId] = useState<string>("");

  const { data: bms } = useQuery({
    queryKey: ["admin-business-managers"],
    queryFn: async () => {
      const { data } = await supabase.from("business_managers").select("*").eq("platform", "meta").order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
  });

  const { data: adAccounts } = useQuery({
    queryKey: ["admin-bm-ad-accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("ad_accounts").select("*").not("business_manager_id", "is", null);
      return (data as any[]) ?? [];
    },
  });

  const { data: assignments } = useQuery({
    queryKey: ["admin-user-ad-accounts"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("user_ad_accounts").select("*");
      return (data as any[]) ?? [];
    },
  });

  const { data: clients } = useQuery({
    queryKey: ["admin-clients-list"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email");
      return (data as any[]) ?? [];
    },
  });

  const { data: syncLogs } = useQuery({
    queryKey: ["admin-sync-logs", showLogs],
    queryFn: async () => {
      if (!showLogs) return [];
      const { data } = await (supabase as any)
        .from("sync_logs")
        .select("*")
        .eq("business_manager_id", showLogs)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data as any[]) ?? [];
    },
    enabled: !!showLogs,
  });

  // API usage per BM (last 1 hour and last 24 hours)
  const { data: apiUsage } = useQuery({
    queryKey: ["admin-api-usage"],
    queryFn: async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await (supabase as any)
        .from("api_call_logs")
        .select("business_manager_id, call_count, created_at")
        .gte("created_at", oneDayAgo)
        .order("created_at", { ascending: false });
      
      const usage: Record<string, { lastHour: number; last24h: number }> = {};
      for (const row of (data ?? [])) {
        const bmId = row.business_manager_id;
        if (!usage[bmId]) usage[bmId] = { lastHour: 0, last24h: 0 };
        usage[bmId].last24h += row.call_count;
        if (row.created_at >= oneHourAgo) {
          usage[bmId].lastHour += row.call_count;
        }
      }
      return usage;
    },
    refetchInterval: false,
  });

  const addBmMutation = useMutation({
    mutationFn: async () => {
      const result = await invokeBmFunction<{ data?: any }>("manage-bm", {
        action: "create",
        bm_id: bmId,
        name: bmName,
        access_token: accessToken,
      });
      return result.data;
    },
    onSuccess: async (data) => {
      toast.success("Business Manager connected! Syncing ad accounts...");
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
      setOpen(false);
      setBmId("");
      setBmName("");
      setAccessToken("");
      if (data?.id) {
        setExpandedBm(data.id);
        syncMutation.mutate(data.id);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const syncMutation = useMutation({
    mutationFn: async (businessManagerId: string) => {
      setSyncingBmId(businessManagerId);
      return invokeBmFunction<{ accounts?: SyncedAccount[] }>("sync-bm-accounts", {
        business_manager_id: businessManagerId,
      });
    },
    onSuccess: async (result) => {
      const accounts: SyncedAccount[] = result.accounts ?? [];
      if (accounts.length === 0) {
        toast.info("No accounts found from Meta");
        return;
      }
      const { data: existing } = await supabase.from("ad_accounts").select("account_id");
      const existingIds = new Set((existing ?? []).map((a: any) => a.account_id));
      setExistingAccountIds(existingIds);
      setSyncedAccounts(accounts);
      setSelectedImportIds(new Set());
      setImportStatusFilter("all");
      setImportSearch("");
      setImportDialogOpen(true);
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-sync-logs"] });
    },
    onError: (err: any) => { toast.error(err.message); setSyncingBmId(null); },
    onSettled: () => setSyncingBmId(null),
  });

  const importMutation = useMutation({
    mutationFn: async (accounts: SyncedAccount[]) => {
      const rows = accounts.map((a) => ({
        account_id: a.account_id,
        account_name: a.account_name,
        business_manager_id: a.business_manager_id,
        business_name: a.business_name,
        status: a.status,
        spend_cap: a.spend_cap,
        amount_spent: a.amount_spent,
      }));
      const { error } = await supabase.from("ad_accounts").upsert(rows, { onConflict: "account_id" });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} account(s) imported successfully`);
      setImportDialogOpen(false);
      setSyncedAccounts([]);
      setSelectedImportIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["admin-bm-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleImportSelected = () => {
    const toImport = syncedAccounts.filter((a) => selectedImportIds.has(a.account_id));
    if (toImport.length === 0) {
      toast.error("No accounts selected");
      return;
    }
    importMutation.mutate(toImport);
  };

  const manualAddMutation = useMutation({
    mutationFn: async () => {
      if (!manualBmId || !manualAdAccountId.trim()) throw new Error("Select a BM and enter an Ad Account ID");
      return invokeBmFunction<{ account?: any }>("add-ad-account-manual", {
        business_manager_id: manualBmId,
        ad_account_id: manualAdAccountId.trim(),
      });
    },
    onSuccess: (res) => {
      toast.success(`Ad account added: ${res?.account?.account_name ?? manualAdAccountId}`);
      setManualAddOpen(false);
      setManualAdAccountId("");
      setManualBmId("");
      queryClient.invalidateQueries({ queryKey: ["admin-bm-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filteredSyncedAccounts = useMemo(() => {
    const q = importSearch.toLowerCase();
    return syncedAccounts.filter((a) => {
      if (importStatusFilter !== "all" && a.status !== importStatusFilter) return false;
      if (q && !a.account_name.toLowerCase().includes(q) && !a.account_id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [syncedAccounts, importStatusFilter, importSearch]);

  const newAccountsCount = syncedAccounts.filter((a) => !existingAccountIds.has(a.account_id)).length;
  const alreadyImportedCount = syncedAccounts.filter((a) => existingAccountIds.has(a.account_id)).length;

  const updateBmMutation = useMutation({
    mutationFn: async ({ id, name, bm_id, access_token }: { id: string; name?: string; bm_id?: string; access_token?: string }) => {
      await invokeBmFunction("manage-bm", { action: "update", id, name, bm_id, access_token });
    },
    onSuccess: () => {
      toast.success("Business Manager updated");
      setEditOpen(false);
      setEditBmId(null);
      setEditName("");
      setEditMetaId("");
      setEditAccessToken("");
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteBmMutation = useMutation({
    mutationFn: async (bmId: string) => {
      const { data: accounts } = await supabase
        .from("ad_accounts")
        .select("id")
        .eq("business_manager_id", bmId);
      const accountIds = (accounts ?? []).map((a: any) => a.id);
      if (accountIds.length > 0) {
        await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", accountIds);
        await supabase.from("ad_account_insights").delete().in("ad_account_id", accountIds);
        await supabase.from("top_up_requests").delete().in("ad_account_id", accountIds);
        await supabase.from("ad_accounts").delete().eq("business_manager_id", bmId);
      }
      await (supabase as any).from("sync_logs").delete().eq("business_manager_id", bmId);
      const { error } = await supabase.from("business_managers").delete().eq("id", bmId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Business Manager and all ad accounts removed");
      setDeleteBmId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-bm-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ accountId, userId }: { accountId: string; userId: string | null }) => {
      await (supabase as any).from("user_ad_accounts").delete().eq("ad_account_id", accountId);
      if (userId) {
        const { error } = await (supabase as any).from("user_ad_accounts").insert({
          user_id: userId,
          ad_account_id: accountId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Assignment updated");
      queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteAccountsMutation = useMutation({
    mutationFn: async (accountIds: string[]) => {
      // Delete related data first
      await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", accountIds);
      await supabase.from("ad_account_insights").delete().in("ad_account_id", accountIds);
      await supabase.from("top_up_requests").delete().in("ad_account_id", accountIds);
      const { error } = await supabase.from("ad_accounts").delete().in("id", accountIds);
      if (error) throw error;
      return accountIds.length;
    },
    onSuccess: async (count) => {
      toast.success(`${count} ad account(s) permanently removed`);
      if (unlinkAccount) {
        await logSystemAction("Ad Account Deleted", `Deleted "${unlinkAccount.name}" from system`);
        setUnlinkAccount(null);
      } else {
        await logSystemAction("Ad Accounts Bulk Deleted", `Deleted ${count} ad account(s) from system`);
        setSelectedAccountIds(new Set());
        setBulkDeleteConfirm(false);
      }
      queryClient.invalidateQueries({ queryKey: ["admin-bm-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["billings-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const getAssignedUserId = (accountId: string) => {
    return assignments?.find((a: any) => a.ad_account_id === accountId)?.user_id ?? null;
  };

  const bmAccountsList = (bmId: string) => {
    const accounts = adAccounts?.filter((a: any) => a.business_manager_id === bmId) ?? [];
    const statusOrder: Record<string, number> = { active: 0, pending: 1, disabled: 2 };
    return accounts.sort((a: any, b: any) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3));
  };

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      if (!bms || bms.length === 0) throw new Error("No Business Managers to sync");
      const allSyncedAccounts: SyncedAccount[] = [];
      const results = await Promise.allSettled(
        bms.map(async (bm: any) => {
          const result = await invokeBmFunction<{ accounts?: SyncedAccount[] }>("sync-bm-accounts", {
            business_manager_id: bm.id,
          });
          if (result.accounts) allSyncedAccounts.push(...result.accounts);
          return result;
        })
      );
      const succeeded = results.filter(r => r.status === "fulfilled").length;
      return { succeeded, total: bms.length, accounts: allSyncedAccounts };
    },
    onSuccess: async (result) => {
      toast.success(`Synced ${result.succeeded} of ${result.total} Business Managers`);
      if (result.accounts.length > 0) {
        const { data: existing } = await supabase.from("ad_accounts").select("account_id");
        const existingIds = new Set((existing ?? []).map((a: any) => a.account_id));
        setExistingAccountIds(existingIds);
        setSyncedAccounts(result.accounts);
        setSelectedImportIds(new Set());
        setImportStatusFilter("all");
        setImportSearch("");
        setImportDialogOpen(true);
      }
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-sync-logs"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleImportSelect = (accountId: string) => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const toggleSelectAllImport = () => {
    const importable = filteredSyncedAccounts.filter((a) => !existingAccountIds.has(a.account_id));
    const allSelected = importable.every((a) => selectedImportIds.has(a.account_id));
    if (allSelected) {
      setSelectedImportIds((prev) => {
        const next = new Set(prev);
        importable.forEach((a) => next.delete(a.account_id));
        return next;
      });
    } else {
      setSelectedImportIds((prev) => {
        const next = new Set(prev);
        importable.forEach((a) => next.add(a.account_id));
        return next;
      });
    }
  };

  const encryptExistingMutation = useMutation({
    mutationFn: async () => {
      return invokeBmFunction<{ encrypted?: number }>("manage-bm", { action: "encrypt_existing" });
    },
    onSuccess: (result) => {
      toast.success(`${result.encrypted} token(s) encrypted successfully`);
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Revoke token mutation
  const revokeMutation = useMutation({
    mutationFn: async (params: { bm_id?: string; revoke_all?: boolean }) => {
      return invokeBmFunction<{ results?: Array<{ revoked?: boolean }> }>("revoke-bm-token", params);
    },
    onSuccess: (result) => {
      const revoked = result.results?.filter((r: any) => r.revoked).length || 0;
      toast.success(`${revoked} token(s) revoked and cleared`);
      setRevokeAllConfirm(false);
      setRevokeSingleId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // OAuth reconnect removed — system user access token only flow

  const getAssignedUserName = (accountId: string) => {
    const userId = getAssignedUserId(accountId);
    if (!userId) return null;
    const client = clients?.find((c: any) => c.user_id === userId);
    return client?.full_name || client?.email || userId;
  };

  // --- Mobile account card renderer ---
  const renderMobileAccountCards = (accounts: any[]) => (
    <div className="space-y-2.5 pt-2">
      {accounts.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={accounts.length > 0 && accounts.every((a: any) => selectedAccountIds.has(a.id))}
              onCheckedChange={(checked) => {
                setSelectedAccountIds(prev => {
                  const next = new Set(prev);
                  accounts.forEach((a: any) => checked ? next.add(a.id) : next.delete(a.id));
                  return next;
                });
              }}
            />
            <span className="text-xs text-muted-foreground">Select All</span>
          </div>
          {selectedAccountIds.size > 0 && (
            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => setBulkDeleteConfirm(true)}>
              <Trash2 className="h-3 w-3 mr-1" />
              Delete ({accounts.filter((a: any) => selectedAccountIds.has(a.id)).length})
            </Button>
          )}
        </div>
      )}
      {accounts.map((a: any) => {
        const remaining = Math.max(0, Number(a.spend_cap) - Number(a.amount_spent));
        const ratio = Number(a.spend_cap) > 0 ? Number(a.amount_spent) / Number(a.spend_cap) : 0;
        const percentage = Math.min(ratio * 100, 100);
        const barColor = ratio >= 0.8 ? "bg-destructive" : ratio >= 0.5 ? "bg-yellow-500" : "bg-primary";

        return (
          <div key={a.id} className="border border-border/60 rounded-lg p-3 bg-card">
            {/* Header */}
            <div className="flex items-start gap-2 mb-1">
              <Checkbox
                checked={selectedAccountIds.has(a.id)}
                onCheckedChange={(checked) => {
                  setSelectedAccountIds(prev => {
                    const next = new Set(prev);
                    checked ? next.add(a.id) : next.delete(a.id);
                    return next;
                  });
                }}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-foreground truncate">{a.account_name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{a.account_id}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
              </div>
            </div>

            {/* Remaining + Progress */}
            <div className="mt-2 pl-6">
              <p className="text-sm font-medium text-foreground">
                Remaining: <span className="font-bold">${remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </p>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-1.5">
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percentage}%` }} />
              </div>
            </div>

            {/* Spent / Limit */}
            <div className="flex gap-4 text-xs text-muted-foreground mt-2 pl-6">
              <span>Spent: <span className="font-medium text-foreground">${Number(a.amount_spent).toLocaleString()}</span></span>
              <span>Limit: <span className="font-medium text-foreground">${Number(a.spend_cap).toLocaleString()}</span></span>
            </div>

            {/* Assigned To */}
            <div className="mt-2.5 pl-6">
              <Select
                value={getAssignedUserId(a.id) || "unassigned"}
                onValueChange={(val) => assignMutation.mutate({ accountId: a.id, userId: val === "unassigned" ? null : val })}
              >
                <SelectTrigger className="w-full h-8 text-xs">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {clients?.map((c: any) => (
                    <SelectItem key={c.user_id} value={c.user_id}>
                      {c.full_name || c.email || c.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full h-7 text-xs text-destructive hover:text-destructive ml-6"
              style={{ width: "calc(100% - 1.5rem)" }}
              onClick={() => setUnlinkAccount({ id: a.id, name: a.account_name })}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
          </div>
        );
      })}
      {accounts.length === 0 && (
        <p className="text-center text-xs text-muted-foreground py-4">No accounts imported. Tap "Sync" to fetch from Meta.</p>
      )}
    </div>
  );

  // --- Mobile import card renderer ---
  const renderMobileImportCards = () => (
    <div className="space-y-2">
      {filteredSyncedAccounts.map((a) => {
        const alreadyExists = existingAccountIds.has(a.account_id);
        return (
          <div key={a.account_id} className={cn("border border-border/60 rounded-lg p-3 bg-card", alreadyExists && "opacity-50")}>
            <div className="flex items-start gap-3">
              <Checkbox
                checked={selectedImportIds.has(a.account_id)}
                onCheckedChange={() => toggleImportSelect(a.account_id)}
                disabled={alreadyExists}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.account_name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{a.account_id.replace(/^act_/, "")}</p>
                    {alreadyExists && <p className="text-[10px] text-muted-foreground">(already imported)</p>}
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">Cap: ${a.spend_cap.toLocaleString()}</p>
              </div>
            </div>
          </div>
        );
      })}
      {filteredSyncedAccounts.length === 0 && (
        <p className="text-center text-muted-foreground py-8 text-sm">No accounts match your filters</p>
      )}
          {!isMobile && bms && bms.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setRevokeAllConfirm(true)}
              disabled={revokeMutation.isPending}
            >
              <Link2Off className="mr-1 h-4 w-4" />
              {revokeMutation.isPending ? "Revoking..." : "Revoke All Tokens"}
            </Button>
          )}
        </div>
  );

  return (
    <div className={cn("space-y-4", !isMobile && "space-y-6")}>
      {/* Header */}
      <div className={cn("flex items-center justify-between", isMobile && "flex-col items-start gap-3")}>
        <h1 className={cn("font-bold flex items-center gap-2", isMobile ? "text-xl" : "text-2xl")}>
          <Building2 className={cn(isMobile ? "h-5 w-5" : "h-6 w-6")} />
          Business Managers
        </h1>
        <div className="flex items-center gap-2">
          {!isMobile && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => encryptExistingMutation.mutate()}
              disabled={encryptExistingMutation.isPending}
            >
              <ShieldCheck className="mr-1 h-4 w-4" />
              {encryptExistingMutation.isPending ? "Encrypting..." : "Encrypt Tokens"}
            </Button>
          )}
          {bms && bms.length > 0 && (
            <Button
              variant="outline"
              size={isMobile ? "sm" : "default"}
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}
            >
              <RefreshCw className={cn("h-4 w-4", syncAllMutation.isPending && "animate-spin", !isMobile && "mr-2")} />
              {!isMobile && (syncAllMutation.isPending ? "Syncing All..." : "Sync All")}
            </Button>
          )}
          {bms && bms.length > 0 && (
            <Button
              variant="outline"
              size={isMobile ? "sm" : "default"}
              onClick={() => { setManualBmId(bms[0]?.id ?? ""); setManualAddOpen(true); }}
            >
              <Plus className={cn("h-4 w-4", !isMobile && "mr-2")} />
              {isMobile ? "Add Acc" : "Add Ad Account"}
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size={isMobile ? "sm" : "default"}>
                <Plus className={cn("h-4 w-4", !isMobile && "mr-2")} />
                {isMobile ? "Add BM" : "Connect BM"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Connect Business Manager</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Business Manager ID</Label>
                  <Input value={bmId} onChange={(e) => setBmId(e.target.value)} placeholder="123456789012345" />
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={bmName} onChange={(e) => setBmName(e.target.value)} placeholder="My Business" />
                </div>
                <div className="space-y-2">
                  <Label>Access Token</Label>
                  <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAA..." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => addBmMutation.mutate()} disabled={!bmId || !bmName || !accessToken || addBmMutation.isPending}>
                  {addBmMutation.isPending ? "Connecting..." : "Connect"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={manualAddOpen} onOpenChange={setManualAddOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Ad Account Manually</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Business Manager (token to use)</Label>
                  <Select value={manualBmId} onValueChange={setManualBmId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a BM" />
                    </SelectTrigger>
                    <SelectContent>
                      {bms?.map((bm: any) => (
                        <SelectItem key={bm.id} value={bm.id}>{bm.name} ({bm.bm_id})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ad Account ID</Label>
                  <Input
                    value={manualAdAccountId}
                    onChange={(e) => setManualAdAccountId(e.target.value)}
                    placeholder="1234567890 or act_1234567890"
                  />
                  <p className="text-xs text-muted-foreground">
                    The selected BM's token must have access to this account. Details will be fetched from Meta.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setManualAddOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => manualAddMutation.mutate()}
                  disabled={!manualBmId || !manualAdAccountId.trim() || manualAddMutation.isPending}
                >
                  {manualAddMutation.isPending ? "Adding..." : "Add Account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Tenant Requests (BM Share + Withdraw) */}
      <TenantRequestsPanel />

      {/* BM List */}
      {bms?.map((bm: any) => {
        const accounts = bmAccountsList(bm.id);
        const isExpanded = expandedBm === bm.id;
        const isShowingLogs = showLogs === bm.id;

        return (
          <Card key={bm.id} className="border border-border/60">
            {/* BM Header */}
            <CardHeader
              className={cn("cursor-pointer", isMobile ? "p-3" : "p-6")}
              onClick={() => setExpandedBm(isExpanded ? null : bm.id)}
            >
              {isMobile ? (
                /* Mobile BM Header */
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    <Building2 className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm truncate">{bm.name}</p>
                        <StatusBadge status={bm.status} />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] text-muted-foreground font-mono">ID: {bm.bm_id}</p>
                        <span className="text-[10px] text-muted-foreground">· {accounts.length} acct{accounts.length !== 1 ? "s" : ""}</span>
                      </div>
                      {/* API Usage indicator */}
                      {apiUsage?.[bm.id] && (
                        <div className={cn(
                          "flex items-center gap-1 mt-0.5 text-[10px]",
                          (apiUsage[bm.id].lastHour >= 160) ? "text-destructive font-semibold" :
                          (apiUsage[bm.id].lastHour >= 100) ? "text-amber-500" : "text-muted-foreground"
                        )}>
                          <Activity className="h-2.5 w-2.5" />
                          {apiUsage[bm.id].lastHour}/hr · {apiUsage[bm.id].last24h}/24h
                        </div>
                      )}
                      {bm.last_synced_at && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDistanceToNow(new Date(bm.last_synced_at), { addSuffix: true })}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Mobile action buttons - icon only */}
                  <div className="flex items-center gap-1.5 pl-6" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => {
                      setEditBmId(bm.id); setEditName(bm.name); setEditMetaId(bm.bm_id); setEditAccessToken(""); setEditOpen(true);
                    }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteBmId(bm.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setShowLogs(isShowingLogs ? null : bm.id)}>
                      <Clock className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      onClick={() => syncMutation.mutate(bm.id)}
                      disabled={syncMutation.isPending}
                    >
                      <RefreshCw className={cn("h-3 w-3", syncingBmId === bm.id && syncMutation.isPending && "animate-spin")} />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setRevokeSingleId(bm.id)}>
                      <KeyRound className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                /* Desktop BM Header */
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    <Building2 className="h-5 w-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">{bm.name}</CardTitle>
                      <div className="flex items-center gap-3 mt-0.5">
                        <p className="text-xs text-muted-foreground font-mono">ID: {bm.bm_id}</p>
                        {bm.last_synced_at && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Synced {formatDistanceToNow(new Date(bm.last_synced_at), { addSuffix: true })}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {accounts.length} account{accounts.length !== 1 ? "s" : ""}
                        </p>
                        {/* API Usage indicator */}
                        {apiUsage?.[bm.id] && (
                          <div className={cn(
                            "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
                            (apiUsage[bm.id].lastHour >= 160) ? "bg-destructive/10 text-destructive font-semibold" :
                            (apiUsage[bm.id].lastHour >= 100) ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground"
                          )}>
                            <Activity className="h-3 w-3" />
                            {apiUsage[bm.id].lastHour} calls/hr · {apiUsage[bm.id].last24h}/24h
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <StatusBadge status={bm.status} />
                    {bm.recovery_ready === true ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                        <ShieldCheck className="h-3 w-3" /> Recovery Ready
                      </span>
                    ) : bm.recovery_ready === false ? (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
                        <ShieldAlert className="h-3 w-3" /> Need Admin
                      </span>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => syncMutation.mutate(bm.id)} disabled={syncMutation.isPending}>
                      <RefreshCw className={cn("mr-1 h-3 w-3", syncingBmId === bm.id && syncMutation.isPending && "animate-spin")} />
                      {syncingBmId === bm.id && syncMutation.isPending ? "Syncing..." : "Sync"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="h-9 w-9 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          disabled={checkingPermBmId === bm.id}
                          onClick={async () => {
                            setCheckingPermBmId(bm.id);
                            try {
                              const { data, error } = await supabase.functions.invoke("bm-check-admin-permission", { body: { bm_id: bm.id } });
                              if (error) throw error;
                              const r = data?.results?.[0];
                              if (r?.ready) toast.success(`${bm.name}: Recovery Ready ✅`);
                              else toast.error(`${bm.name}: ${r?.error ?? "Need admin role on token"}`);
                              queryClient.invalidateQueries({ queryKey: ["admin-business-managers"] });
                            } catch (e: any) {
                              toast.error(e.message);
                            } finally {
                              setCheckingPermBmId(null);
                            }
                          }}
                        >
                          <ShieldCheck className={cn("mr-2 h-4 w-4", checkingPermBmId === bm.id && "animate-spin")} />
                          Check Permission
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setInviteDialogBm({ id: bm.id, name: bm.name })}>
                          <UserPlus className="mr-2 h-4 w-4" />
                          Invite User
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setRecoveryDialogBmId(bm.id)} className="text-destructive focus:text-destructive">
                          <ShieldAlert className="mr-2 h-4 w-4" />
                          Silent Recovery
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => {
                          setEditBmId(bm.id); setEditName(bm.name); setEditMetaId(bm.bm_id); setEditAccessToken(""); setEditOpen(true);
                        }}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setShowLogs(isShowingLogs ? null : bm.id)}>
                          <Clock className="mr-2 h-4 w-4" />
                          {isShowingLogs ? "Hide Logs" : "View Logs"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setRevokeSingleId(bm.id)} className="text-destructive focus:text-destructive">
                          <KeyRound className="mr-2 h-4 w-4" />
                          Revoke Token
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteBmId(bm.id)} className="text-destructive focus:text-destructive">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove BM
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )}
            </CardHeader>

            {/* Sync Logs */}
            {isShowingLogs && (
              <CardContent className={cn("border-t bg-muted/30", isMobile ? "px-3 py-2" : "")}>
                <h3 className="text-sm font-semibold mb-2">Sync History</h3>
                {syncLogs && syncLogs.length > 0 ? (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {syncLogs.map((log: any) => (
                      <div key={log.id} className={cn("flex items-center justify-between rounded-md border p-2 bg-background", isMobile ? "text-xs gap-2" : "text-sm")}>
                        <div className="flex items-center gap-2">
                          {log.status === "success" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                          )}
                          <span className={cn(isMobile && "truncate")}>
                            {log.status === "success"
                              ? `${log.synced_count}/${log.total_count} synced`
                              : log.error_message || "Failed"}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {format(new Date(log.created_at), isMobile ? "MMM d HH:mm" : "MMM d, yyyy HH:mm")}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No sync logs yet.</p>
                )}
              </CardContent>
            )}

            {/* Expanded Accounts */}
            {isExpanded && (
              <CardContent className={cn(isMobile ? "px-3 pb-3 pt-0" : "")}>
                {!isMobile && accounts.length > 0 && (
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={accounts.length > 0 && accounts.every((a: any) => selectedAccountIds.has(a.id))}
                        onCheckedChange={(checked) => {
                          setSelectedAccountIds(prev => {
                            const next = new Set(prev);
                            accounts.forEach((a: any) => checked ? next.add(a.id) : next.delete(a.id));
                            return next;
                          });
                        }}
                      />
                      <span className="text-sm text-muted-foreground">Select All</span>
                    </div>
                    {selectedAccountIds.size > 0 && (
                      <Button size="sm" variant="destructive" onClick={() => setBulkDeleteConfirm(true)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Delete Selected ({accounts.filter((a: any) => selectedAccountIds.has(a.id)).length})
                      </Button>
                    )}
                  </div>
                )}
                {isMobile ? (
                  renderMobileAccountCards(accounts)
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]"></TableHead>
                        <TableHead>Account Name</TableHead>
                        <TableHead>Account ID</TableHead>
                        <TableHead>Business Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Spend Cap</TableHead>
                        <TableHead>Spent</TableHead>
                        <TableHead>Assigned To</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {accounts.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedAccountIds.has(a.id)}
                              onCheckedChange={(checked) => {
                                setSelectedAccountIds(prev => {
                                  const next = new Set(prev);
                                  checked ? next.add(a.id) : next.delete(a.id);
                                  return next;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{a.account_name}</TableCell>
                          <TableCell className="font-mono text-sm">{a.account_id}</TableCell>
                          <TableCell>{a.business_name || "—"}</TableCell>
                          <TableCell><StatusBadge status={a.status} /></TableCell>
                          <TableCell>${Number(a.spend_cap).toLocaleString()}</TableCell>
                          <TableCell>${Number(a.amount_spent).toLocaleString()}</TableCell>
                          <TableCell>
                            <Select
                              value={getAssignedUserId(a.id) || "unassigned"}
                              onValueChange={(val) => assignMutation.mutate({ accountId: a.id, userId: val === "unassigned" ? null : val })}
                            >
                              <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                {clients?.map((c: any) => (
                                  <SelectItem key={c.user_id} value={c.user_id}>
                                    {c.full_name || c.email || c.user_id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setUnlinkAccount({ id: a.id, name: a.account_name })}
                              title="Delete ad account"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {accounts.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-muted-foreground">
                            No accounts imported. Click "Sync" to fetch from Meta.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {(!bms || bms.length === 0) && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Building2 className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p>No Business Managers connected yet.</p>
            <p className="text-sm mt-1">Click "Connect BM" to get started.</p>
          </CardContent>
        </Card>
      )}

      {/* Import Selection Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className={cn(
          "flex flex-col",
          isMobile ? "max-w-[95vw] max-h-[90vh]" : "max-w-3xl max-h-[80vh]"
        )}>
          <DialogHeader>
            <DialogTitle className={cn(isMobile && "text-base")}>Select Accounts to Import</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {syncedAccounts.length} found · {newAccountsCount} new · {alreadyImportedCount} imported
            </p>
          </DialogHeader>
          <div className={cn("flex items-center gap-2 mt-2", isMobile && "flex-col")}>
            <div className="relative flex-1 w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                value={importSearch}
                onChange={(e) => setImportSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Select value={importStatusFilter} onValueChange={setImportStatusFilter}>
              <SelectTrigger className={cn("h-9", isMobile ? "w-full" : "w-[130px]")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Select all toggle */}
          {!isMobile && (
            <div className="flex items-center gap-2 mt-1">
              <Checkbox
                checked={
                  filteredSyncedAccounts.filter((a) => !existingAccountIds.has(a.account_id)).length > 0 &&
                  filteredSyncedAccounts
                    .filter((a) => !existingAccountIds.has(a.account_id))
                    .every((a) => selectedImportIds.has(a.account_id))
                }
                onCheckedChange={toggleSelectAllImport}
              />
              <span className="text-xs text-muted-foreground">Select all new accounts</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto mt-2 border rounded-md">
            {isMobile ? (
              <div className="p-2">
                {/* Mobile select all */}
                <div className="flex items-center gap-2 mb-2 pb-2 border-b">
                  <Checkbox
                    checked={
                      filteredSyncedAccounts.filter((a) => !existingAccountIds.has(a.account_id)).length > 0 &&
                      filteredSyncedAccounts
                        .filter((a) => !existingAccountIds.has(a.account_id))
                        .every((a) => selectedImportIds.has(a.account_id))
                    }
                    onCheckedChange={toggleSelectAllImport}
                  />
                  <span className="text-xs text-muted-foreground">Select all new</span>
                </div>
                {renderMobileImportCards()}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={
                          filteredSyncedAccounts.filter((a) => !existingAccountIds.has(a.account_id)).length > 0 &&
                          filteredSyncedAccounts
                            .filter((a) => !existingAccountIds.has(a.account_id))
                            .every((a) => selectedImportIds.has(a.account_id))
                        }
                        onCheckedChange={toggleSelectAllImport}
                      />
                    </TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Account ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Spend Cap</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSyncedAccounts.map((a) => {
                    const alreadyExists = existingAccountIds.has(a.account_id);
                    return (
                      <TableRow key={a.account_id} className={alreadyExists ? "opacity-50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selectedImportIds.has(a.account_id)}
                            onCheckedChange={() => toggleImportSelect(a.account_id)}
                            disabled={alreadyExists}
                          />
                        </TableCell>
                        <TableCell>
                          <div>
                            <span className="text-sm">{a.account_name}</span>
                            {alreadyExists && (
                              <span className="ml-2 text-xs text-muted-foreground">(already imported)</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{a.account_id.replace(/^act_/, "")}</TableCell>
                        <TableCell><StatusBadge status={a.status} /></TableCell>
                        <TableCell>${a.spend_cap.toLocaleString()}</TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredSyncedAccounts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No accounts match your filters
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleImportSelected}
              disabled={selectedImportIds.size === 0 || importMutation.isPending}
            >
              {importMutation.isPending ? "Importing..." : `Import ${selectedImportIds.size} Account(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit BM Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditBmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Business Manager</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Business Manager Name" />
            </div>
            <div className="space-y-2">
              <Label>Business Manager ID</Label>
              <Input value={editMetaId} onChange={(e) => setEditMetaId(e.target.value)} placeholder="123456789012345" />
            </div>
            <div className="space-y-2">
              <Label>Access Token <span className="text-xs text-muted-foreground">(leave empty to keep current)</span></Label>
              <Input type="password" value={editAccessToken} onChange={(e) => setEditAccessToken(e.target.value)} placeholder="EAA... (encrypted at rest)" />
              <p className="text-xs text-muted-foreground">🔒 Token is encrypted with AES-256-GCM before storing</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => editBmId && updateBmMutation.mutate({
                id: editBmId,
                name: editName || undefined,
                bm_id: editMetaId || undefined,
                access_token: editAccessToken || undefined,
              })}
              disabled={updateBmMutation.isPending}
            >
              {updateBmMutation.isPending ? "Updating..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete BM Confirmation */}
      <AlertDialog open={!!deleteBmId} onOpenChange={(v) => { if (!v) setDeleteBmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Business Manager?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this Business Manager along with all its ad accounts, assignments, insights, and sync logs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteBmId && deleteBmMutation.mutate(deleteBmId)}
              disabled={deleteBmMutation.isPending}
            >
              {deleteBmMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Single Account Confirmation */}
      <AlertDialog open={!!unlinkAccount} onOpenChange={(v) => { if (!v) setUnlinkAccount(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ad Account?</AlertDialogTitle>
            <AlertDialogDescription>
              "{unlinkAccount?.name}" will be permanently deleted from the system along with all its assignments, insights, and top-up requests. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => unlinkAccount && deleteAccountsMutation.mutate([unlinkAccount.id])}
              disabled={deleteAccountsMutation.isPending}
            >
              {deleteAccountsMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedAccountIds.size} Ad Account(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              All selected ad accounts will be permanently deleted from the system along with their assignments, insights, and top-up requests. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAccountsMutation.mutate([...selectedAccountIds])}
              disabled={deleteAccountsMutation.isPending}
            >
              {deleteAccountsMutation.isPending ? "Deleting..." : `Delete ${selectedAccountIds.size} Account(s)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke All Tokens Confirmation */}
      <AlertDialog open={revokeAllConfirm} onOpenChange={setRevokeAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke All Meta Tokens?</AlertDialogTitle>
            <AlertDialogDescription>
              সব Meta Business Manager-এর access token revoke করা হবে এবং DB থেকে মুছে ফেলা হবে। পরে প্রতিটি BM-এর জন্য "Reconnect" বাটনে ক্লিক করে নতুন token connect করতে হবে। এই action undo করা যাবে না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeMutation.mutate({ revoke_all: true })}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Single Token Confirmation */}
      <AlertDialog open={!!revokeSingleId} onOpenChange={(v) => { if (!v) setRevokeSingleId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Token?</AlertDialogTitle>
            <AlertDialogDescription>
              এই BM-এর token revoke করা হবে। পরে "Reconnect" বাটনে ক্লিক করে নতুন token connect করতে হবে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeSingleId && revokeMutation.mutate({ bm_id: revokeSingleId })}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking..." : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Silent BM Recovery Dialog */}
      <SilentRecoveryDialog
        open={!!recoveryDialogBmId}
        onOpenChange={(v) => !v && setRecoveryDialogBmId(null)}
        bmId={recoveryDialogBmId ?? undefined}
      />

      {/* Invite User to BM Dialog */}
      <InviteToBmDialog
        open={!!inviteDialogBm}
        onOpenChange={(v) => !v && setInviteDialogBm(null)}
        bmId={inviteDialogBm?.id ?? null}
        bmName={inviteDialogBm?.name}
      />
    </div>
  );
}
