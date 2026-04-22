import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Network, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

type ReqRow = any;

export function TenantRequestsPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [activeReq, setActiveReq] = useState<{ kind: "bm" | "wd"; row: ReqRow; decision: "approved" | "rejected" } | null>(null);
  const [adminNote, setAdminNote] = useState("");

  const { data: bmReqs = [] } = useQuery({
    queryKey: ["tenant-bm-share-requests", showResolved],
    queryFn: async () => {
      let q = (supabase as any)
        .from("tenant_bm_share_requests")
        .select("*, tenants(name)")
        .order("created_at", { ascending: false });
      if (!showResolved) q = q.eq("status", "pending");
      const { data } = await q;
      return (data ?? []) as ReqRow[];
    },
    refetchInterval: 15000,
  });

  const { data: wdReqs = [] } = useQuery({
    queryKey: ["tenant-withdraw-requests", showResolved],
    queryFn: async () => {
      let q = (supabase as any)
        .from("tenant_withdraw_requests")
        .select("*, tenants(name)")
        .order("created_at", { ascending: false });
      if (!showResolved) q = q.eq("status", "pending");
      const { data } = await q;
      return (data ?? []) as ReqRow[];
    },
    refetchInterval: 15000,
  });

  const pendingBm = bmReqs.filter((r) => r.status === "pending").length;
  const pendingWd = wdReqs.filter((r) => r.status === "pending").length;

  const resolveMutation = useMutation({
    mutationFn: async ({ kind, row, decision, note }: { kind: "bm" | "wd"; row: ReqRow; decision: "approved" | "rejected"; note: string }) => {
      const table = kind === "bm" ? "tenant_bm_share_requests" : "tenant_withdraw_requests";
      const { error } = await (supabase as any)
        .from(table)
        .update({
          status: decision,
          admin_notes: note || null,
          resolved_by: user?.id ?? null,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request updated");
      setActiveReq(null);
      setAdminNote("");
      qc.invalidateQueries({ queryKey: ["tenant-bm-share-requests"] });
      qc.invalidateQueries({ queryKey: ["tenant-withdraw-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <>
      <Card className="border-purple-500/30 bg-purple-500/5">
        <CardHeader
          className="cursor-pointer p-4"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Network className="h-4 w-4 text-purple-500" />
              Tenant Requests
              {(pendingBm + pendingWd) > 0 && (
                <Badge variant="destructive" className="ml-1">{pendingBm + pendingWd} pending</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Label className="text-xs text-muted-foreground">Show resolved</Label>
              <Switch checked={showResolved} onCheckedChange={setShowResolved} />
            </div>
          </div>
        </CardHeader>

        {expanded && (
          <CardContent className="p-4 pt-0">
            <Tabs defaultValue="bm">
              <TabsList>
                <TabsTrigger value="bm" className="gap-2">
                  BM Share
                  {pendingBm > 0 && <Badge variant="secondary" className="h-5 px-1.5">{pendingBm}</Badge>}
                </TabsTrigger>
                <TabsTrigger value="wd" className="gap-2">
                  Spend Cap Withdraw
                  {pendingWd > 0 && <Badge variant="secondary" className="h-5 px-1.5">{pendingWd}</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="bm" className="mt-3">
                <RequestTable
                  rows={bmReqs}
                  emptyMsg="No BM share requests"
                  columns={["Tenant", "User", "Ad Account", "BM", "Note", "Status", "Created"]}
                  renderRow={(r) => [
                    r.tenants?.name ?? "—",
                    r.tenant_user_name ?? r.tenant_user_id,
                    `${r.ad_account_name ?? "—"} (${r.ad_account_external_id})`,
                    `${r.bm_name ?? "—"} (${r.bm_id})`,
                    r.note ?? "—",
                    <StatusPill status={r.status} key="s" />,
                    formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
                  ]}
                  onApprove={(r) => { setActiveReq({ kind: "bm", row: r, decision: "approved" }); setAdminNote(""); }}
                  onReject={(r) => { setActiveReq({ kind: "bm", row: r, decision: "rejected" }); setAdminNote(""); }}
                />
              </TabsContent>

              <TabsContent value="wd" className="mt-3">
                <RequestTable
                  rows={wdReqs}
                  emptyMsg="No withdraw requests"
                  columns={["Tenant", "User", "Ad Account", "Amount (USD)", "Note", "Status", "Created"]}
                  renderRow={(r) => [
                    r.tenants?.name ?? "—",
                    r.tenant_user_name ?? r.tenant_user_id,
                    `${r.ad_account_name ?? "—"} (${r.ad_account_external_id})`,
                    `$${Number(r.amount_usd).toFixed(2)}`,
                    r.note ?? "—",
                    <StatusPill status={r.status} key="s" />,
                    formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
                  ]}
                  onApprove={(r) => { setActiveReq({ kind: "wd", row: r, decision: "approved" }); setAdminNote(""); }}
                  onReject={(r) => { setActiveReq({ kind: "wd", row: r, decision: "rejected" }); setAdminNote(""); }}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        )}
      </Card>

      <Dialog open={!!activeReq} onOpenChange={(o) => !o && setActiveReq(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {activeReq?.decision === "approved" ? "Approve" : "Reject"}{" "}
              {activeReq?.kind === "bm" ? "BM Share" : "Withdraw"} Request
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              From <strong>{activeReq?.row.tenant_user_name ?? activeReq?.row.tenant_user_id}</strong>
              {" · "}Tenant: <strong>{activeReq?.row.tenants?.name}</strong>
            </p>
            <div className="space-y-2">
              <Label>Admin note (optional)</Label>
              <Textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Reason / instructions..." />
            </div>
            <p className="text-xs text-muted-foreground">
              Note: This only records the decision. The actual {activeReq?.kind === "bm" ? "BM access" : "spend cap reduction"} must be performed manually if approving.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveReq(null)}>Cancel</Button>
            <Button
              variant={activeReq?.decision === "approved" ? "default" : "destructive"}
              onClick={() => activeReq && resolveMutation.mutate({ kind: activeReq.kind, row: activeReq.row, decision: activeReq.decision, note: adminNote })}
              disabled={resolveMutation.isPending}
            >
              {resolveMutation.isPending ? "Saving..." : (activeReq?.decision === "approved" ? "Approve" : "Reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    approved: "bg-green-500/15 text-green-600 border-green-500/30",
    rejected: "bg-red-500/15 text-red-600 border-red-500/30",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", map[status] ?? "")}>
      {status}
    </span>
  );
}

function RequestTable({
  rows, columns, renderRow, emptyMsg, onApprove, onReject,
}: {
  rows: ReqRow[];
  columns: string[];
  renderRow: (r: ReqRow) => React.ReactNode[];
  emptyMsg: string;
  onApprove: (r: ReqRow) => void;
  onReject: (r: ReqRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">{emptyMsg}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => <TableHead key={c} className="text-xs">{c}</TableHead>)}
            <TableHead className="text-xs text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              {renderRow(r).map((cell, i) => (
                <TableCell key={i} className="text-xs">{cell as any}</TableCell>
              ))}
              <TableCell className="text-right">
                {r.status === "pending" ? (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onApprove(r)}>
                      <Check className="h-3 w-3 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-destructive" onClick={() => onReject(r)}>
                      <X className="h-3 w-3 mr-1" /> Reject
                    </Button>
                  </div>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    {r.resolved_at ? formatDistanceToNow(new Date(r.resolved_at), { addSuffix: true }) : ""}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}