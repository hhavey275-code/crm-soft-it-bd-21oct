import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { useWallets, formatBdt } from "@/hooks/useWallets";

/**
 * Small translucent convert icon rendered inside the client's Secondary /
 * Credit Line wallet card. Moves Main wallet balance into that wallet at
 * each wallet's own rate (server rule: ROUND(amount * mainRate / targetRate, 2)).
 */
export function ClientWalletConvertAction({
  userId,
  target,
}: {
  userId?: string | null;
  target: "secondary" | "credit_line";
}) {
  const wallets = useWallets(userId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const label = target === "credit_line" ? "Credit Line Wallet" : "Secondary Wallet";
  const targetRate = target === "credit_line" ? wallets.creditLineRate : wallets.secondaryRate;
  const parsed = parseFloat(amount) || 0;
  const tooManyDecimals = parsed > 0 && Math.round(parsed * 100) / 100 !== parsed;
  const overBalance = parsed > wallets.mainBalance;
  const preview =
    parsed > 0 && targetRate > 0
      ? Math.round(((parsed * wallets.mainRate) / targetRate) * 100) / 100
      : 0;
  const blocked =
    parsed <= 0 || tooManyDecimals || overBalance || !(targetRate > 0) || !(wallets.mainRate > 0);

  const convertMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("convert_main_wallet", {
        p_target: target,
        p_usd_amount: parsed,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(String(data?.error ?? "Transfer failed"));
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(
        `Moved $${Number(data.moved).toLocaleString()} — $${Number(data.credited).toLocaleString()} credited to ${label}`,
      );
      setOpen(false);
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["client-transactions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Transfer failed"),
  });

  return (
    <>
      <button
        type="button"
        aria-label={`Convert Main wallet to ${label}`}
        className="h-6 w-6 rounded-md flex items-center justify-center bg-white/20 text-white hover:bg-white/35 transition-colors"
        onClick={() => {
          setAmount("");
          setOpen(true);
        }}
      >
        <ArrowRightLeft className="h-3 w-3" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Main Wallet → {label}</DialogTitle>
            <DialogDescription>
              Available in Main Wallet: ${wallets.mainBalance.toLocaleString()} (৳{wallets.mainRate}/USD → ৳
              {targetRate}/USD)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="client-convert-amount">Amount to move (USD)</Label>
            <Input
              id="client-convert-amount"
              type="number"
              min="0"
              step="0.01"
              max={wallets.mainBalance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 100"
              autoFocus
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={wallets.mainBalance <= 0}
              onClick={() => setAmount((Math.floor(wallets.mainBalance * 100) / 100).toFixed(2))}
            >
              Max ${(Math.floor(wallets.mainBalance * 100) / 100).toFixed(2)}
            </Button>
            {preview > 0 && !tooManyDecimals && !overBalance && (
              <p className="text-xs text-muted-foreground">
                ${parsed.toFixed(2)} ({formatBdt(parsed * wallets.mainRate)}) → ${preview.toFixed(2)} in {label}
              </p>
            )}
            {tooManyDecimals && (
              <p className="text-xs text-destructive">সর্বোচ্চ ২ দশমিক পর্যন্ত amount দিন</p>
            )}
            {overBalance && <p className="text-xs text-destructive">Main wallet balance is not enough</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => convertMutation.mutate()} disabled={blocked || convertMutation.isPending}>
              {convertMutation.isPending ? "Converting..." : "Convert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
