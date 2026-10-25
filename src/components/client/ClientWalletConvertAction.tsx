import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRightLeft, ArrowDownUp } from "lucide-react";
import { toast } from "sonner";
import { useWallets, formatBdt, type WalletKind } from "@/hooks/useWallets";

const LABELS: Record<WalletKind, string> = {
  primary: "Main Wallet",
  secondary: "Secondary Wallet",
  credit_line: "Credit Line Wallet",
};

/**
 * Wallet exchange: move USD from any enabled wallet into any other enabled
 * wallet at each wallet's own rate (server: ROUND(amount * srcRate / tgtRate, 2)).
 * `target` = the wallet card this button sits on (pre-selected as destination,
 * or as source when it is the Main wallet).
 */
export function ClientWalletConvertAction({
  userId,
  target,
  variant = "icon",
}: {
  userId?: string | null;
  target: WalletKind;
  variant?: "icon" | "button";
}) {
  const wallets = useWallets(userId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState<WalletKind>("primary");
  const [to, setTo] = useState<WalletKind>("secondary");

  const enabled: WalletKind[] = [
    ...(wallets.mainEnabled ? (["primary"] as WalletKind[]) : []),
    ...(wallets.secondaryEnabled ? (["secondary"] as WalletKind[]) : []),
    ...(wallets.creditLineEnabled ? (["credit_line"] as WalletKind[]) : []),
  ];

  const balanceOf = (k: WalletKind) =>
    k === "primary" ? wallets.mainBalance : k === "secondary" ? wallets.secondaryBalance : wallets.creditLineBalance;
  const rateOf = (k: WalletKind) =>
    k === "primary" ? wallets.mainRate : k === "secondary" ? wallets.secondaryRate : wallets.creditLineRate;

  const openDialog = () => {
    let f: WalletKind;
    let t: WalletKind;
    if (target === "primary" || !enabled.includes(target)) {
      f = enabled[0];
      t = enabled.find((k) => k !== f)!;
    } else {
      t = target;
      f = enabled.find((k) => k !== t)!;
    }
    setFrom(f);
    setTo(t);
    setAmount("");
    setOpen(true);
  };

  const changeFrom = (v: WalletKind) => {
    setFrom(v);
    if (v === to) setTo(enabled.find((k) => k !== v)!);
  };
  const changeTo = (v: WalletKind) => {
    setTo(v);
    if (v === from) setFrom(enabled.find((k) => k !== v)!);
  };

  const srcBal = balanceOf(from);
  const srcRate = rateOf(from);
  const tgtRate = rateOf(to);
  const maxMove = Math.max(0, Math.floor(srcBal * 100) / 100);
  const parsed = parseFloat(amount) || 0;
  const tooManyDecimals = parsed > 0 && Math.round(parsed * 100) / 100 !== parsed;
  const overBalance = parsed > srcBal;
  const preview = parsed > 0 && tgtRate > 0 ? Math.round(((parsed * srcRate) / tgtRate) * 100) / 100 : 0;
  const blocked = parsed <= 0 || tooManyDecimals || overBalance || !(srcRate > 0) || !(tgtRate > 0) || from === to;

  const convertMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("convert_between_wallets", {
        p_source: from,
        p_target: to,
        p_usd_amount: parsed,
        p_user_id: userId ?? null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(String(data?.error ?? "Transfer failed"));
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(
        `Moved $${Number(data.moved).toLocaleString()} from ${LABELS[from]} — $${Number(data.credited).toLocaleString()} credited to ${LABELS[to]}`,
      );
      setOpen(false);
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["client-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["client-detail-wallet", userId] });
      queryClient.invalidateQueries({ queryKey: ["client-detail-transactions", userId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Transfer failed"),
  });

  const walletSelect = (value: WalletKind, onChange: (v: WalletKind) => void, id: string) => (
    <Select value={value} onValueChange={(v) => onChange(v as WalletKind)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {enabled.map((k) => (
          <SelectItem key={k} value={k}>
            {LABELS[k]} · ${balanceOf(k).toLocaleString()} · ৳{rateOf(k)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (enabled.length < 2) return null;

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          aria-label="Wallet exchange"
          className="h-6 w-6 rounded-md flex items-center justify-center bg-white/20 text-white hover:bg-white/35 transition-colors"
          onClick={openDialog}
        >
          <ArrowRightLeft className="h-3 w-3" />
        </button>
      ) : (
        <Button size="sm" onClick={openDialog}>
          <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
          Wallet Exchange
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Wallet Exchange</DialogTitle>
            <DialogDescription>
              Move dollars between your wallets. Converted at each wallet&apos;s own rate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="xchg-from">From</Label>
              {walletSelect(from, changeFrom, "xchg-from")}
            </div>
            <div className="flex justify-center">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-7 w-7"
                aria-label="Swap wallets"
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                }}
              >
                <ArrowDownUp className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="xchg-to">To</Label>
              {walletSelect(to, changeTo, "xchg-to")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="xchg-amount">Amount to move (USD)</Label>
              <Input
                id="xchg-amount"
                type="number"
                min="0"
                step="0.01"
                max={maxMove}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 100"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                disabled={maxMove <= 0}
                onClick={() => setAmount(maxMove.toFixed(2))}
              >
                Max ${maxMove.toFixed(2)}
              </Button>
              {preview > 0 && !tooManyDecimals && !overBalance && (
                <p className="text-xs text-muted-foreground">
                  ${parsed.toFixed(2)} × ৳{srcRate} = {formatBdt(parsed * srcRate)} ÷ ৳{tgtRate} ={" "}
                  <span className="font-semibold text-foreground">${preview.toFixed(2)}</span> in {LABELS[to]}
                </p>
              )}
              {tooManyDecimals && <p className="text-xs text-destructive">সর্বোচ্চ ২ দশমিক পর্যন্ত amount দিন</p>}
              {overBalance && (
                <p className="text-xs text-destructive">
                  {LABELS[from]}-এ আছে ${srcBal.toLocaleString()} — এর বেশি move করা যাবে না।
                </p>
              )}
              {(!(srcRate > 0) || !(tgtRate > 0)) && (
                <p className="text-xs text-destructive">USD rate সেট করা নেই — admin-কে জানান।</p>
              )}
            </div>
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
