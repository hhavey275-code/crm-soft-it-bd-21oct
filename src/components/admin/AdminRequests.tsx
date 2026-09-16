import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, Search, Loader2 } from "lucide-react";
import { logSystemAction } from "@/lib/systemLog";
import { useIsMobile } from "@/hooks/use-mobile";
import { AdminWithdrawRequests } from "@/components/admin/AdminWithdrawRequests";
import { AdminExternalTopUpRequests } from "@/components/admin/AdminExternalTopUpRequests";


export function AdminRequests() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  // Ad Account Requests
  const { data: adRequests = [] } = useQuery({
    queryKey: ["admin-ad-requests"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_account_requests")
        .select("*")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // BM Access Requests
  const { data: bmRequests = [] } = useQuery({
    queryKey: ["admin-bm-requests"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("bm_access_requests")
        .select("*, ad_accounts(account_name, account_id, business_manager_id)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Fetch requester profiles separately
  const requesterIds = [...new Set([
    ...adRequests.map((r: any) => r.user_id),
    ...bmRequests.map((r: any) => r.user_id),
  ])];

  const { data: profiles = [] } = useQuery({
    queryKey: ["request-profiles", requesterIds.join(",")],
    queryFn: async () => {
      if (requesterIds.length === 0) return [];
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", requesterIds);
      return data ?? [];
    },
    enabled: requesterIds.length > 0,
  });

  const getProfile = (userId: string) => profiles.find((p: any) => p.user_id === userId);

  // Approve Ad Account Request Dialog
  const [approveAdReq, setApproveAdReq] = useState<any>(null);
  const [adAccountSearch, setAdAccountSearch] = useState("");
  const [selectedAdAccount, setSelectedAdAccount] = useState<any>(null);
  const [approveLoading, setApproveLoading] = useState(false);
  const [adminNote, setAdminNote] = useState("");

  // Search ad accounts for assignment
  const { data: searchResults = [] } = useQuery({
    queryKey: ["search-ad-accounts", adAccountSearch],
    queryFn: async () => {
      if (!adAccountSearch || adAccountSearch.length < 2) return [];
      const { data } = await supabase
        .from("ad_accounts")
        .select("id, account_name, account_id")
        .or(`account_name.ilike.%${adAccountSearch}%,account_id.ilike.%${adAccountSearch}%`)
        .limit(10);
      return data ?? [];
    },
    enabled: adAccountSearch.length >= 2,
  });

  const handleApproveAdRequest = async () => {
    if (!approveAdReq || !selectedAdAccount) return;
    setApproveLoading(true);
    try {
      // Assign ad account to client
      const { error: assignErr } = await (supabase as any)
        .from("user_ad_accounts")
        .insert({ user_id: approveAdReq.user_id, ad_account_id: selectedAdAccount.id });
      if (assignErr) {
        if (assignErr.message?.includes("duplicate") || assignErr.message?.includes("unique")) {
          toast.error("This ad account is already assigned to a client");
        } else {
          throw assignErr;
        }
        setApproveLoading(false);
        return;
      }

      // Update request status
      await (supabase as any)
        .from("ad_account_requests")
        .update({
          status: "approved",
          assigned_ad_account_id: selectedAdAccount.id,
          reviewed_by: user!.id,
          admin_note: adminNote || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", approveAdReq.id);

      // Notify client
      await (supabase as any).from("notifications").insert({
        user_id: approveAdReq.user_id,
        type: "ad_account_request",
        title: "Ad Account Request Approved",
        message: `Your ad account request "${approveAdReq.account_name}" has been approved.`,
        reference_id: approveAdReq.id,
      });

      const clientName = getProfile(approveAdReq.user_id)?.full_name || approveAdReq.email;
      await logSystemAction("Ad Account Request Approved", `"${approveAdReq.account_name}" assigned to ${clientName}`, user!.id, user!.email);
      toast.success("Ad account request approved and assigned");
      setApproveAdReq(null);
      setSelectedAdAccount(null);
      setAdAccountSearch("");
      setAdminNote("");
      queryClient.invalidateQueries({ queryKey: ["admin-ad-requests"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to approve");
    } finally {
      setApproveLoading(false);
    }
  };

  const handleRejectAdRequest = async (req: any) => {
    try {
      await (supabase as any)
        .from("ad_account_requests")
        .update({ status: "rejected", reviewed_by: user!.id, updated_at: new Date().toISOString() })
        .eq("id", req.id);

      await (supabase as any).from("notifications").insert({
        user_id: req.user_id,
        type: "ad_account_request",
        title: "Ad Account Request Rejected",
        message: `Your ad account request "${req.account_name}" has been rejected.`,
        reference_id: req.id,
      });

      await logSystemAction("Ad Account Request Rejected", `"${req.account_name}"`, user!.id, user!.email);
      toast.success("Request rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-ad-requests"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to reject");
    }
  };

  // BM Access approve/reject
  const [bmApproveLoading, setBmApproveLoading] = useState<string | null>(null);

  const handleApproveBmRequest = async (req: any) => {
    setBmApproveLoading(req.id);
    try {
      // No Meta API call — admin manually shares BM partner in Meta Business Manager
      // Just update database status and notify client
      await (supabase as any)
        .from("bm_access_requests")
        .update({ status: "approved", reviewed_by: user!.id, updated_at: new Date().toISOString() })
        .eq("id", req.id);

      await (supabase as any).from("notifications").insert({
        user_id: req.user_id,
        type: "bm_access_request",
        title: "BM Access Request Approved",
        message: `Your BM partner access request for "${req.bm_name}" has been approved. Partner access has been granted.`,
        reference_id: req.id,
      });

      await logSystemAction("BM Access Approved", `BM "${req.bm_name}" (${req.bm_id})`, user!.id, user!.email);
      toast.success("BM request approved — make sure you've shared partner access in Meta Business Manager");
      queryClient.invalidateQueries({ queryKey: ["admin-bm-requests"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to approve BM request");
    } finally {
      setBmApproveLoading(null);
    }
  };

  const handleRejectBmRequest = async (req: any) => {
    try {
      await (supabase as any)
        .from("bm_access_requests")
        .update({ status: "rejected", reviewed_by: user!.id, updated_at: new Date().toISOString() })
        .eq("id", req.id);

      await (supabase as any).from("notifications").insert({
        user_id: req.user_id,
        type: "bm_access_request",
        title: "BM Access Request Rejected",
        message: `Your BM partner access request for "${req.bm_name}" has been rejected.`,
        reference_id: req.id,
      });

      await logSystemAction("BM Access Rejected", `BM "${req.bm_name}" (${req.bm_id})`, user!.id, user!.email);
      toast.success("BM request rejected");
      queryClient.invalidateQueries({ queryKey: ["admin-bm-requests"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to reject");
    }
  };

  const pendingAdCount = adRequests.filter((r: any) => r.status === "pending").length;
  const pendingBmCount = bmRequests.filter((r: any) => r.status === "pending").length;

  const { data: pendingWithdrawCount = 0 } = useQuery({
    queryKey: ["admin-withdraw-requests-count"],
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("spend_cap_withdraw_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      return count || 0;
    },
    refetchInterval: 20000,
  });

  const { data: pendingExternalCount = 0 } = useQuery({
    queryKey: ["admin-external-topup-pending-count"],
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("external_topup_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      return count || 0;
    },
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl md:text-2xl font-bold">Requests</h1>

      <Tabs defaultValue="ad-account">
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="ad-account" className="gap-1.5 flex-1 md:flex-none text-xs md:text-sm">
            {isMobile ? "Ad Acc" : "Ad Account Requests"}
            {pendingAdCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {pendingAdCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="bm-access" className="gap-1.5 flex-1 md:flex-none text-xs md:text-sm">
            {isMobile ? "BM" : "BM Access Requests"}
            {pendingBmCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {pendingBmCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="withdraw" className="gap-1.5 flex-1 md:flex-none text-xs md:text-sm">
            {isMobile ? "Withdraw" : "Balance Withdraw"}
            {pendingWithdrawCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {pendingWithdrawCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="withdraw">
          <AdminWithdrawRequests />
        </TabsContent>


        <TabsContent value="ad-account">
          {isMobile ? (
            <div className="space-y-3">
              {adRequests.length === 0 ? (
                <Card><CardContent className="text-center text-muted-foreground py-8 text-sm">No requests</CardContent></Card>
              ) : adRequests.map((r: any) => {
                const p = getProfile(r.user_id);
                return (
                  <Card key={r.id} className="overflow-hidden">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{p?.full_name || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground truncate">{p?.email || r.email}</p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Account</p>
                          <p className="font-medium truncate">{r.account_name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">BM ID</p>
                          <p className="font-mono text-[11px] truncate">{r.business_manager_id}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Monthly</p>
                          <p>{r.monthly_spend || "—"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Date</p>
                          <p>{format(new Date(r.created_at), "MMM d")}</p>
                        </div>
                      </div>
                      {r.status === "pending" && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button size="sm" className="gap-1 flex-1 h-8 text-xs" onClick={() => { setApproveAdReq(r); setAdminNote(""); setSelectedAdAccount(null); setAdAccountSearch(""); }}>
                            <Check className="h-3 w-3" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="gap-1 flex-1 h-8 text-xs" onClick={() => handleRejectAdRequest(r)}>
                            <X className="h-3 w-3" /> Reject
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead>BM ID</TableHead>
                    <TableHead>Monthly Spend</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adRequests.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No requests</TableCell></TableRow>
                  ) : adRequests.map((r: any) => {
                    const p = getProfile(r.user_id);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{p?.full_name || "Unknown"}</p>
                            <p className="text-xs text-muted-foreground">{p?.email || r.email}</p>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{r.account_name}</TableCell>
                        <TableCell className="text-sm font-mono">{r.business_manager_id}</TableCell>
                        <TableCell className="text-sm">{r.monthly_spend || "—"}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                        <TableCell>
                          {r.status === "pending" ? (
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="default" className="gap-1" onClick={() => { setApproveAdReq(r); setAdminNote(""); setSelectedAdAccount(null); setAdAccountSearch(""); }}>
                                <Check className="h-3 w-3" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" className="gap-1" onClick={() => handleRejectAdRequest(r)}>
                                <X className="h-3 w-3" /> Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          )}
        </TabsContent>

        <TabsContent value="bm-access">
          {isMobile ? (
            <div className="space-y-3">
              {bmRequests.length === 0 ? (
                <Card><CardContent className="text-center text-muted-foreground py-8 text-sm">No requests</CardContent></Card>
              ) : bmRequests.map((r: any) => {
                const p = getProfile(r.user_id);
                return (
                  <Card key={r.id} className="overflow-hidden">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{p?.full_name || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground truncate">{p?.email || "—"}</p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="col-span-2">
                          <p className="text-[10px] uppercase text-muted-foreground">Ad Account</p>
                          <p className="font-medium truncate">{r.ad_accounts?.account_name || "—"}</p>
                          {r.ad_accounts?.account_id && <p className="text-[11px] text-muted-foreground font-mono">{r.ad_accounts.account_id.replace(/^act_/, '')}</p>}
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">BM Name</p>
                          <p className="truncate">{r.bm_name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">BM ID</p>
                          <p className="font-mono text-[11px] truncate">{r.bm_id}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[10px] uppercase text-muted-foreground">Date</p>
                          <p>{format(new Date(r.created_at), "MMM d, yyyy")}</p>
                        </div>
                      </div>
                      {r.status === "pending" && (
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            className="gap-1 flex-1 h-8 text-xs"
                            onClick={() => handleApproveBmRequest(r)}
                            disabled={bmApproveLoading === r.id}
                          >
                            {bmApproveLoading === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="gap-1 flex-1 h-8 text-xs" onClick={() => handleRejectBmRequest(r)}>
                            <X className="h-3 w-3" /> Reject
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Ad Account</TableHead>
                    <TableHead>BM Name</TableHead>
                    <TableHead>BM ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bmRequests.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No requests</TableCell></TableRow>
                  ) : bmRequests.map((r: any) => {
                    const p = getProfile(r.user_id);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium">{p?.full_name || "Unknown"}</p>
                            <p className="text-xs text-muted-foreground">{p?.email || "—"}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.ad_accounts?.account_name || "—"}</div>
                          {r.ad_accounts?.account_id && <div className="text-xs text-muted-foreground font-mono">{r.ad_accounts.account_id.replace(/^act_/, '')}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{r.bm_name}</TableCell>
                        <TableCell className="text-sm font-mono">{r.bm_id}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                        <TableCell>
                          {r.status === "pending" ? (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="default"
                                className="gap-1"
                                onClick={() => handleApproveBmRequest(r)}
                                disabled={bmApproveLoading === r.id}
                              >
                                {bmApproveLoading === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                Approve
                              </Button>
                              <Button size="sm" variant="destructive" className="gap-1" onClick={() => handleRejectBmRequest(r)}>
                                <X className="h-3 w-3" /> Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Approve Ad Account Dialog - assign existing account */}
      <Dialog open={!!approveAdReq} onOpenChange={(open) => { if (!open) setApproveAdReq(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Approve Ad Account Request</DialogTitle>
            <DialogDescription>
              Search and assign an existing ad account to the client for request: <span className="font-medium text-foreground">{approveAdReq?.account_name}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Search Ad Account</Label>
              <div className="relative mt-1.5">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or ID..."
                  value={adAccountSearch}
                  onChange={(e) => { setAdAccountSearch(e.target.value); setSelectedAdAccount(null); }}
                  className="pl-9"
                />
              </div>
              {searchResults.length > 0 && !selectedAdAccount && (
                <div className="mt-2 max-h-40 overflow-y-auto border rounded-md">
                  {searchResults.map((acc: any) => (
                    <button
                      key={acc.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0"
                      onClick={() => { setSelectedAdAccount(acc); setAdAccountSearch(acc.account_name); }}
                    >
                      <span className="font-medium">{acc.account_name}</span>
                      <span className="text-muted-foreground ml-2 font-mono text-xs">{acc.account_id}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedAdAccount && (
                <p className="mt-2 text-sm text-primary">
                  ✓ Selected: <span className="font-medium">{selectedAdAccount.account_name}</span> ({selectedAdAccount.account_id})
                </p>
              )}
            </div>
            <div>
              <Label>Admin Note (optional)</Label>
              <Textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Add a note..."
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveAdReq(null)}>Cancel</Button>
            <Button onClick={handleApproveAdRequest} disabled={!selectedAdAccount || approveLoading}>
              {approveLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
              Approve & Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
