import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Minus, Wallet, Scale, DollarSign, Save, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useWallets, formatBdt } from "@/hooks/useWallets";

function useInvalidate(userId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-transactions", userId] });
  };
}

/**
 * Info-tab control: enable/disable the secondary (sheet-rate) wallet for this
 * client and set its own USD rate.
 */
export function SecondaryWalletToggle({ userId }: { userId: string }) {
  const wallets = useWallets(userId);
  const invalidate = useInvalidate(userId);
  const [rateInput, setRateInput] = useState("");
  const [editingRate, setEditingRate] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ secondary_wallet_enabled: enabled })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Secondary wallet updated");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  const rateMutation = useMutation({
    mutationFn: async () => {
      const parsed = parseFloat(rateInput);
      if (!parsed || parsed <= 0) throw new Error("Enter a valid rate");
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ secondary_usd_rate: parsed })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Secondary wallet rate saved");
      setRateInput("");
      setEditingRate(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save rate"),
  });

  return (
    <div className="pt-3 border-t space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Secondary Wallet (Sheet Rate)
          </p>
          <p className="text-xs text-muted-foreground">
            Admin-controlled second wallet with its own USD rate
          </p>
        </div>
        <Switch
          checked={wallets.secondaryEnabled}
          onCheckedChange={(v) => toggleMutation.mutate(v)}
          disabled={toggleMutation.isPending}
        />
      </div>

      {wallets.secondaryEnabled && (
        <div className="flex items-center gap-3 rounded-xl border border-green-200/60 bg-green-50/40 dark:bg-green-950/20 dark:border-green-800/40 p-4 transition-colors hover:bg-green-50/60">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
            <DollarSign className="h-4 w-4 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Secondary Rate (Sheet)
            </p>
            {editingRate ? (
              <div className="flex items-center gap-1 mt-1">
                <Input
                  type="number"
                  step="0.01"
                  className="w-20 h-7 text-sm"
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  placeholder={String(wallets.secondaryRate || "124")}
                  autoFocus
                />
                <Button
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => rateMutation.mutate()}
                  disabled={rateMutation.isPending}
                >
                  <Save className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => setEditingRate(false)}
                >
                  <XCircle className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <p
                className="font-semibold text-sm text-green-700 dark:text-green-400 cursor-pointer hover:text-green-500 transition-colors"
                onClick={() => {
                  setRateInput(String(wallets.secondaryRate ?? ""));
                  setEditingRate(true);
                }}
              >
                ৳{wallets.secondaryRate}/USD
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * Compact secondary-wallet balance card, sized like the main Wallet Balance
 * card so both sit side by side. Renders nothing when the feature is off.
 */
export function SecondaryWalletCard({ userId }: { userId: string }) {
  const wallets = useWallets(userId);
  const invalidate = useInvalidate(userId);
  const [adjustType, setAdjustType] = useState<"credit" | "debit" | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const adjustMutation = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(amount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      const signed = adjustType === "credit" ? amt : -amt;
      const { data, error } = await (supabase as any).rpc("admin_adjust_secondary_wallet", {
        p_user_id: userId,
        p_amount: signed,
        p_reason: note.trim() || (adjustType === "credit" ? "Admin added secondary balance" : "Admin deducted secondary balance"),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(adjustType === "credit" ? "Secondary balance added!" : "Secondary balance deducted!");
      setAdjustType(null);
      setAmount("");
      setNote("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Adjustment failed"),
  });

  if (!wallets.secondaryEnabled) return null;

  return (
    <>
      <Card className="border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-emerald-500/20">
              <Wallet className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">Secondary Wallet</p>
              <p className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80">৳{wallets.secondaryRate}/USD</p>
            </div>
            <div className="flex items-center gap-0.5 ml-auto shrink-0">
              <button
                className="h-6 w-6 rounded-md flex items-center justify-center text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                onClick={() => { setAdjustType("credit"); setAmount(""); setNote(""); }}
                title="Add secondary balance"
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                className="h-6 w-6 rounded-md flex items-center justify-center text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                onClick={() => { setAdjustType("debit"); setAmount(""); setNote(""); }}
                title="Deduct secondary balance"
              >
                <Minus className="h-3 w-3" />
              </button>
            </div>
          </div>
          <p className="flex items-baseline gap-2 text-2xl font-bold tracking-tight text-green-700 dark:text-green-300">
            ${wallets.secondaryBalance.toLocaleString()}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-green-700/70 dark:text-green-400/70">
              {wallets.secondaryBalance < 0 ? "Due" : "Adv"}
            </span>
          </p>
        </CardContent>
      </Card>

      <Dialog open={!!adjustType} onOpenChange={(open) => !open && setAdjustType(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{adjustType === "credit" ? "Add Secondary Balance" : "Deduct Secondary Balance"}</DialogTitle>
            <DialogDescription>
              Current secondary balance:{" "}
              <span className="font-semibold">${wallets.secondaryBalance.toLocaleString()}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Amount (USD)</Label>
              <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100.00" />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" />
            </div>
            {parseFloat(amount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Balance After</span>
                <span className="font-semibold">
                  ${(wallets.secondaryBalance + (adjustType === "credit" ? 1 : -1) * parseFloat(amount)).toLocaleString()}
                </span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustType(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => adjustMutation.mutate()}
              disabled={adjustMutation.isPending || !(parseFloat(amount) > 0)}
            >
              {adjustMutation.isPending ? "Saving..." : adjustType === "credit" ? "Add Balance" : "Deduct Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Compact combined (main + secondary) BDT due/advance card. */
export function CombinedTotalCard({ userId }: { userId: string }) {
  const wallets = useWallets(userId);
  if (!wallets.secondaryEnabled) return null;
  const mainBdt = wallets.mainBalance * wallets.mainRate;
  const secondaryBdt = wallets.secondaryBalance * wallets.secondaryRate;
  const totalBdt = mainBdt + secondaryBdt;
  const isDue = totalBdt < 0;
  return (
    <Card className="border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-purple-500/20">
            <Scale className="h-4.5 w-4.5 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">Combined Due / Adv</p>
            <p className="text-[10px] text-muted-foreground truncate">
              Main {formatBdt(mainBdt)} ({wallets.mainBalance < 0 ? "-" : ""}${Math.abs(wallets.mainBalance).toLocaleString()} × ৳{wallets.mainRate}) + Secondary {formatBdt(secondaryBdt)} (৳{wallets.secondaryRate})
            </p>
          </div>
        </div>
        <p className="flex items-baseline gap-2 text-2xl font-bold tracking-tight text-purple-700 dark:text-purple-300">
          {isDue ? "-" : ""}{formatBdt(totalBdt)}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-purple-700/70 dark:text-purple-400/70">
            {isDue ? "Due" : "Adv"}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

