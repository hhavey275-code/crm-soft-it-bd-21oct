import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { Link } from "@/lib/router-compat";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { useState } from "react";
import { Check, X, Pause, ImageIcon, FileText, Send } from "lucide-react";

type ActionType = "approved" | "rejected" | "hold";

export function SellerTopUpApprovals() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();

  const canApprove = !!(profile as any)?.can_approve_topups;

  const [statusFilter, setStatusFilter] = useState("pending");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [actionDialog, setActionDialog] = useState<{
    id: string; action: ActionType; userId: string; amount: number; bdtAmount: number | null;
  } | null>(null);

  const { data: bundle, isLoading } = useQuery({
    queryKey: ["seller-topup-approvals", user?.id],
    queryFn: async () => {
      const { data: banks } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_number, telegram_group_id, seller_id")
        .eq("seller_id", user!.id);
      const bankIds = (banks || []).map((b) => b.id);
      if (!bankIds.length) return { requests: [], banks: [] as any[] };

      const { data: reqs, error } = await supabase
        .from("top_up_requests")
        .select("*")
        .in("bank_account_id", bankIds)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const userIds = Array.from(new Set((reqs || []).map((r: any) => r.user_id)));
      const reviewerIds = Array.from(new Set((reqs || []).filter((r: any) => r.reviewed_by).map((r: any) => r.reviewed_by)));
      const allIds = Array.from(new Set([...userIds, ...reviewerIds]));
      const { data: profiles } = allIds.length
        ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", allIds)
        : { data: [] as any[] };
      const pmap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { pmap[p.user_id] = p; });
      const bmap: Record<string, any> = {};
      (banks || []).forEach((b: any) => { bmap[b.id] = b; });

      const enriched = (reqs || []).map((r: any) => ({
        ...r,
        profile: pmap[r.user_id] || null,
        reviewerProfile: r.reviewed_by ? pmap[r.reviewed_by] || null : null,
        bankAccount: r.bank_account_id ? bmap[r.bank_account_id] || null : null,
      }));

      return { requests: enriched, banks: banks || [] };
    },
    enabled: !!user,
  });

  const requests = bundle?.requests || [];
  const banks = bundle?.banks || [];

  const filtered = requests.filter((r: any) => statusFilter === "all" ? true : r.status === statusFilter);

  const getBankDisplay = (bank: any) => {
    if (!bank) return "—";
    const last4 = (bank.account_number || "").slice(-4);
    return `${bank.bank_name} ****${last4}`;
  };

  const getProcessedByLabel = (r: any) => {
    if (r.status === "pending") return "Pending";
    if (r.status === "approved" && !r.reviewed_by) return "Auto Approved";
    if (r.reviewerProfile) return r.reviewerProfile.full_name || r.reviewerProfile.email || "—";
    if (r.status === "approved") return "Approved";
    if (r.status === "rejected") return "Rejected";
    if (r.status === "hold") return "On Hold";
    return "—";
  };

  const processMutation = useMutation({
    mutationFn: async ({ id, action, userId, amount }: { id: string; action: ActionType; userId: string; amount: number }) => {
      if (!canApprove) throw new Error("Approval not enabled for your account");

      if (action === "approved") {
        const { data: approvalResult, error: approvalError } = await (supabase as any).rpc(
          "approve_client_topup_atomic",
          { p_request_id: id, p_admin: user!.id },
        );
        if (approvalError) throw approvalError;
        if (approvalResult?.success !== true) {
          throw new Error(approvalResult?.error || "Top-up approval failed");
        }


        // Initialize forward flag only. Telegram forwarding is handled by the
        // database trigger on the status change, so we must not invoke it here
        // as a second path for the same approval.
        try {
          const r = requests.find((x: any) => x.id === id);
          if (r?.bankAccount?.telegram_group_id) {
            await (supabase as any)
              .from("top_up_requests")
              .update({ telegram_forwarded: false })
              .eq("id", id)
              .is("telegram_forwarded", null);
          }
        } catch (e) {
          console.warn("telegram_forwarded init failed (non-blocking):", e);
        }
      } else {
        const updateData: any = { status: action, reviewed_by: user!.id };
        if (note) updateData.admin_note = note;
        const { data: updatedRows, error: updateErr } = await supabase
          .from("top_up_requests")
          .update(updateData)
          .eq("id", id)
          .in("status", ["pending", "hold"])
          .select("id");
        if (updateErr) throw updateErr;
        if (!updatedRows?.length) throw new Error("Already processed. Please refresh.");
      }

      // Notify client
      await supabase.from("notifications").insert({
        user_id: userId, type: "top_up_update",
        title: action === "approved" ? "Top-Up Approved" : action === "rejected" ? "Top-Up Rejected" : "Top-Up On Hold",
        message: action === "approved"
          ? `Your top-up of $${amount} has been approved.`
          : action === "rejected"
            ? `Your top-up of $${amount} was rejected.${note ? " Reason: " + note : ""}`
            : `Your top-up of $${amount} is on hold.${note ? " Note: " + note : ""}`,
        reference_id: id,
      } as any);
    },
    onSuccess: (_, { action }) => {
      toast.success(`Request ${action === "hold" ? "put on hold" : action}`);
      qc.invalidateQueries({ queryKey: ["seller-topup-approvals"] });
      setActionDialog(null);
      setNote("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resendForwardMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.functions.invoke("forward-proof", { body: { request_id: requestId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.skipped) toast.info(`Skipped: ${data.reason || "already forwarded"}`);
      else toast.success("Resent to Telegram!");
      qc.invalidateQueries({ queryKey: ["seller-topup-approvals"] });
    },
    onError: (e: any) => toast.error(`Resend failed: ${e.message}`),
  });

  const openAction = (r: any, action: ActionType) => {
    setNote("");
    setActionDialog({ id: r.id, action, userId: r.user_id, amount: Number(r.amount), bdtAmount: r.bdt_amount });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className={cn("flex gap-2", isMobile ? "flex-col" : "items-center justify-between")}>
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Top-Up Requests</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Requests submitted on your banks{banks.length ? ` (${banks.length})` : ""}.
          </p>
        </div>
      </div>

      {!canApprove && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-3 text-xs md:text-sm text-amber-700 dark:text-amber-300">
            Approval is not enabled for your account. Contact admin to allow you to approve top-ups.
          </CardContent>
        </Card>
      )}

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className={cn(isMobile && "w-full overflow-x-auto flex")}>
          <TabsTrigger value="all" className={cn(isMobile && "text-xs flex-1")}>All</TabsTrigger>
          <TabsTrigger value="pending" className={cn(isMobile && "text-xs flex-1")}>Pending</TabsTrigger>
          <TabsTrigger value="approved" className={cn(isMobile && "text-xs flex-1")}>Approved</TabsTrigger>
          <TabsTrigger value="rejected" className={cn(isMobile && "text-xs flex-1")}>Rejected</TabsTrigger>
          <TabsTrigger value="hold" className={cn(isMobile && "text-xs flex-1")}>Hold</TabsTrigger>
        </TabsList>
      </Tabs>

      {isMobile ? (
        <div className="space-y-2.5">
          {isLoading ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No requests</p>
          ) : filtered.map((r: any) => (
            <Card key={r.id} className="border border-border/60 shadow-sm">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold truncate">
                    {r.profile?.full_name || r.profile?.email || r.user_id.slice(0, 8)}
                  </div>
                  <StatusBadge status={r.status} />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold">{r.bdt_amount ? `৳${Number(r.bdt_amount).toLocaleString()}` : "—"}</span>
                    <span className="text-xs text-muted-foreground ml-1">(${Number(r.amount).toLocaleString()})</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{getBankDisplay(r.bankAccount)}</span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-mono truncate max-w-[55%]">{r.payment_reference || "—"}</span>
                  <div className="flex items-center gap-2">
                    {r.proof_url && (
                      <button onClick={() => setProofUrl(r.proof_url)} className="inline-flex items-center gap-1 text-primary text-xs">
                        <ImageIcon className="h-3.5 w-3.5" />Proof
                      </button>
                    )}
                    <span className="text-muted-foreground">{format(new Date(r.created_at), "MMM d, hh:mm a")}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Processed By</span>
                  <span className="font-medium text-foreground">{getProcessedByLabel(r)}</span>
                </div>

                {r.status === "approved" && r.bankAccount?.telegram_group_id && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Telegram</span>
                    <span className={cn("font-medium flex items-center gap-1",
                      r.telegram_forwarded === true ? "text-green-600 dark:text-green-400"
                        : r.telegram_forwarded === false ? "text-destructive"
                        : "text-muted-foreground")}>
                      <Send className="h-3 w-3" />
                      {r.telegram_forwarded === true ? "Forwarded" : r.telegram_forwarded === false ? "Not Forwarded" : "—"}
                      {r.telegram_forwarded !== true && (
                        <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] ml-1"
                          disabled={resendForwardMutation.isPending}
                          onClick={() => resendForwardMutation.mutate(r.id)}>
                          Resend
                        </Button>
                      )}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t">
                  {(r.status === "pending" || r.status === "hold") && canApprove && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-primary" onClick={() => openAction(r, "approved")}>
                        <Check className="h-3.5 w-3.5 mr-0.5" />Approve
                      </Button>
                      {r.status !== "hold" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-orange-500" onClick={() => openAction(r, "hold")}>
                          <Pause className="h-3.5 w-3.5 mr-0.5" />Hold
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-destructive" onClick={() => openAction(r, "rejected")}>
                        <X className="h-3.5 w-3.5 mr-0.5" />Reject
                      </Button>
                    </>
                  )}
                  {r.status === "approved" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                      <Link to={`/invoice/${r.id}`} target="_blank"><FileText className="h-3.5 w-3.5" /></Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {statusFilter === "all" ? "All" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Requests
              {filtered && ` (${filtered.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Bank</TableHead>
                  <TableHead className="text-xs">Client</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Ref</TableHead>
                  <TableHead className="text-xs">Proof</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Processed By</TableHead>
                  <TableHead className="text-xs">Fwd</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8">Loading...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No requests</TableCell></TableRow>
                ) : filtered.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap py-2 px-2">
                      <div>{format(new Date(r.created_at), "MMM d")}</div>
                      <div>{format(new Date(r.created_at), "hh:mm a")}</div>
                    </TableCell>
                    <TableCell className="text-xs py-2 px-2">{getBankDisplay(r.bankAccount)}</TableCell>
                    <TableCell className="py-2 px-2 text-xs font-medium">
                      {r.profile?.full_name || r.profile?.email || r.user_id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="py-2 px-2">
                      <div>
                        <span className="text-xs font-semibold">{r.bdt_amount ? `৳${Number(r.bdt_amount).toLocaleString()}` : "—"}</span>
                        <span className="text-[10px] text-muted-foreground block">${Number(r.amount).toLocaleString()}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono py-2 px-2 max-w-[120px] truncate">{r.payment_reference || "—"}</TableCell>
                    <TableCell className="py-2 px-2">
                      {r.proof_url ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setProofUrl(r.proof_url)}>
                          <ImageIcon className="h-4 w-4" />
                        </Button>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="py-2 px-2"><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-xs py-2 px-2">{getProcessedByLabel(r)}</TableCell>
                    <TableCell className="text-xs py-2 px-2">
                      {r.status === "approved" && r.bankAccount?.telegram_group_id ? (
                        <span className={cn("font-medium flex items-center gap-1",
                          r.telegram_forwarded === true ? "text-green-600 dark:text-green-400"
                            : r.telegram_forwarded === false ? "text-destructive"
                            : "text-muted-foreground")}>
                          <Send className="h-3 w-3" />
                          {r.telegram_forwarded === true ? "Sent" : r.telegram_forwarded === false ? "No" : "—"}
                          {r.telegram_forwarded !== true && (
                            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px] ml-1"
                              disabled={resendForwardMutation.isPending}
                              onClick={() => resendForwardMutation.mutate(r.id)}>Resend</Button>
                          )}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="py-2 px-2">
                      <div className="flex items-center gap-1">
                        {(r.status === "pending" || r.status === "hold") && canApprove && (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-primary" onClick={() => openAction(r, "approved")}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            {r.status !== "hold" && (
                              <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-orange-500" onClick={() => openAction(r, "hold")}>
                                <Pause className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-destructive" onClick={() => openAction(r, "rejected")}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <Button size="sm" variant="ghost" className="h-7" asChild>
                            <Link to={`/invoice/${r.id}`} target="_blank"><FileText className="h-3.5 w-3.5" /></Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!proofUrl} onOpenChange={(o) => !o && setProofUrl(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Payment Proof</DialogTitle></DialogHeader>
          {proofUrl && <img src={proofUrl} alt="Proof" className="w-full rounded" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionDialog} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.action === "approved" ? "Approve Top-Up" : actionDialog?.action === "hold" ? "Hold Top-Up" : "Reject Top-Up"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              Amount: <span className="font-semibold">${actionDialog?.amount}</span>
              {actionDialog?.bdtAmount ? <span className="text-muted-foreground ml-2">৳{Number(actionDialog.bdtAmount).toLocaleString()}</span> : null}
            </div>
            {actionDialog?.action !== "approved" && (
              <div>
                <Label>Note {actionDialog?.action === "rejected" ? "(reason)" : "(optional)"}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note for the client..." />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
            <Button
              variant={actionDialog?.action === "approved" ? "default" : actionDialog?.action === "hold" ? "secondary" : "destructive"}
              disabled={processMutation.isPending}
              onClick={() => actionDialog && processMutation.mutate({
                id: actionDialog.id, action: actionDialog.action,
                userId: actionDialog.userId, amount: actionDialog.amount,
              })}
            >
              {processMutation.isPending ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
