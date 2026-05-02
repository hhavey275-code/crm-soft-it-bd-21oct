import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";
import { ArrowRightCircle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ArchiveTxn } from "@/lib/oldSellerData";

type Props = {
  sellerId: string;
  sellerName: string;
  /** Forwarded sheet rows from the archive (bdt_payment / client_topup / tenant_payment that should move). */
  forwardedRows: ArchiveTxn[];
  /** All withdraws from the archive (always migrated alongside). */
  withdrawRows: ArchiveTxn[];
  /** All usdt_received (USDT given) rows from the archive — needed for Due/Adv math. */
  usdtGivenRows?: ArchiveTxn[];
};

/**
 * Detect which archive rows are already mirrored into the live `seller_transactions`
 * table (matched by primary key id — we preserve the original UUID on insert).
 */
function useAlreadyMigrated(sellerId: string, candidateIds: string[]) {
  return useQuery({
    queryKey: ["forwarded-migration-status", sellerId, candidateIds.length],
    queryFn: async () => {
      if (candidateIds.length === 0) return new Set<string>();
      const { data, error } = await (supabase as any)
        .from("seller_transactions")
        .select("id")
        .in("id", candidateIds);
      if (error) throw error;
      return new Set<string>((data || []).map((r: any) => r.id));
    },
    enabled: !!sellerId && candidateIds.length > 0,
  });
}

export function MigrateForwardedButton({ sellerId, sellerName, forwardedRows, withdrawRows, usdtGivenRows = [] }: Props) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  // All rows we plan to move into the live ledger.
  const candidates = useMemo(() => {
    const all = [...forwardedRows, ...withdrawRows, ...usdtGivenRows];
    // Dedupe by id (a withdraw could in theory also appear via merge — defensive).
    const seen = new Set<string>();
    return all.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }, [forwardedRows, withdrawRows, usdtGivenRows]);

  const candidateIds = useMemo(() => candidates.map((r) => r.id), [candidates]);
  const { data: alreadyMigratedSet } = useAlreadyMigrated(sellerId, candidateIds);
  const migratedCount = alreadyMigratedSet?.size || 0;
  const pendingCount = candidates.length - migratedCount;
  const fullyMigrated = candidates.length > 0 && pendingCount === 0;

  async function runMigration() {
    setRunning(true);
    try {
      const skipIds = alreadyMigratedSet || new Set<string>();
      const toInsert = candidates.filter((r) => !skipIds.has(r.id));
      if (toInsert.length === 0) {
        toast.info("Already migrated — nothing to do.");
        setRunning(false);
        return;
      }

      // Map archive rows → live ledger rows.
      // Manual entries (bdt_payment / tenant_payment) get rewritten to client_topup
      // so the seller dashboard treats them uniformly.
      const payload = toInsert.map((r) => {
        const isWithdraw = r.type === "withdraw";
        const isUsdtGiven = r.type === "usdt_received";
        const isManualIn = r.type === "bdt_payment" || r.type === "tenant_payment";
        const newType = isWithdraw
          ? "withdraw"
          : isUsdtGiven
          ? "usdt_received"
          : "client_topup";
        return {
          id: r.id,
          seller_id: r.seller_id,
          type: newType,
          bdt_amount: r.bdt_amount,
          usdt_amount: r.usdt_amount || 0,
          rate: r.rate || 0,
          description: r.description,
          bank_account_id: r.bank_account_id,
          // Only client_topup rows that came from a real top_up_request retain it.
          // Manuals had no top_up_request_id; keep that null so the unique index
          // (one active topup per request) doesn't fight us.
          top_up_request_id: isManualIn || isUsdtGiven ? null : r.top_up_request_id,
          proof_url: r.proof_url,
          created_at: r.created_at,
          status: "approved",
          entry_by_name: r.entry_by_name,
          reviewed_by: r.reviewed_by,
          reviewed_at: r.reviewed_at,
          // Mark as forwarded — these all came from the Forwarded sheet.
          telegram_forwarded: !isWithdraw,
        } as any;
      });

      // Insert in chunks; ignore duplicate-key errors (idempotent re-run).
      const CHUNK = 50;
      let inserted = 0;
      let skipped = 0;
      let firstError: string | null = null;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const slice = payload.slice(i, i + CHUNK);
        const { data: ins, error } = await (supabase as any)
          .from("seller_transactions")
          .insert(slice)
          .select("id");
        if (error) {
          // Fall back to per-row insert so a single duplicate doesn't fail the chunk.
          for (const row of slice) {
            const { error: rowErr } = await (supabase as any)
              .from("seller_transactions")
              .insert(row);
            if (rowErr) {
              const msg = (rowErr.message || "").toLowerCase();
              if (msg.includes("duplicate") || msg.includes("unique")) {
                skipped++;
              } else if (!firstError) {
                firstError = rowErr.message;
              }
            } else {
              inserted++;
            }
          }
        } else {
          inserted += ins?.length || slice.length;
        }
      }

      if (firstError) {
        toast.error(`Migrated ${inserted}, skipped ${skipped}. First error: ${firstError}`);
      } else {
        toast.success(
          `✅ Migrated ${inserted} rows to live ledger${skipped ? ` (${skipped} already there)` : ""}.`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["forwarded-migration-status", sellerId] });
      queryClient.invalidateQueries({ queryKey: ["seller-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["old-seller-bundle", sellerId] });
    } catch (e: any) {
      toast.error(`Migration failed: ${e.message || e}`);
    } finally {
      setRunning(false);
      setConfirmOpen(false);
    }
  }

  if (candidates.length === 0) return null;

  return (
    <>
      <div
        className={`rounded border p-3 flex items-center justify-between gap-3 ${
          fullyMigrated
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-blue-500/40 bg-gradient-to-r from-blue-500/5 to-emerald-500/5"
        }`}
      >
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {fullyMigrated ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Forwarded sheet → Live ledger: <span className="text-emerald-600 dark:text-emerald-400">migrated</span>
              </>
            ) : (
              <>
                <ArrowRightCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Move Forwarded sheet into live seller ledger
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {candidates.length} eligible rows ({forwardedRows.length} payments IN +{" "}
            {withdrawRows.length} withdraws) for <b>{sellerName}</b>.{" "}
            {migratedCount > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {migratedCount} already in live ledger.
              </span>
            )}{" "}
            {pendingCount > 0 && <span>{pendingCount} pending.</span>}
            <br />
            Manual entries become <b>client_topup</b> · withdraws stay as withdraw · IDs preserved (idempotent).
          </p>
        </div>
        <Button
          size="sm"
          variant={fullyMigrated ? "outline" : "default"}
          disabled={running || pendingCount === 0}
          onClick={() => setConfirmOpen(true)}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : fullyMigrated ? "Re-check" : `Migrate ${pendingCount}`}
        </Button>
      </div>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={(o) => !running && setConfirmOpen(o)}
        title={`Migrate ${pendingCount} rows to live ledger?`}
        description={
          <span>
            This will insert <b>{pendingCount}</b> rows from the Forwarded archive into{" "}
            <b>seller_transactions</b> for {sellerName}. Manual BDT/tenant payments
            are rewritten to <b>client_topup</b>. Withdraws stay as <b>withdraw</b>.
            Original IDs are preserved so re-running is safe (duplicates skipped).
            Type <b>migrate</b> to confirm.
          </span>
        }
        confirmWord="migrate"
        actionLabel="Migrate"
        onConfirm={runMigration}
      />
    </>
  );
}
