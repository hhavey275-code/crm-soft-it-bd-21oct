import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, RefreshCw, Building2, ChevronDown, ChevronRight, Search, Pencil, Trash2, Loader2 } from "lucide-react";
import { friendlyEdgeError } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

export function AdminTikTokBusinessCenters() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [showAddBc, setShowAddBc] = useState(false);
  const [bcName, setBcName] = useState("");
  const [bcId, setBcId] = useState("");
  const [bcToken, setBcToken] = useState("");
  const [connectingOAuth, setConnectingOAuth] = useState(false);

  const [expandedBc, setExpandedBc] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editBc, setEditBc] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editBcId, setEditBcId] = useState("");
  const [editToken, setEditToken] = useState("");
  const [deleteBcId, setDeleteBcId] = useState<string | null>(null);

  // Import dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [syncedAccounts, setSyncedAccounts] = useState<any[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [existingAccountIds, setExistingAccountIds] = useState<Set<string>>(new Set());
  const [importSearch, setImportSearch] = useState("");

  // Fetch TikTok BCs
  const { data: bcs = [] } = useQuery({
    queryKey: ["tiktok-bcs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_managers")
        .select("*")
        .eq("platform", "tiktok")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch TikTok App ID from site_settings for OAuth
  const { data: tiktokAppId } = useQuery({
    queryKey: ["tiktok-app-id-setting"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "tiktok_app_id").single();
      return data?.value ?? "";
    },
  });

  // Fetch TikTok ad accounts
  const { data: adAccounts = [] } = useQuery({
    queryKey: ["tiktok-bc-ad-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("*")
        .eq("platform", "tiktok")
        .not("business_manager_id", "is", null);
      if (error) throw error;
      return data;
    },
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["admin-user-ad-accounts"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("user_ad_accounts").select("*");
      return (data as any[]) ?? [];
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["admin-clients-list"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email");
      return (data as any[]) ?? [];
    },
  });

  // Add BC
  const addBcMutation = useMutation({
    mutationFn: async () => {
      if (!bcName || !bcId || !bcToken) throw new Error("All fields required");
      const { error } = await supabase.from("business_managers").insert({
        name: bcName,
        bm_id: bcId,
        access_token: bcToken,
        platform: "tiktok",
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("TikTok Business Center added");
      queryClient.invalidateQueries({ queryKey: ["tiktok-bcs"] });
      setShowAddBc(false);
      setBcName("");
      setBcId("");
      setBcToken("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Sync TikTok accounts - returns synced accounts for import dialog
  const syncMutation = useMutation({
    mutationFn: async (bmId: string) => {
      setSyncingId(bmId);
      const { data, error } = await supabase.functions.invoke("tiktok-sync", {
        body: { business_manager_id: bmId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return { ...data, bmId };
    },
    onSuccess: async (data) => {
      toast.success(`Synced ${data.synced_count ?? 0} TikTok accounts`);
      queryClient.invalidateQueries({ queryKey: ["tiktok-bc-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-bcs"] });
      setSyncingId(null);
    },
    onError: (err: any) => {
      toast.error(friendlyEdgeError(err));
      setSyncingId(null);
    },
  });

  // Update BC
  const updateBcMutation = useMutation({
    mutationFn: async () => {
      if (!editBc) throw new Error("No BC selected");
      const updates: any = {};
      if (editName && editName !== editBc.name) updates.name = editName;
      if (editBcId && editBcId !== editBc.bm_id) updates.bm_id = editBcId;
      if (editToken) updates.access_token = editToken;
      if (Object.keys(updates).length === 0) throw new Error("No changes to save");
      const { error } = await supabase.from("business_managers").update(updates).eq("id", editBc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Business Center updated");
      setEditOpen(false);
      setEditBc(null);
      queryClient.invalidateQueries({ queryKey: ["tiktok-bcs"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Delete BC
  const deleteBcMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete associated ad accounts first
      const { data: accounts } = await supabase
        .from("ad_accounts")
        .select("id")
        .eq("business_manager_id", id);
      const accountIds = (accounts ?? []).map((a: any) => a.id);
      if (accountIds.length > 0) {
        await (supabase as any).from("user_ad_accounts").delete().in("ad_account_id", accountIds);
        await supabase.from("ad_accounts").delete().eq("business_manager_id", id);
      }
      const { error } = await supabase.from("business_managers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Business Center and all ad accounts removed");
      setDeleteBcId(null);
      queryClient.invalidateQueries({ queryKey: ["tiktok-bcs"] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-bc-ad-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["tiktok-ad-accounts"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Assign account to client
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

  const getAssignedUserId = (accountId: string) => {
    return assignments.find((a: any) => a.ad_account_id === accountId)?.user_id ?? null;
  };

  const bcAccountsList = (bcId: string) => {
    return adAccounts.filter((a: any) => a.business_manager_id === bcId);
  };

  const openEdit = (bc: any) => {
    setEditBc(bc);
    setEditName(bc.name);
    setEditBcId(bc.bm_id);
    setEditToken("");
    setEditOpen(true);
  };

  return (
    <div className={cn("space-y-4", !isMobile && "space-y-6")}>
      {/* Header */}
      <div className={cn("flex items-center justify-between", isMobile && "flex-col items-start gap-3")}>
        <h2 className={cn("font-bold flex items-center gap-2", isMobile ? "text-lg" : "text-xl")}>
          TikTok Business Centers
        </h2>
        <Button size={isMobile ? "sm" : "default"} onClick={() => setShowAddBc(true)}>
          <Plus className={cn("h-4 w-4", !isMobile && "mr-2")} />
          {isMobile ? "Add BC" : "Add Business Center"}
        </Button>
      </div>

      {/* BC Cards */}
      {bcs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No TikTok Business Centers added yet. Click "Add Business Center" to get started.
          </CardContent>
        </Card>
      ) : (
        bcs.map((bc: any) => {
          const accounts = bcAccountsList(bc.id);
          const isExpanded = expandedBc === bc.id;

          return (
            <Card key={bc.id}>
              <CardContent className="p-4">
                {/* BC Header */}
                <div className="flex items-center gap-3">
                  <button
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    onClick={() => setExpandedBc(isExpanded ? null : bc.id)}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{bc.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{bc.bm_id}</p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-muted-foreground">{accounts.length} accounts</span>
                    {bc.last_synced_at && (
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">
                        Synced {formatDistanceToNow(new Date(bc.last_synced_at), { addSuffix: true })}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={syncingId === bc.id}
                      onClick={() => syncMutation.mutate(bc.id)}
                    >
                      {syncingId === bc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(bc)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteBcId(bc.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Expanded accounts */}
                {isExpanded && (
                  <div className="mt-4">
                    {accounts.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-4">
                        No accounts synced yet. Click sync to fetch from TikTok.
                      </p>
                    ) : isMobile ? (
                      <div className="space-y-2">
                        {accounts.map((a: any) => (
                          <div key={a.id} className="border border-border/60 rounded-lg p-3 bg-card">
                            <div className="flex items-start justify-between mb-1">
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-sm truncate">{a.account_name}</p>
                                <p className="text-[11px] text-muted-foreground font-mono">{a.account_id}</p>
                              </div>
                              <StatusBadge status={a.status} />
                            </div>
                            <div className="mt-2">
                              <Select
                                value={getAssignedUserId(a.id) || "unassigned"}
                                onValueChange={(val) => assignMutation.mutate({ accountId: a.id, userId: val === "unassigned" ? null : val })}
                              >
                                <SelectTrigger className="w-full h-8 text-xs">
                                  <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unassigned">Unassigned</SelectItem>
                                  {clients.map((c: any) => (
                                    <SelectItem key={c.user_id} value={c.user_id}>
                                      {c.full_name || c.email || c.user_id}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Account Name</TableHead>
                            <TableHead>Account ID</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Assigned To</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {accounts.map((a: any) => (
                            <TableRow key={a.id}>
                              <TableCell className="font-medium">{a.account_name}</TableCell>
                              <TableCell className="text-muted-foreground font-mono text-xs">{a.account_id}</TableCell>
                              <TableCell><StatusBadge status={a.status} /></TableCell>
                              <TableCell>
                                <Select
                                  value={getAssignedUserId(a.id) || "unassigned"}
                                  onValueChange={(val) => assignMutation.mutate({ accountId: a.id, userId: val === "unassigned" ? null : val })}
                                >
                                  <SelectTrigger className="w-40 h-8 text-xs">
                                    <SelectValue placeholder="Unassigned" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unassigned">Unassigned</SelectItem>
                                    {clients.map((c: any) => (
                                      <SelectItem key={c.user_id} value={c.user_id}>
                                        {c.full_name || c.email || c.user_id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Add BC Dialog */}
      <Dialog open={showAddBc} onOpenChange={setShowAddBc}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add TikTok Business Center</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>BC Name</Label>
              <Input value={bcName} onChange={(e) => setBcName(e.target.value)} placeholder="My TikTok BC" />
            </div>
            <div>
              <Label>BC ID</Label>
              <Input value={bcId} onChange={(e) => setBcId(e.target.value)} placeholder="e.g. 7012345678901234567" />
            </div>

            {/* OAuth Connect Option */}
            <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
              <p className="text-sm font-medium">Option 1: Connect via TikTok OAuth (Recommended)</p>
              <p className="text-xs text-muted-foreground">BC Name ও BC ID দিয়ে নিচের বাটনে ক্লিক করুন। TikTok authorize করলে token automatically সেভ হবে।</p>
              <Button
                variant="default"
                className="w-full"
                disabled={!bcName || !bcId || connectingOAuth || !tiktokAppId}
                onClick={() => {
                  sessionStorage.setItem("tiktok_pending_bc_name", bcName);
                  sessionStorage.setItem("tiktok_pending_bc_id", bcId);
                  setConnectingOAuth(true);
                  const redirectUri = encodeURIComponent(window.location.origin + "/dashboard");
                  const state = "tiktok_bc_" + Date.now();
                  const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=${tiktokAppId}&state=${state}&redirect_uri=${redirectUri}`;
                  window.location.href = authUrl;
                }}
              >
                {connectingOAuth ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {!tiktokAppId ? "TikTok App ID not set (Settings → API Secrets)" : "Connect via TikTok"}
              </Button>
            </div>

            {/* Manual Token Option */}
            <div className="border rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium">Option 2: Manual Token</p>
              <div>
                <Label>Access Token</Label>
                <Input type="password" value={bcToken} onChange={(e) => setBcToken(e.target.value)} placeholder="TikTok API access token" />
              </div>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => addBcMutation.mutate()} 
                disabled={addBcMutation.isPending || !bcName || !bcId || !bcToken}
              >
                {addBcMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save with Manual Token
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddBc(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit BC Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Business Center</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>BC Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <Label>BC ID</Label>
              <Input value={editBcId} onChange={(e) => setEditBcId(e.target.value)} />
            </div>
            <div>
              <Label>Access Token (leave empty to keep current)</Label>
              <Input type="password" value={editToken} onChange={(e) => setEditToken(e.target.value)} placeholder="Leave empty to keep current" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => updateBcMutation.mutate()} disabled={updateBcMutation.isPending}>
              {updateBcMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteBcId} onOpenChange={(o) => !o && setDeleteBcId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Business Center?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the Business Center and all associated TikTok ad accounts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteBcId && deleteBcMutation.mutate(deleteBcId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
