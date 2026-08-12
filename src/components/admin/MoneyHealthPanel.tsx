import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

type DriftRow = {
  user_id: string;
  name: string | null;
  wallet_kind: string;
  balance: number;
  ledger_total: number;
  allowance: number;
  drift: number;
};

type UncreditedRow = {
  request_id: string;
  user_id: string;
  name: string | null;
  amount: number;
  created_at: string;
};

type DupeRow = {
  reference_id: string;
  user_id: string;
  credits: number;
  total_amount: number;
};

type FailedRow = {
  failed_topup_id: string;
  user_id: string;
  name: string | null;
  amount: number;
  ad_account: string | null;
  account_id: string | null;
  current_spend_cap: number | null;
  created_at: string;
};

type Report = {
  generated_at: string;
  wallet_drift: DriftRow[];
  approved_not_credited: UncreditedRow[];
  duplicate_credits: DupeRow[];
  pending_failed_topups: FailedRow[];
};

function SectionCard({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
}) {
  const clean = count === 0;
  return (
    <Card className="border border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              {clean ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              {title}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </div>
          <Badge variant={clean ? "secondary" : "destructive"}>{count}</Badge>
        </div>
      </CardHeader>
      {!clean && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export function MoneyHealthPanel() {
  const queryClient = useQueryClient();
  const [repairTarget, setRepairTarget] = useState<DriftRow | null>(null);
  const [reason, setReason] = useState("");

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: ["money-health-report"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("money_health_report");
      if (error) throw error;
      return data as Report;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const repairMutation = useMutation({
    mutationFn: async () => {
      if (!repairTarget) return;
      if (!reason.trim()) throw new Error("Reason is required");
      const { error } = await (supabase as any).rpc("repair_wallet_balance", {
        p_user_id: repairTarget.user_id,
        p_wallet_kind: repairTarget.wallet_kind,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Wallet balance snapped back to its transaction history");
      setRepairTarget(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["money-health-report"] });
      queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Repair failed"),
  });

  const issues =
    (data?.wallet_drift?.length ?? 0) +
    (data?.approved_not_credited?.length ?? 0) +
    (data?.duplicate_credits?.length ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold">Money Health</p>
            <p className="text-xs text-muted-foreground">
              Wallet balances are locked to their transaction history at the database level. This
              report shows anything that still needs a human look.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            {(error as any).message ?? "Failed to load report"}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card
            className={
              issues === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"
            }
          >
            <CardContent className="p-4 flex items-center gap-3">
              {issues === 0 ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              )}
              <p className="text-sm font-medium">
                {issues === 0
                  ? "All wallet balances match their transaction history. No uncredited or double-credited payments."
                  : `${issues} money issue${issues === 1 ? "" : "s"} need attention.`}
              </p>
            </CardContent>
          </Card>

          <SectionCard
            title="Wallet balance vs transaction history"
            description="A balance that does not equal the sum of its own transactions. New mismatches are blocked automatically — anything listed here is legacy and can be repaired."
            count={data.wallet_drift?.length ?? 0}
          >
            <div className="space-y-2">
              {data.wallet_drift?.map((row) => (
                <div
                  key={`${row.user_id}-${row.wallet_kind}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.name ?? row.user_id}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.wallet_kind} · balance ${Number(row.balance).toFixed(2)} · history $
                      {Number(row.ledger_total).toFixed(2)} · off by ${Number(row.drift).toFixed(2)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRepairTarget(row);
                      setReason("");
                    }}
                  >
                    <Wrench className="h-3.5 w-3.5 mr-1" />
                    Repair
                  </Button>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Approved payments never credited"
            description="Top-up requests marked approved where no wallet credit or due adjustment exists."
            count={data.approved_not_credited?.length ?? 0}
          >
            <div className="space-y-2">
              {data.approved_not_credited?.map((row) => (
                <div key={row.request_id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">{row.name ?? row.user_id}</p>
                  <p className="text-xs text-muted-foreground">
                    ${Number(row.amount).toFixed(2)} · {new Date(row.created_at).toLocaleString()} ·
                    request {row.request_id.slice(0, 8)}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Duplicate credits"
            description="A single payment credited more than once."
            count={data.duplicate_credits?.length ?? 0}
          >
            <div className="space-y-2">
              {data.duplicate_credits?.map((row) => (
                <div key={row.reference_id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">Reference {row.reference_id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.credits} credits · total ${Number(row.total_amount).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Pending failed top-ups (verify on Meta)"
            description="Still-open failed top-ups. Check the live spend cap before refunding — if Meta already applied it, resolve instead of refunding."
            count={data.pending_failed_topups?.length ?? 0}
          >
            <div className="space-y-2">
              {data.pending_failed_topups?.map((row) => (
                <div key={row.failed_topup_id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium">
                    {row.name ?? row.user_id} — ${Number(row.amount).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.ad_account ?? "—"} ({row.account_id ?? "—"}) · current cap{" "}
                    {row.current_spend_cap != null ? `$${Number(row.current_spend_cap).toFixed(2)}` : "unknown"} ·{" "}
                    {new Date(row.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        </>
      )}

      <Dialog open={!!repairTarget} onOpenChange={(open) => !open && setRepairTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Repair wallet balance</DialogTitle>
            <DialogDescription>
              Sets the {repairTarget?.wallet_kind} wallet of{" "}
              <strong>{repairTarget?.name ?? repairTarget?.user_id}</strong> to $
              {Number(repairTarget?.ledger_total ?? 0).toFixed(2)}, exactly matching its transaction
              history. This is logged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this repair correct?"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepairTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => repairMutation.mutate()}
              disabled={repairMutation.isPending || !reason.trim()}
            >
              {repairMutation.isPending ? "Repairing..." : "Repair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
