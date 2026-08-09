import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Minus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useWallets, formatBdt } from "@/hooks/useWallets";

interface Props {
  userId: string;
  /** Client's main wallet balance in USD */
  mainBalance: number;
}

/**
 * Admin-only control for the secondary (sheet-rate) wallet: enable/disable it
 * per client, set its own USD rate, adjust its balance, and see the combined
 * BDT due/advance across both wallets — replacing the Google Sheet.
 */
export function SecondaryWalletPanel({ userId, mainBalance }: Props) {
  const queryClient = useQueryClient();
  const wallets = useWallets(userId);
  const [rateInput, setRateInput] = useState("");
  const [adjustType, setAdjustType] = useState<"credit" | "debit" | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-profile", userId] });
    queryClient.invalidateQueries({ queryKey: ["client-detail-transactions", userId] });
  };

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
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save rate"),
  });

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

  return (
    <>
      <Card className="border border-teal-200/70 dark:border-teal-800/50 shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 items-center justify-center rounded-xl h-9 w-9 bg-teal-100 dark:bg-teal-900/40">
              <Wallet className="h-4 w-4 text-teal-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Secondary Wallet</p>
              <p className="text-xs text-muted-foreground">Sheet-rate wallet (admin controlled)</p>
            </div>
            <Switch
              checked={wallets.secondaryEnabled}
              onCheckedChange={(v) => toggleMutation.mutate(v)}
              disabled={toggleMutation.isPending}
            />
          </div>

          {wallets.secondaryEnabled && (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className={`text-2xl font-bold tracking-tight ${wallets.secondaryBalance < 0 ? "text-destructive" : "text-teal-700 dark:text-teal-300"}`}>
                    ${wallets.secondaryBalance.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-green-600"
                    onClick={() => { setAdjustType("credit"); setAmount(""); setNote(""); }}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-red-500"
                    onClick={() => { setAdjustType("debit"); setAmount(""); setNote(""); }}
                  >
                    <Minus className="h-3 w-3 mr-1" /> Deduct
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Secondary USD Rate (৳)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    className="h-9"
                    placeholder={String(wallets.secondaryRate || "124")}
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                  />
                  <Button size="sm" className="h-9" onClick={() => rateMutation.mutate()} disabled={rateMutation.isPending}>
                    Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Current: ৳{wallets.secondaryRate}/USD</p>
              </div>

              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">
                  Combined Total ({wallets.totalBdt < 0 ? "Due" : "Advance"})
                </p>
                <p className={`text-xl font-bold ${wallets.totalBdt < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {formatBdt(wallets.totalBdt)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Main ${mainBalance.toLocaleString()} × ৳{wallets.mainRate} + Secondary ${wallets.secondaryBalance.toLocaleString()} × ৳{wallets.secondaryRate}
                </p>
              </div>
            </>
          )}
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
            <Button onClick={() => adjustMutation.mutate()} disabled={adjustMutation.isPending || !(parseFloat(amount) > 0)}>
              {adjustMutation.isPending ? "Saving..." : adjustType === "credit" ? "Add Balance" : "Deduct Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
