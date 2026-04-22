import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Users, Search, Clock, CheckCircle, Shield, LogIn, UserCheck, UserX, Hourglass, Building2, Trash2, MoreHorizontal, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { logSystemAction } from "@/lib/systemLog";

const ALL_MENU_KEYS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "ad-accounts", label: "Ad Accounts" },
  { key: "failed-topups", label: "Failed Top-Ups" },
  { key: "requests", label: "Requests" },
  { key: "billings", label: "Billings" },
  { key: "business-managers", label: "Business Managers" },
  { key: "top-up", label: "Top-Up Request" },
  { key: "clients", label: "Clients" },
  { key: "transactions", label: "Transactions" },
  { key: "banks", label: "Banks" },
  { key: "chat", label: "Chat Support" },
  { key: "sellers", label: "Sellers" },
  { key: "agencies", label: "Agencies" },
  { key: "spend-report", label: "Spend Report" },
  { key: "tenants", label: "Tenants" },
  { key: "system-logs", label: "System Log" },
  { key: "settings", label: "Settings" },
  { key: "agent", label: "AI Agent" },
  { key: "feedback", label: "Feedback" },
  { key: "announcements", label: "Announcements" },
  { key: "admin-performance", label: "Admin Performance" },
  { key: "card-vault", label: "Card Vault" },
];

export function AdminClients() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useAuth();
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [permDialogUser, setPermDialogUser] = useState<any>(null);
  const [selectedMenuKeys, setSelectedMenuKeys] = useState<string[]>([]);
  const [bankDialogUser, setBankDialogUser] = useState<any>(null);
  const [newBankId, setNewBankId] = useState("");

  const { data: clients, isLoading } = useQuery({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
  });

  const { data: allRoles } = useQuery({
    queryKey: ["all-user-roles"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("*");
      return (data as any[]) ?? [];
    },
    enabled: isSuperAdmin,
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({ userId, newStatus }: { userId: string; newStatus: string }) => {
      const { error } = await supabase.from("profiles").update({ status: newStatus }).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: async (_, { userId, newStatus }) => {
      const clientProfile = clients?.find((c: any) => c.user_id === userId);
      const clientName = clientProfile?.full_name || clientProfile?.email || userId.slice(0, 8);
      await logSystemAction("Client Status Changed", `${clientName} → ${newStatus}`, undefined, undefined);
      toast.success(`Client ${newStatus === "active" ? "activated" : "deactivated"} successfully`);
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
      
      // Send notification to the client
      const title = newStatus === "active" ? "Account Approved" : "Account Deactivated";
      const message = newStatus === "active"
        ? "Your account has been approved! You can now access all features."
        : "Your account has been deactivated. Please contact support for more information.";
      await (supabase as any).from("notifications").insert({
        user_id: userId,
        type: "client_status",
        title,
        message,
      });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("profiles").update({ status: "rejected" }).eq("user_id", userId);
      if (error) throw error;
      return userId;
    },
    onSuccess: async (userId) => {
      const clientProfile = clients?.find((c: any) => c.user_id === userId);
      const clientName = clientProfile?.full_name || clientProfile?.email || userId.slice(0, 8);
      await logSystemAction("Client Rejected", `${clientName} sign-up rejected`, undefined, undefined);
      await (supabase as any).from("notifications").insert({
        user_id: userId,
        type: "client_status",
        title: "Sign-up Rejected",
        message: "Your sign-up request has been rejected. Please contact support for more information.",
      });
      toast.success("Sign-up request rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const promoteToAdminMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("user_roles").update({ role: "admin" } as any).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User promoted to Admin!");
      queryClient.invalidateQueries({ queryKey: ["all-user-roles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const demoteToClientMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("user_roles").update({ role: "client" } as any).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("User demoted to Client!");
      queryClient.invalidateQueries({ queryKey: ["all-user-roles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const [convertDialog, setConvertDialog] = useState<any>(null);
  const [agencyName, setAgencyName] = useState("");
  const [agencySlug, setAgencySlug] = useState("");
  const [agencyUsdRate, setAgencyUsdRate] = useState("");

  const convertToAgencyMutation = useMutation({
    mutationFn: async () => {
      if (!convertDialog || !agencyName || !agencySlug) throw new Error("Fill all fields");
      const userId = convertDialog.user_id;
      // Create agency
      const { data: ag, error } = await (supabase as any).from("agencies").insert({
        name: agencyName,
        slug: agencySlug.toLowerCase().replace(/[^a-z0-9-]/g, ""),
        owner_id: userId,
        usd_rate: Number(agencyUsdRate) || 0,
      }).select().single();
      if (error) throw error;
      // Create wallet
      await (supabase as any).from("agency_wallets").insert({ agency_id: ag.id });
      // Update role
      await supabase.from("user_roles").update({ role: "agency" } as any).eq("user_id", userId);
      // Remove agency_id from profile (they're now an owner, not a sub-client)
      await supabase.from("profiles").update({ agency_id: null } as any).eq("user_id", userId);
    },
    onSuccess: () => {
      toast.success("Client converted to Agency Owner!");
      setConvertDialog(null);
      setAgencyName(""); setAgencySlug(""); setAgencyUsdRate("");
      queryClient.invalidateQueries({ queryKey: ["all-user-roles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const impersonateMutation = useMutation({
    mutationFn: async (targetUserId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const res = await supabase.functions.invoke("impersonate-client", { body: { target_user_id: targetUserId } });
      if (res.error) throw new Error(res.error.message || "Failed to impersonate");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.open(data.url, "_blank");
        toast.success("Opening client dashboard in new tab...");
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const { data: userMenuPerms } = useQuery({
    queryKey: ["menu-perms", permDialogUser?.user_id],
    queryFn: async () => {
      const { data } = await (supabase as any).from("menu_permissions").select("menu_key").eq("user_id", permDialogUser!.user_id);
      return (data as any[])?.map((p: any) => p.menu_key) ?? [];
    },
    enabled: !!permDialogUser,
  });

  const savePermsMutation = useMutation({
    mutationFn: async () => {
      const userId = permDialogUser.user_id;
      await (supabase as any).from("menu_permissions").delete().eq("user_id", userId);
      if (selectedMenuKeys.length > 0) {
        const rows = selectedMenuKeys.map(key => ({ user_id: userId, menu_key: key }));
        const { error } = await (supabase as any).from("menu_permissions").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Menu permissions saved!");
      setPermDialogUser(null);
      queryClient.invalidateQueries({ queryKey: ["menu-perms"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const getUserRole = (userId: string) => {
    return allRoles?.find((r: any) => r.user_id === userId)?.role ?? "client";
  };

  // Bank assignment queries and mutations
  const { data: allBanks } = useQuery({
    queryKey: ["all-active-banks"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("bank_accounts").select("*").eq("status", "active");
      return (data as any[]) ?? [];
    },
  });

  const { data: userBanks } = useQuery({
    queryKey: ["user-banks", bankDialogUser?.user_id],
    queryFn: async () => {
      const { data } = await (supabase as any).from("client_banks").select("*, bank_accounts(bank_name, account_number, logo_url)").eq("user_id", bankDialogUser!.user_id);
      return (data as any[]) ?? [];
    },
    enabled: !!bankDialogUser,
  });

  const assignBankMutation = useMutation({
    mutationFn: async () => {
      if (!newBankId || !bankDialogUser) throw new Error("Select a bank");
      const { error } = await (supabase as any).from("client_banks").upsert({ user_id: bankDialogUser.user_id, bank_account_id: newBankId }, { onConflict: "user_id,bank_account_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Bank assigned!"); queryClient.invalidateQueries({ queryKey: ["user-banks", bankDialogUser?.user_id] }); setNewBankId(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const unassignBankMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("client_banks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Bank unassigned!"); queryClient.invalidateQueries({ queryKey: ["user-banks", bankDialogUser?.user_id] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const [deleteDialog, setDeleteDialog] = useState<any>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const deleteClientMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await supabase.functions.invoke("delete-client", { body: { target_user_id: userId } });
      if (res.error) throw new Error(res.error.message || "Failed to delete");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      toast.success("Client permanently deleted!");
      setDeleteDialog(null);
      setDeleteConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = clients?.filter((c: any) => {
    const term = search.toLowerCase();
    return !term || c.full_name?.toLowerCase().includes(term) || c.email?.toLowerCase().includes(term) || c.company?.toLowerCase().includes(term);
  });

  const pendingClients = filtered?.filter((c: any) => c.status === "pending") ?? [];
  const activeClients = filtered?.filter((c: any) => c.status !== "pending") ?? [];

  // Counts for metrics
  const totalClients = clients?.length ?? 0;
  const activeCount = clients?.filter((c: any) => c.status === "active").length ?? 0;
  const pendingCount = clients?.filter((c: any) => c.status === "pending").length ?? 0;
  const inactiveCount = clients?.filter((c: any) => c.status === "inactive").length ?? 0;

  const renderMobileCards = (items: any[]) => (
    <div className="space-y-3">
      {items.map((client: any) => {
        const isActive = (client.status ?? "active") === "active";
        const isPending = client.status === "pending";
        const userRole = isSuperAdmin ? getUserRole(client.user_id) : null;
        return (
          <Card
            key={client.id}
            className="border border-border/60 shadow-sm cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => navigate(`/clients/${client.user_id}`)}
          >
            <CardContent className="p-4">
              {/* Header: Name + Status */}
              <div className="flex items-start justify-between mb-1">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-foreground truncate">{client.full_name || "—"}</p>
                  {client.company && (
                    <p className="text-xs text-muted-foreground mt-0.5">{client.company}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={isPending ? "pending" : isActive ? "active" : "inactive"} />
                  {isSuperAdmin && userRole && (
                    <span className="capitalize text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted">{userRole}</span>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="space-y-0.5 mt-2">
                <p className="text-xs text-muted-foreground truncate">{client.email || "—"}</p>
                <p className="text-[11px] text-muted-foreground">{format(new Date(client.created_at), "MMM d, yyyy")}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 mt-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {isPending ? (
                  <>
                    <Button
                      size="sm"
                      className="gap-1 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-md shadow-emerald-500/25 rounded-full px-4 font-semibold text-xs h-8"
                      onClick={() => toggleStatusMutation.mutate({ userId: client.user_id, newStatus: "active" })}
                      disabled={toggleStatusMutation.isPending}
                    >
                      <CheckCircle className="h-3 w-3" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1 rounded-full px-4 font-semibold text-xs h-8"
                      onClick={() => rejectMutation.mutate(client.user_id)}
                      disabled={rejectMutation.isPending}
                    >
                      <UserX className="h-3 w-3" />
                      Reject
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant={isActive ? "destructive" : "default"}
                    className={cn(
                      "rounded-full px-4 font-semibold text-xs h-8",
                      !isActive && "bg-gradient-to-r from-primary to-primary/70 text-primary-foreground shadow-md shadow-primary/25"
                    )}
                    onClick={() => toggleStatusMutation.mutate({ userId: client.user_id, newStatus: isActive ? "inactive" : "active" })}
                    disabled={toggleStatusMutation.isPending}
                  >
                    {isActive ? "Deactivate" : "Activate"}
                  </Button>
                )}
                {isSuperAdmin && userRole === "client" && !isPending && (
                  <>
                    <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => promoteToAdminMutation.mutate(client.user_id)} disabled={promoteToAdminMutation.isPending}>
                      Make Admin
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-full h-8 text-xs text-purple-600 border-purple-300" onClick={() => { setConvertDialog(client); setAgencyName(client.company || client.full_name || ""); setAgencySlug((client.company || client.full_name || "").toLowerCase().replace(/[^a-z0-9]/g, "-")); }}>
                      <Building2 className="h-3 w-3 mr-1" />Agency
                    </Button>
                  </>
                )}
                {isSuperAdmin && userRole === "admin" && (
                  <>
                    <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => demoteToClientMutation.mutate(client.user_id)} disabled={demoteToClientMutation.isPending}>Demote</Button>
                    <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => { setPermDialogUser(client); setSelectedMenuKeys([]); }}>
                      <Shield className="h-3 w-3 mr-1" />Menus
                    </Button>
                  </>
                )}
                {isSuperAdmin && !isPending && userRole === "client" && (
                  <Button size="sm" variant="outline" className="rounded-full h-8 text-xs text-blue-600 border-blue-300" onClick={() => impersonateMutation.mutate(client.user_id)} disabled={impersonateMutation.isPending}>
                    <LogIn className="h-3 w-3 mr-1" />Login
                  </Button>
                )}
                {!isPending && (
                  <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => setBankDialogUser(client)}>
                    <Building2 className="h-3 w-3 mr-1" />Banks
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
      {items.length === 0 && (
        <p className="text-center text-muted-foreground py-8 text-sm">No clients found</p>
      )}
    </div>
  );

  const renderTable = (items: any[], showApprove = false) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[120px]">Name</TableHead>
          <TableHead className="min-w-[160px]">Email</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead>Status</TableHead>
          {isSuperAdmin && <TableHead>Role</TableHead>}
          <TableHead className="text-right w-[100px]">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((client: any) => {
          const isActive = (client.status ?? "active") === "active";
          const isPending = client.status === "pending";
          const userRole = isSuperAdmin ? getUserRole(client.user_id) : null;
          return (
            <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/clients/${client.user_id}`)}>
              <TableCell className="font-medium truncate max-w-[160px]">{client.full_name || "—"}</TableCell>
              <TableCell className="truncate max-w-[200px]">{client.email || "—"}</TableCell>
              <TableCell className="truncate max-w-[120px]">{client.company || "—"}</TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">{format(new Date(client.created_at), "MMM d, yyyy")}</TableCell>
              <TableCell><StatusBadge status={isPending ? "pending" : isActive ? "active" : "inactive"} /></TableCell>
              {isSuperAdmin && (
                <TableCell>
                  <span className="capitalize text-xs font-medium px-2 py-1 rounded-full bg-muted whitespace-nowrap">{userRole}</span>
                </TableCell>
              )}
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  {isPending ? (
                    <>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => toggleStatusMutation.mutate({ userId: client.user_id, newStatus: "active" })} disabled={toggleStatusMutation.isPending}>
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => rejectMutation.mutate(client.user_id)} disabled={rejectMutation.isPending}>
                        <UserX className="h-3.5 w-3.5 mr-1" />Reject
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant={isActive ? "destructive" : "default"} onClick={() => toggleStatusMutation.mutate({ userId: client.user_id, newStatus: isActive ? "inactive" : "active" })} disabled={toggleStatusMutation.isPending}>
                      {isActive ? "Deactivate" : "Activate"}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {isSuperAdmin && userRole === "client" && !isPending && (
                        <>
                          <DropdownMenuItem onClick={() => promoteToAdminMutation.mutate(client.user_id)}>
                            <Shield className="h-4 w-4 mr-2" />Make Admin
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-purple-600" onClick={() => { setConvertDialog(client); setAgencyName(client.company || client.full_name || ""); setAgencySlug((client.company || client.full_name || "").toLowerCase().replace(/[^a-z0-9]/g, "-")); }}>
                            <Building2 className="h-4 w-4 mr-2" />Convert to Agency
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-blue-600" onClick={() => impersonateMutation.mutate(client.user_id)}>
                            <LogIn className="h-4 w-4 mr-2" />Login as Client
                          </DropdownMenuItem>
                        </>
                      )}
                      {isSuperAdmin && userRole === "admin" && (
                        <>
                          <DropdownMenuItem onClick={() => demoteToClientMutation.mutate(client.user_id)}>Demote to Client</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setPermDialogUser(client); setSelectedMenuKeys([]); }}>
                            <Shield className="h-4 w-4 mr-2" />Menu Permissions
                          </DropdownMenuItem>
                        </>
                      )}
                      {!isPending && (
                        <DropdownMenuItem onClick={() => setBankDialogUser(client)}>
                          <Building2 className="h-4 w-4 mr-2" />Manage Banks
                        </DropdownMenuItem>
                      )}
                      {isSuperAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteDialog(client)}>
                            <Trash2 className="h-4 w-4 mr-2" />Permanently Remove
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
        {items.length === 0 && (
          <TableRow>
            <TableCell colSpan={isSuperAdmin ? 7 : 6} className="text-center text-muted-foreground py-8">No clients found</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  if (permDialogUser && userMenuPerms && selectedMenuKeys.length === 0 && userMenuPerms.length > 0) {
    setSelectedMenuKeys(userMenuPerms);
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className={cn("font-bold flex items-center gap-2", isMobile ? "text-xl" : "text-2xl")}>
          <Users className={cn(isMobile ? "h-5 w-5" : "h-6 w-6")} />
          Clients
        </h1>
        <div className={cn("relative", isMobile ? "flex-1 max-w-[200px]" : "w-64")}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search clients..." value={search} onChange={(e) => setSearch(e.target.value)} className={cn("pl-9 h-9", isMobile && "rounded-full text-sm")} />
        </div>
      </div>

      {/* Mobile Hero Metrics */}
      {isMobile && (
        <div className="space-y-3">
          {/* Hero card */}
          <Card className="bg-gradient-to-br from-primary via-primary/85 to-primary/65 text-primary-foreground border-0 shadow-lg shadow-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-primary-foreground/70">Total Clients</p>
                  <p className="text-3xl font-bold">{totalClients}</p>
                </div>
                <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                  <Users className="h-6 w-6" />
                </div>
              </div>
            </CardContent>
          </Card>
          {/* 3-column metrics */}
          <div className="grid grid-cols-3 gap-2">
            <Card className="bg-card border border-border/60">
              <CardContent className="p-3 text-center">
                <UserCheck className="h-4 w-4 text-emerald-500 mx-auto mb-1" />
                <p className="text-[10px] text-muted-foreground font-medium">Active</p>
                <p className="text-lg font-bold text-foreground">{activeCount}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border border-border/60">
              <CardContent className="p-3 text-center">
                <Hourglass className="h-4 w-4 text-amber-500 mx-auto mb-1" />
                <p className="text-[10px] text-muted-foreground font-medium">Pending</p>
                <p className="text-lg font-bold text-foreground">{pendingCount}</p>
              </CardContent>
            </Card>
            <Card className="bg-card border border-border/60">
              <CardContent className="p-3 text-center">
                <UserX className="h-4 w-4 text-destructive mx-auto mb-1" />
                <p className="text-[10px] text-muted-foreground font-medium">Inactive</p>
                <p className="text-lg font-bold text-foreground">{inactiveCount}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}




      <Tabs defaultValue={pendingClients.length > 0 ? "pending" : "all"}>
        <TabsList className={cn(isMobile && "w-full")}>
          <TabsTrigger value="all" className={cn(isMobile && "flex-1 text-xs")}>
            All ({activeClients.length})
          </TabsTrigger>
          <TabsTrigger value="pending" className={cn("flex items-center gap-1.5", isMobile && "flex-1 text-xs")}>
            <Clock className="h-3.5 w-3.5" />
            Pending ({pendingClients.length})
            {pendingClients.length > 0 && (
              <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {pendingClients.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          {isMobile ? (
            isLoading ? <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p> : renderMobileCards(activeClients)
          ) : (
            <Card>
              <CardHeader><CardTitle className="text-lg">All Clients</CardTitle></CardHeader>
              <CardContent>{isLoading ? <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p> : renderTable(activeClients)}</CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pending">
          {isMobile ? (
            isLoading ? <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p> : renderMobileCards(pendingClients)
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-500" />
                  Pending Approval
                </CardTitle>
              </CardHeader>
              <CardContent>{isLoading ? <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p> : renderTable(pendingClients, true)}</CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Menu Permissions Dialog */}
      <Dialog open={!!permDialogUser} onOpenChange={(open) => !open && setPermDialogUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Menu Permissions</DialogTitle>
            <DialogDescription>
              Control which menus <strong>{permDialogUser?.full_name || permDialogUser?.email}</strong> can access.
              {selectedMenuKeys.length === 0 && " (No restrictions = full access)"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {ALL_MENU_KEYS.map(item => (
              <div key={item.key} className="flex items-center gap-3">
                <Checkbox id={`perm-${item.key}`} checked={selectedMenuKeys.includes(item.key)} onCheckedChange={(checked) => {
                  setSelectedMenuKeys(prev => checked ? [...prev, item.key] : prev.filter(k => k !== item.key));
                }} />
                <Label htmlFor={`perm-${item.key}`} className="cursor-pointer">{item.label}</Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermDialogUser(null)}>Cancel</Button>
            <Button onClick={() => savePermsMutation.mutate()} disabled={savePermsMutation.isPending}>
              {savePermsMutation.isPending ? "Saving..." : "Save Permissions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Banks Dialog */}
      <Dialog open={!!bankDialogUser} onOpenChange={(open) => { if (!open) { setBankDialogUser(null); setNewBankId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Banks — {bankDialogUser?.full_name || bankDialogUser?.email}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Current assignments */}
            <div>
              <p className="text-sm font-medium mb-2">Assigned Banks</p>
              {userBanks?.length === 0 && <p className="text-xs text-muted-foreground">No banks assigned</p>}
              <div className="space-y-2">
                {userBanks?.map((cb: any) => (
                  <div key={cb.id} className="flex items-center justify-between p-2 rounded-md border bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      {cb.bank_accounts?.logo_url ? (
                        <img src={cb.bank_accounts.logo_url} alt="" className="h-7 w-7 rounded border object-contain bg-white shrink-0" />
                      ) : (
                        <div className="h-7 w-7 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                          <Building2 className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{cb.bank_accounts?.bank_name}</p>
                        <p className="text-[11px] text-muted-foreground">{cb.bank_accounts?.account_number}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-destructive" onClick={() => unassignBankMutation.mutate(cb.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Add new */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Assign New Bank</p>
              <div className="flex gap-2">
                <Select value={newBankId} onValueChange={setNewBankId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a bank" />
                  </SelectTrigger>
                  <SelectContent>
                    {allBanks?.filter((b: any) => !userBanks?.some((ub: any) => ub.bank_account_id === b.id)).map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.bank_name} — {b.account_number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={() => assignBankMutation.mutate()} disabled={!newBankId || assignBankMutation.isPending}>
                  Assign
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Convert to Agency Dialog */}
      <Dialog open={!!convertDialog} onOpenChange={(open) => !open && setConvertDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Agency Owner</DialogTitle>
            <DialogDescription>
              Convert <strong>{convertDialog?.full_name || convertDialog?.email}</strong> from Client to Agency Owner. This will create a new agency and agency wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Agency Name</Label>
              <Input value={agencyName} onChange={e => setAgencyName(e.target.value)} placeholder="Agency Name" />
            </div>
            <div>
              <Label>Slug (subdomain)</Label>
              <Input value={agencySlug} onChange={e => setAgencySlug(e.target.value)} placeholder="agency-slug" />
              <p className="text-xs text-muted-foreground mt-1">Client domain: <strong>{agencySlug.toLowerCase().replace(/[^a-z0-9-]/g, "")}.crmsoftit.lovable.app</strong></p>
            </div>
            <div>
              <Label>USD Rate</Label>
              <Input type="number" value={agencyUsdRate} onChange={e => setAgencyUsdRate(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertDialog(null)}>Cancel</Button>
            <Button onClick={() => convertToAgencyMutation.mutate()} disabled={convertToAgencyMutation.isPending || !agencyName || !agencySlug}>
              {convertToAgencyMutation.isPending ? "Converting..." : "Convert to Agency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => { setDeleteDialog(null); setDeleteConfirmText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Permanently Delete Client
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <p>This will <strong>permanently delete</strong> the client <strong>{deleteDialog?.full_name || deleteDialog?.email}</strong> and ALL their data including:</p>
              <ul className="list-disc list-inside text-xs space-y-0.5 mt-2">
                <li>Profile, wallet, and account</li>
                <li>All ad accounts assignments</li>
                <li>All top-up requests and transactions</li>
                <li>All invoices and notifications</li>
                <li>Chat messages</li>
                <li>Auth account (they will need to sign up again)</li>
              </ul>
              <p className="font-semibold text-destructive mt-3">This action cannot be undone!</p>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Type <strong>DELETE</strong> to confirm</Label>
            <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteDialog(null); setDeleteConfirmText(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== "DELETE" || deleteClientMutation.isPending}
              onClick={() => deleteClientMutation.mutate(deleteDialog.user_id)}
            >
              {deleteClientMutation.isPending ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
