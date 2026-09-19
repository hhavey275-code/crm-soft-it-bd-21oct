import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ExternalLink, Copy, Check, AlertCircle, Zap } from "lucide-react";
import { logSystemAction } from "@/lib/systemLog";
import { startLimitWatch } from "@/hooks/useLimitUpdateWatch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: {
    id: string;
    account_id: string;
    account_name: string;
    external_topup_url?: string | null;
    external_topup_url_secondary?: string | null;
    external_crm_name?: string | null;
    spend_cap?: number | string | null;
    user_id?: string | null;
  };
  /** Which client wallet to deduct from. Defaults to the main wallet. */
  walletKind?: "primary" | "secondary";
}

/**
 * Initiate an external top-up: deducts the assigned client's wallet immediately,
 * logs the transaction, records the request as completed, then opens the 3rd party CRM.
 */
export function ExternalTopUpDialog({ open, onOpenChange, account, walletKind = "primary" }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);

  const isSecondary = walletKind === "secondary";
  const url = (isSecondary
    ? account.external_topup_url_secondary || account.external_topup_url
    : account.external_topup_url) || "";
  const walletLabel = isSecondary ? "Secondary wallet" : "Main wallet";
  const crmName = account.external_crm_name || "External CRM";
  const cleanAccountId = account.account_id.replace(/^act_/, "");

  const initiateMutation = useMutation({
    mutationFn: async (mode: "auto" | "manual") => {
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) throw new Error("Invalid amount");
      if (!url) throw new Error("External CRM URL not configured for this account");

      // Resolve target client: ALWAYS check user_ad_accounts mapping (source of truth)
      let targetUserId: string | null = null;
      const { data: link, error: linkErr } = await supabase
        .from("user_ad_accounts")
        .select("user_id")
        .eq("ad_account_id", account.id)
        .maybeSingle();
      if (linkErr) console.error("[ExternalTopUp] user_ad_accounts lookup failed:", linkErr);
      targetUserId = link?.user_id ?? account.user_id ?? null;
      console.log("[ExternalTopUp] resolved targetUserId:", targetUserId, "from link:", link, "account.user_id:", account.user_id);

      if (!targetUserId) {
        throw new Error("No client assigned to this ad account. Cannot deduct wallet.");
      }
      let newBalance: number | null = null;

      // Auto mode: leave the request pending so the CRM Helper (Auto-pilot)
      // picks it up and completes the top-up in the partner CRM by itself.
      // Manual mode: mark it done right away and open the CRM for the admin.
      const nowIso = new Date().toISOString();
      const { data, error } = await (supabase as any)
        .from("external_topup_requests")
        .insert({
          ad_account_id: account.id,
          user_id: targetUserId,
          amount: amt,
          status: mode === "auto" ? "pending" : "completed",
          initiated_by: user!.id,
          ...(mode === "auto" ? {} : { completed_by: user!.id, completed_at: nowIso }),
          wallet_deducted: !!targetUserId,
          notes: notes || null,
          external_crm_name: crmName,
          external_topup_url: url,
          wallet_kind: walletKind,
        })
        .select()
        .single();
      if (error) throw error;

      // Secondary wallet is funded from the main wallet at the rate difference.
      // Pull whatever is short first so the ledger reflects the conversion.
      if (walletKind === "secondary") {
        const { data: conv, error: convErr } = await (supabase as any).rpc("ensure_secondary_funds", {
          p_user_id: targetUserId,
          p_needed_usd: amt,
          p_processed_by: `admin:${user!.id}`,
          p_allow_negative: true,
          p_due_limit: 0,
        });
        if (convErr || (conv && conv.ok === false)) {
          await (supabase as any).from("external_topup_requests").delete().eq("id", data.id);
          throw new Error(convErr?.message || conv?.error || "Secondary wallet funding failed");
        }
      }

      // Deduct the wallet atomically: balance + ledger row in ONE transaction,
      // with the amount signed negative so history and balance always agree.
      {
        const { data: res, error: dErr } = await (supabase as any).rpc("adjust_wallet_atomic", {
          p_user_id: targetUserId,
          p_amount: -amt,
          p_type: "external_topup",
          p_description: `External CRM top-up — ${crmName} (${account.account_name}) [${walletLabel}]`,
          p_processed_by: `admin:${user!.id}`,
          p_wallet_kind: walletKind,
          p_reference_id: data.id,
          // Admin-initiated external CRM top-up: never blocked by balance.
          // Wallet is allowed to go negative (due) for both main and secondary.
          p_allow_negative: true,
        });
        if (dErr || (res && res.ok === false)) {
          await (supabase as any).from("external_topup_requests").delete().eq("id", data.id);
          throw new Error(dErr?.message || res?.error || "Wallet deduction failed");
        }
        newBalance = Number(res.balance_after);
      }


      // Copy account id + amount to clipboard
      try {
        await navigator.clipboard.writeText(`${cleanAccountId}\t${amt}`);
        setCopied(true);
      } catch {}

      // Manual mode only: open external CRM — anchor click preserves the Chrome
      // profile session cookies so the existing login carries over.
      if (mode === "manual") {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }

      await logSystemAction(
        "External Top-up Initiated",
        `Account ${account.account_name} (${cleanAccountId}) — $${amt} via ${crmName}${targetUserId ? " (wallet deducted)" : ""}${mode === "auto" ? " [auto-pilot]" : " [manual]"}`,
        user?.id,
        user?.email
      );
      return { row: data, mode };
    },
    onSuccess: (res: any) => {
      if (res?.mode === "auto") {
        toast.success("Wallet deducted. Helper is completing the top-up in the CRM…");
        // Blink "Updating your limit…" beside the account until Meta reports the new cap.
        startLimitWatch(account.id, Number(account.spend_cap ?? 0), () => {
          qc.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
          qc.invalidateQueries({ queryKey: ["client-detail-ad-accounts"] });
        });
      } else {
        toast.success("Wallet deducted & external CRM opened. Complete the top-up there.");
      }
      qc.invalidateQueries({ queryKey: ["external-topup-history", account.id] });
      qc.invalidateQueries({ queryKey: ["admin-wallets"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      setAmount("");
      setNotes("");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "Failed to initiate"),
  });

  const copyAccountId = async () => {
    try {
      await navigator.clipboard.writeText(cleanAccountId);
      setCopied(true);
      toast.success("Account ID copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[85vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <ExternalLink className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="truncate">External CRM Top-Up</span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
              <span className="min-w-0 break-words">
                Top up <strong className="text-foreground">{account.account_name}</strong> via
              </span>
              <Badge variant="outline" className="max-w-full truncate">{crmName}</Badge>
              <Badge variant={isSecondary ? "secondary" : "outline"} className="max-w-full truncate">{walletLabel}</Badge>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 min-w-0">
          {!url && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                {isSecondary
                  ? "No external CRM URL is configured for this account (secondary or main). Please set it in Account Settings first."
                  : "External CRM URL is not configured for this account. Please set it in Account Settings first."}
              </span>
            </div>
          )}

          <div className="rounded-md border p-3 bg-muted/30 space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground truncate">Account ID to paste</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 shrink-0" onClick={copyAccountId}>
                {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="font-mono text-sm font-semibold break-all">{cleanAccountId}</div>
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label>Amount (USD)</Label>
            <Input
              className="w-full"
              type="number"
              min="1"
              step="0.01"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <Label>Notes (optional)</Label>
            <Input
              className="w-full"
              placeholder="Reference, batch, comments..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs space-y-1 min-w-0">
            <p className="font-semibold text-amber-700 dark:text-amber-300">What happens next:</p>
            <ol className="list-decimal pl-4 text-amber-700 dark:text-amber-300/90 space-y-0.5 break-words">
              <li>Client's <strong>{walletLabel.toLowerCase()}</strong> will be <strong>deducted immediately</strong>.</li>
              <li>The CRM Helper (Auto-pilot) completes the top-up in the partner CRM automatically.</li>
              <li>A live "Updating your limit…" indicator shows beside the account until the new limit arrives.</li>
            </ol>
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => initiateMutation.mutate("manual")}
            disabled={!amount || !url || initiateMutation.isPending}
          >
            <ExternalLink className="h-4 w-4 mr-1 shrink-0" />
            <span className="truncate">Deduct &amp; Open CRM</span>
          </Button>
          <Button
            className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => initiateMutation.mutate("auto")}
            disabled={!amount || !url || initiateMutation.isPending}
          >
            <Zap className="h-4 w-4 mr-1 shrink-0" />
            <span className="truncate">{initiateMutation.isPending ? "Processing..." : "Deduct & Auto Top-Up"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
