import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Row = {
  id: string;
  user_id: string;
  amount: number;
  created_at: string;
  full_name?: string | null;
  email?: string | null;
};

/**
 * Safety net: lists top-up requests that are "approved" but never produced a
 * wallet credit transaction (e.g. admin tab closed mid-approval).
 * Repair is manual — one click per request, idempotent on the DB side.
 */
export function MissingCreditsCard() {
  const queryClient = useQueryClient();
  const [fixing, setFixing] = useState<string | null>(null);

  const { data: rows = [], isFetching, refetch } = useQuery({
    // Version the key when detection rules change so HMR/browser caches cannot
    // keep showing rows that the latest safety filters now exclude.
    queryKey: ["missing-topup-credits", "active-clients-v2"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      // Ignore very recent approvals: the credit row may not be visible yet,
      // which would otherwise raise a false "approved but not credited" alert.
      const until = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: reqs } = await supabase
        .from("top_up_requests")
        .select(
          "id, user_id, amount, created_at, sheet_bill_bdt, wallet_due_paid_bdt, main_deposit_bdt, secondary_due_bdt",
        )
        .eq("status", "approved")
        .gte("created_at", since)
        .lte("created_at", until)
        .order("created_at", { ascending: false })
        .limit(300);


      const candidates = (reqs ?? []).filter(
        (r: any) =>
          Number(r.sheet_bill_bdt || 0) === 0 &&
          Number(r.wallet_due_paid_bdt || 0) === 0 &&
          Number(r.main_deposit_bdt || 0) === 0 &&
          Number(r.secondary_due_bdt || 0) === 0,
      );
      if (candidates.length === 0) return [];

      const ids = candidates.map((r: any) => r.id);
      const { data: txns } = await supabase
        .from("transactions")
        .select("reference_id")
        .in("reference_id", ids);
      const credited = new Set((txns ?? []).map((t: any) => t.reference_id));

      const missing = candidates.filter((r: any) => !credited.has(r.id));
      if (missing.length === 0) return [];

      const missingUserIds = Array.from(new Set(missing.map((r: any) => r.user_id)));
      const [{ data: profiles }, { data: wallets }] = await Promise.all([
        supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", missingUserIds),
        supabase
          .from("wallets")
          .select("user_id")
          .in("user_id", missingUserIds),
      ]);
      const pmap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      const activeWalletUsers = new Set((wallets ?? []).map((wallet: any) => wallet.user_id));

      // Imported/deleted users can leave historical approved requests behind
      // without their old transaction ledger. They are not safe to repair and
      // must not be presented as current missing credits.
      return missing.flatMap((r: any) => {
        const profile = pmap.get(r.user_id);
        if (!profile || !activeWalletUsers.has(r.user_id)) return [];
        return [{
          id: r.id,
          user_id: r.user_id,
          amount: Number(r.amount || 0),
          created_at: r.created_at,
          full_name: profile.full_name,
          email: profile.email,
        }];
      });
    },
  });

  const fix = async (row: Row) => {
    setFixing(row.id);
    try {
      const { data, error } = await supabase.rpc("credit_missing_approved_topup", {
        p_request_id: row.id,
        p_processed_by: "admin:manual-repair",
      });
      if (error) throw error;
      if ((data as any)?.success === false) throw new Error((data as any)?.error || "Repair failed");
      toast.success(`Credited $${row.amount} to ${row.full_name || row.email || "client"}`);
      queryClient.invalidateQueries({ queryKey: ["admin-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["admin-topup-requests"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Could not credit wallet");
    } finally {
      setFixing(null);
    }
  };

  if (rows.length === 0) return null;

  return (
    <Card className="border-destructive/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Missing Wallet Credits ({rows.length})
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            Recheck
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          These top-ups are approved but no wallet credit was recorded. Click “Credit now” to fix.
        </p>
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{r.full_name || r.email || r.user_id}</p>
              <p className="text-xs text-muted-foreground">
                ${r.amount} · {new Date(r.created_at).toLocaleString()}
              </p>
            </div>
            <Button size="sm" onClick={() => fix(r)} disabled={fixing === r.id}>
              {fixing === r.id ? "Crediting..." : "Credit now"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default MissingCreditsCard;
