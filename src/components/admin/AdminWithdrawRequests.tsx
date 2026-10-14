import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, Loader2, ExternalLink } from "lucide-react";
import { logSystemAction } from "@/lib/systemLog";
import { useIsMobile } from "@/hooks/use-mobile";

type Row = any;

export function AdminWithdrawRequests() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [showResolved, setShowResolved] = useState(false);
  const [active, setActive] = useState<{ row: Row; decision: "approved" | "rejected" } | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: rows = [] } = useQuery({
    queryKey: ["admin-withdraw-requests", showResolved],
    queryFn: async () => {
      let q = (supabase as any)
        .from("spend_cap_withdraw_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (!showResolved) q = q.eq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 20000,
  });

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: profiles = [] } = useQuery({
    queryKey: ["withdraw-req-profiles", userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds as string[]);
      return data ?? [];
    },
  });
  const getProfile = (id: string) => profiles.find((p: any) => p.user_id === id);

  const accountIds = [...new Set(rows.map((r) => r.ad_account_id).filter(Boolean))];
  const { data: accounts = [] } = useQuery({
    queryKey: ["withdraw-req-accounts", accountIds.join(",")],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_accounts")
        .select("id, account_name, account_id")
        .in("id", accountIds as string[]);
      return data ?? [];
    },
  });
  const getAccount = (id: string) => (accounts as any[]).find((a) => a.id === id);

  const billingUrl = (accountId?: string) => {
    const num = String(accountId ?? "").replace(/^act_/, "");
    return num ? `https://business.facebook.com/billing_hub/accounts/details?asset_id=${num}` : null;
  };

  const BillingLink = ({ accountId }: { accountId?: string }) => {
    const url = billingUrl(accountId);
    if (!url) return null;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
      >
        <ExternalLink className="h-3 w-3" /> Billing
      </a>
    );
  };

  const resolve = async () => {
    if (!active) return;
    const { row, decision } = active;
    setBusy(true);
    let capBefore: number | null = null;
    let capAfter: number | null = null;
    try {
      if (decision === "approved") {
        // Actually perform the withdraw on Meta + credit the client's wallet.
        const { data, error } = await supabase.functions.invoke("spend-cap-withdraw", {
          body: { ad_account_id: row.ad_account_id, amount: Number(row.amount_usd) },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        if ((data as any)?.wallet_credited === false) {
          throw new Error((data as any)?.wallet_credit_error || "Spend cap lowered but wallet credit failed");
        }
        capBefore = (data as any)?.old_spend_cap != null ? Number((data as any).old_spend_cap) : null;
        capAfter = (data as any)?.new_spend_cap != null ? Number((data as any).new_spend_cap) : null;
      }

      const { error: updErr } = await (supabase as any)
        .from("spend_cap_withdraw_requests")
        .update({
          status: decision,
          admin_note: adminNote || null,
          reviewed_by: user!.id,
          spend_cap_before: capBefore,
          spend_cap_after: capAfter,
          resolved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updErr) throw updErr;

      await (supabase as any).from("notifications").insert({
        user_id: row.user_id,
        type: "spend_cap_withdraw_request",
        title: decision === "approved" ? "Withdraw Request Approved" : "Withdraw Request Rejected",
        message:
          decision === "approved"
            ? `$${Number(row.amount_usd).toFixed(2)} has been moved back to your wallet from ${getAccount(row.ad_account_id)?.account_name ?? "your ad account"}.${
                capBefore != null && capAfter != null
                  ? ` Limit: $${capBefore.toLocaleString()} → $${capAfter.toLocaleString()}.`
                  : ""
              }`
            : `Your $${Number(row.amount_usd).toFixed(2)} withdraw request was rejected.${adminNote ? ` Note: ${adminNote}` : ""}`,
        reference_id: row.id,
      });

      await logSystemAction(
        decision === "approved" ? "Withdraw Request Approved" : "Withdraw Request Rejected",
        `$${Number(row.amount_usd).toFixed(2)} — ${getAccount(row.ad_account_id)?.account_name ?? row.ad_account_id}`,
        user!.id,
        user!.email
      );

      toast.success(
        decision === "approved"
          ? capBefore != null && capAfter != null
            ? `Approved — limit $${capBefore.toLocaleString()} → $${capAfter.toLocaleString()}, wallet credited`
            : "Withdraw approved and wallet credited"
          : "Request rejected",
      );
      setActive(null);
      setAdminNote("");
      qc.invalidateQueries({ queryKey: ["admin-withdraw-requests"] });
      qc.invalidateQueries({ queryKey: ["dual-wallets"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to process request");
    } finally {
      setBusy(false);
    }
  };

  const Actions = ({ r }: { r: Row }) =>
    r.status === "pending" ? (
      <div className="flex items-center gap-1">
        <Button size="sm" className="gap-1" onClick={() => { setActive({ row: r, decision: "approved" }); setAdminNote(""); }}>
          <Check className="h-3 w-3" /> Approve
        </Button>
        <Button size="sm" variant="destructive" className="gap-1" onClick={() => { setActive({ row: r, decision: "rejected" }); setAdminNote(""); }}>
          <X className="h-3 w-3" /> Reject
        </Button>
      </div>
    ) : (
      <span className="text-xs text-muted-foreground">{r.resolved_at ? format(new Date(r.resolved_at), "MMM d, yyyy") : "—"}</span>
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2">
        <Label className="text-xs text-muted-foreground">Show resolved</Label>
        <Switch checked={showResolved} onCheckedChange={setShowResolved} />
      </div>

      {isMobile ? (
        <div className="space-y-3">
          {rows.length === 0 ? (
            <Card><CardContent className="text-center text-muted-foreground py-8 text-sm">No withdraw requests</CardContent></Card>
          ) : rows.map((r) => {
            const p = getProfile(r.user_id);
            return (
              <Card key={r.id}>
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
                      <p className="font-medium truncate">{getAccount(r.ad_account_id)?.account_name || "—"}</p>
                      {getAccount(r.ad_account_id)?.account_id && (
                        <p className="font-mono text-[11px] text-muted-foreground">{String(getAccount(r.ad_account_id)?.account_id).replace(/^act_/, "")}</p>
                      )}
                      <BillingLink accountId={getAccount(r.ad_account_id)?.account_id} />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Amount</p>
                      <p className="font-semibold">${Number(r.amount_usd).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Date</p>
                      <p>{format(new Date(r.created_at), "MMM d")}</p>
                    </div>
                    {r.spend_cap_before != null && r.spend_cap_after != null && (
                      <div className="col-span-2">
                        <p className="text-[10px] uppercase text-muted-foreground">Limit Change</p>
                        <p className="font-medium">
                          ${Number(r.spend_cap_before).toLocaleString()} → ${Number(r.spend_cap_after).toLocaleString()}
                        </p>
                      </div>
                    )}
                    {r.note && (
                      <div className="col-span-2">
                        <p className="text-[10px] uppercase text-muted-foreground">Note</p>
                        <p className="break-words">{r.note}</p>
                      </div>
                    )}
                  </div>
                  <Actions r={r} />
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
                  <TableHead>Amount</TableHead>
                  <TableHead>Limit Change</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No withdraw requests</TableCell></TableRow>
                ) : rows.map((r) => {
                  const p = getProfile(r.user_id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{p?.full_name || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{p?.email || "—"}</p>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{getAccount(r.ad_account_id)?.account_name || "—"}</div>
                        {getAccount(r.ad_account_id)?.account_id && (
                          <div className="text-xs text-muted-foreground font-mono">{String(getAccount(r.ad_account_id)?.account_id).replace(/^act_/, "")}</div>
                        )}
                        <BillingLink accountId={getAccount(r.ad_account_id)?.account_id} />
                      </TableCell>
                      <TableCell className="font-semibold">${Number(r.amount_usd).toFixed(2)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.spend_cap_before != null && r.spend_cap_after != null ? (
                          <span className="font-medium">
                            ${Number(r.spend_cap_before).toLocaleString()} <span className="text-muted-foreground">→</span> ${Number(r.spend_cap_after).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{r.note || "—"}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
                      <TableCell><Actions r={r} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!active} onOpenChange={(o) => { if (!o && !busy) { setActive(null); setAdminNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{active?.decision === "approved" ? "Approve Withdraw" : "Reject Withdraw"}</DialogTitle>
            <DialogDescription>
              {active?.decision === "approved"
                ? `Spend cap will be lowered on Meta by $${Number(active?.row.amount_usd ?? 0).toFixed(2)} and the amount credited back to the client's main wallet.`
                : "The client will be notified that the request was rejected."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Admin note (optional)</Label>
            <Textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Reason / instructions..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)} disabled={busy}>Cancel</Button>
            <Button
              variant={active?.decision === "approved" ? "default" : "destructive"}
              onClick={resolve}
              disabled={busy}
            >
              {busy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…</> : active?.decision === "approved" ? "Approve & Credit" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
