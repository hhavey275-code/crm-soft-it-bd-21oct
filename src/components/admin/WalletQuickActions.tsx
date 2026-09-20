import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
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
import { Plus, Minus, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { useWallets, formatBdt } from "@/hooks/useWallets";

export type WalletKind = "primary" | "secondary" | "credit_line";

const LABEL: Record<WalletKind, string> = {
  primary: "Main Wallet",
  secondary: "Secondary Wallet",
  credit_line: "Credit Line Wallet",
};

/**
 * Compact +/- (and Main → wallet convert) actions for each wallet card.
 * With `inline` (mobile) the buttons render as translucent icon controls
 * inside the card itself — matching the desktop card look.
 */
export function WalletQuickActions({
  userId,
  kind,
  inline = false,
}: {
  userId: string;
  kind: WalletKind;
  inline?: boolean;
}) {
  const { user: currentUser } = useAuth();
  const wallets = useWallets(userId);
  const queryClient = useQueryClient();
  const [adjustType, setAdjustType] = useState<"credit" | "debit" | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertAmount, setConvertAmount] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-wallet", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-transactions", userId] });
  };

  const adjustMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      const signed = adjustType === "credit" ? amt : -amt;
      const reason =
        note.trim() ||
        `Admin ${adjustType === "credit" ? "added" : "deducted"} ${LABEL[kind].toLowerCase()} balance`;
      if (kind === "primary") {
        const { data, error } = await (supabase as any).rpc("adjust_wallet_atomic", {
          p_user_id: userId,
          p_amount: signed,
          p_type: adjustType === "credit" ? "admin_credit" : "admin_debit",
          p_description: reason,
          p_processed_by: `admin:${currentUser?.id ?? ""}`,
          p_wallet_kind: "primary",
        });
        if (error) throw error;
        if (data && data.ok === false) throw new Error(data.error || "Adjustment failed");
        return data;
      }
      const rpc =
        kind === "secondary" ? "admin_adjust_secondary_wallet" : "admin_adjust_credit_line_wallet";
      const { data, error } = await (supabase as any).rpc(rpc, {
        p_user_id: userId,
        p_amount: signed,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(adjustType === "credit" ? "Balance added!" : "Balance deducted!");
      setAdjustType(null);
      setAmount("");
      setNote("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Adjustment failed"),
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(convertAmount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      const rpc =
        kind === "secondary" ? "admin_convert_main_to_secondary" : "admin_convert_main_to_credit_line";
      const { data, error } = await (supabase as any).rpc(rpc, {
        p_user_id: userId,
        p_usd_amount: amt,
        p_reason: null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(`Main wallet balance moved to ${LABEL[kind]}`);
      setConvertOpen(false);
      setConvertAmount("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Conversion failed"),
  });

  const targetRate = kind === "secondary" ? wallets.secondaryRate : wallets.creditLineRate;
  const convertUsd = parseFloat(convertAmount) > 0 ? parseFloat(convertAmount) : 0;
  const convertedCredit =
    convertUsd > 0 && targetRate > 0 ? (convertUsd * wallets.mainRate) / targetRate : 0;

  if (inline) {
    // Translucent icon buttons rendered inside the colored card — same look as desktop.
    const iconBtn =
      "h-6 w-6 rounded-md flex items-center justify-center bg-white/20 text-white hover:bg-white/35 transition-colors";
    return (
      <>
        <div className="flex items-center gap-1">
          <button
            aria-label={`Add to ${LABEL[kind]}`}
            className={iconBtn}
            onClick={() => { setAdjustType("credit"); setAmount(""); setNote(""); }}
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            aria-label={`Deduct from ${LABEL[kind]}`}
            className={iconBtn}
            onClick={() => { setAdjustType("debit"); setAmount(""); setNote(""); }}
          >
            <Minus className="h-3 w-3" />
          </button>
          {kind !== "primary" && (
            <button
              aria-label={`Convert to ${LABEL[kind]}`}
              className={iconBtn}
              onClick={() => { setConvertOpen(true); setConvertAmount(""); }}
            >
              <ArrowRightLeft className="h-3 w-3" />
            </button>
          )}
        </div>

        <Dialog open={!!adjustType} onOpenChange={(o) => { if (!o) setAdjustType(null); }}>
          <DialogContent className="max-w-[95vw] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>
                {adjustType === "credit" ? "Add" : "Deduct"} — {LABEL[kind]}
              </DialogTitle>
              <DialogDescription>
                Current balance: $
                {(kind === "primary"
                  ? wallets.mainBalance
                  : kind === "secondary"
                    ? wallets.secondaryBalance
                    : wallets.creditLineBalance
                ).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="wqa-amount">Amount (USD)</Label>
              <Input
                id="wqa-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 100"
                autoFocus
              />
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustType(null)}>Cancel</Button>
              <Button
                onClick={() => adjustMutation.mutate()}
                disabled={adjustMutation.isPending || !(parseFloat(amount) > 0)}
              >
                {adjustMutation.isPending
                  ? "Saving..."
                  : adjustType === "credit"
                    ? "Add Balance"
                    : "Deduct Balance"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Convert Main → {LABEL[kind]}</DialogTitle>
              <DialogDescription>
                Main wallet: ${wallets.mainBalance.toLocaleString()} (৳{wallets.mainRate}/USD → ৳{targetRate}/USD)
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="wqa-convert">Amount to move (USD)</Label>
              <Input
                id="wqa-convert"
                type="number"
                min="0"
                step="0.01"
                max={wallets.mainBalance}
                value={convertAmount}
                onChange={(e) => setConvertAmount(e.target.value)}
                placeholder="e.g. 100"
                autoFocus
              />
              {convertUsd > 0 && targetRate > 0 && (
                <p className="text-xs text-muted-foreground">
                  ${convertUsd.toFixed(2)} ({formatBdt(convertUsd * wallets.mainRate)}) → $
                  {convertedCredit.toFixed(2)} in {LABEL[kind]}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
              <Button
                onClick={() => convertMutation.mutate()}
                disabled={
                  convertMutation.isPending || !(convertUsd > 0) || convertUsd > wallets.mainBalance
                }
              >
                {convertMutation.isPending ? "Converting..." : "Convert"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <div className="mt-1 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 flex-1 rounded-md text-[11px]"
          onClick={() => { setAdjustType("credit"); setAmount(""); setNote(""); }}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 flex-1 rounded-md text-[11px] text-destructive"
          onClick={() => { setAdjustType("debit"); setAmount(""); setNote(""); }}
        >
          <Minus className="mr-1 h-3 w-3" />
          Deduct
        </Button>
        {kind !== "primary" && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 rounded-md text-[11px]"
            onClick={() => { setConvertOpen(true); setConvertAmount(""); }}
          >
            <ArrowRightLeft className="mr-1 h-3 w-3" />
            Convert
          </Button>
        )}
      </div>


      <Dialog open={!!adjustType} onOpenChange={(o) => { if (!o) setAdjustType(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {adjustType === "credit" ? "Add" : "Deduct"} — {LABEL[kind]}
            </DialogTitle>
            <DialogDescription>
              Current balance: $
              {(kind === "primary"
                ? wallets.mainBalance
                : kind === "secondary"
                  ? wallets.secondaryBalance
                  : wallets.creditLineBalance
              ).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="wqa-amount">Amount (USD)</Label>
            <Input
              id="wqa-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 100"
              autoFocus
            />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustType(null)}>Cancel</Button>
            <Button
              onClick={() => adjustMutation.mutate()}
              disabled={adjustMutation.isPending || !(parseFloat(amount) > 0)}
            >
              {adjustMutation.isPending
                ? "Saving..."
                : adjustType === "credit"
                  ? "Add Balance"
                  : "Deduct Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Convert Main → {LABEL[kind]}</DialogTitle>
            <DialogDescription>
              Main wallet: ${wallets.mainBalance.toLocaleString()} (৳{wallets.mainRate}/USD → ৳{targetRate}/USD)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="wqa-convert">Amount to move (USD)</Label>
            <Input
              id="wqa-convert"
              type="number"
              min="0"
              step="0.01"
              max={wallets.mainBalance}
              value={convertAmount}
              onChange={(e) => setConvertAmount(e.target.value)}
              placeholder="e.g. 100"
              autoFocus
            />
            {convertUsd > 0 && targetRate > 0 && (
              <p className="text-xs text-muted-foreground">
                ${convertUsd.toFixed(2)} ({formatBdt(convertUsd * wallets.mainRate)}) → $
                {convertedCredit.toFixed(2)} in {LABEL[kind]}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
            <Button
              onClick={() => convertMutation.mutate()}
              disabled={
                convertMutation.isPending || !(convertUsd > 0) || convertUsd > wallets.mainBalance
              }
            >
              {convertMutation.isPending ? "Converting..." : "Convert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
