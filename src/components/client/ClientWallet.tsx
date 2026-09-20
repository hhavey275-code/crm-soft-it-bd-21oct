import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { Wallet, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { useWallets, formatBdt } from "@/hooks/useWallets";

type TransferTarget = "secondary" | "credit_line";

export function ClientWallet() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const wallets = useWallets(user?.id);
  const queryClient = useQueryClient();

  const [transferTarget, setTransferTarget] = useState<TransferTarget | null>(null);
  const [transferAmount, setTransferAmount] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["client-wallet-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "due_limit,due_limit_expires_at,secondary_due_limit,secondary_due_limit_expires_at,credit_line_due_limit,credit_line_due_limit_expires_at"
        )
        .eq("user_id", user!.id)
        .single();
      return data as any;
    },
    enabled: !!user,
  });

  const { data: topUps } = useQuery({
    queryKey: ["client-topup-history", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("top_up_requests")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data as any[]) ?? [];
    },
    enabled: !!user,
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(transferAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount");
      // Strict: the server only accepts amounts with at most 2 decimals.
      if (Math.round(amount * 100) / 100 !== amount) throw new Error("সর্বোচ্চ ২ দশমিক পর্যন্ত amount দিন");
      if (amount > wallets.mainBalance) throw new Error("Main wallet balance is not enough");
      const rate = transferTarget === "credit_line" ? wallets.creditLineRate : wallets.secondaryRate;
      if (!(wallets.mainRate > 0) || !(rate > 0)) throw new Error("USD rate সেট করা নেই — admin-কে জানান");
      const { data, error } = await (supabase as any).rpc("convert_main_wallet", {
        p_target: transferTarget,
        p_usd_amount: amount,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(String(data?.error ?? "Transfer failed"));
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(
        `Moved $${Number(data.moved).toLocaleString()} from Main wallet — $${Number(
          data.credited
        ).toLocaleString()} credited`
      );
      setTransferTarget(null);
      setTransferAmount("");
      queryClient.invalidateQueries({ queryKey: ["dual-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["client-transactions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Transfer failed"),
  });

  // Each wallet keeps its own due limit; an expired limit counts as zero.
  const notExpired = (ts?: string | null) => !ts || new Date(ts).getTime() > Date.now();
  const dueLimit = notExpired(profile?.due_limit_expires_at) ? Number(profile?.due_limit ?? 0) : 0;
  const secDueLimit = notExpired(profile?.secondary_due_limit_expires_at)
    ? Number(profile?.secondary_due_limit ?? 0)
    : 0;
  const clDueLimit = notExpired(profile?.credit_line_due_limit_expires_at)
    ? Number(profile?.credit_line_due_limit ?? 0)
    : 0;
  const dueExpiresAt = profile?.due_limit_expires_at ? new Date(profile.due_limit_expires_at) : null;
  const secDueExpiresAt = profile?.secondary_due_limit_expires_at
    ? new Date(profile.secondary_due_limit_expires_at)
    : null;
  const clDueExpiresAt = profile?.credit_line_due_limit_expires_at
    ? new Date(profile.credit_line_due_limit_expires_at)
    : null;
  // A negative wallet balance is due already consumed from that wallet's limit.
  const mainDueUsed = Math.max(0, -Number(wallets.mainBalance ?? 0));
  const secDueUsed = Math.max(0, -Number(wallets.secondaryBalance ?? 0));
  const clDueUsed = Math.max(0, -Number(wallets.creditLineBalance ?? 0));
  const mainDueRemaining = Math.max(0, dueLimit - mainDueUsed);
  const secDueRemaining = Math.max(0, secDueLimit - secDueUsed);
  const clDueRemaining = Math.max(0, clDueLimit - clDueUsed);

  const extraWalletOn = wallets.secondaryEnabled || wallets.creditLineEnabled;
  const targetLabel = transferTarget === "credit_line" ? "Credit Line Wallet" : "Secondary Wallet";
  const targetRate = transferTarget === "credit_line" ? wallets.creditLineRate : wallets.secondaryRate;
  const parsedTransfer = parseFloat(transferAmount) || 0;
  // Mirrors the server rule exactly: ROUND(amount * mainRate / targetRate, 2)
  const previewCredit =
    parsedTransfer > 0 && targetRate > 0
      ? Math.round(((parsedTransfer * wallets.mainRate) / targetRate) * 100) / 100
      : 0;
  const previewBdt = parsedTransfer > 0 ? Math.round(parsedTransfer * wallets.mainRate * 100) / 100 : 0;
  const transferTooManyDecimals =
    parsedTransfer > 0 && Math.round(parsedTransfer * 100) / 100 !== parsedTransfer;
  const transferOverBalance = parsedTransfer > wallets.mainBalance;
  const transferBlocked =
    parsedTransfer <= 0 || transferTooManyDecimals || transferOverBalance || !(targetRate > 0) || !(wallets.mainRate > 0);

  return (
    <div className="space-y-4 md:space-y-6">
      <h1 className="text-xl md:text-2xl font-bold">Wallet</h1>

      {/* Wallet Balance Card */}
      {isMobile ? (
        <div data-tutorial="wallet-balance" className="rounded-2xl bg-gradient-to-br from-primary via-primary/85 to-primary/65 p-5 text-primary-foreground shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">{extraWalletOn ? "Main Wallet Balance" : "Available Balance"}</p>
              <p className="text-3xl font-bold tracking-tight mt-1">
                ${wallets.mainBalance.toLocaleString()}
              </p>
              <p className="text-xs opacity-70 mt-1">{wallets.currency}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
              <Wallet className="h-6 w-6" />
            </div>
          </div>
        </div>
      ) : (
        <Card data-tutorial="wallet-balance" className="bg-primary text-primary-foreground">
          <CardContent className="p-8">
            <p className="text-sm opacity-80">{extraWalletOn ? "Main Wallet Balance" : "Available Balance"}</p>
            <p className="text-4xl font-bold mt-1">${wallets.mainBalance.toLocaleString()}</p>
            <p className="text-sm mt-2 opacity-70">{wallets.currency}</p>
          </CardContent>
        </Card>
      )}

      {/* Extra wallets (each has its own per-client toggle) */}
      {extraWalletOn && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {wallets.secondaryEnabled && (
            <Card className="border-border/60 bg-card">
              <CardContent className="p-5">
                <p className="text-sm text-green-700 dark:text-green-400">Secondary Wallet Balance</p>
                <p className="text-2xl font-bold mt-1 text-green-700 dark:text-green-300">
                  ${wallets.secondaryBalance.toLocaleString()}
                </p>
                <p className="text-xs text-green-700/70 dark:text-green-400/70 mt-1">Rate ৳{wallets.secondaryRate}/USD</p>
              </CardContent>
            </Card>
          )}
          {wallets.creditLineEnabled && (
            <Card className="border-border/60 bg-card">
              <CardContent className="p-5">
                <p className="text-sm text-sky-700 dark:text-sky-400">Credit Line Wallet Balance</p>
                <p className="text-2xl font-bold mt-1 text-sky-700 dark:text-sky-300">
                  ${wallets.creditLineBalance.toLocaleString()}
                </p>
                <p className="text-xs text-sky-700/70 dark:text-sky-400/70 mt-1">Rate ৳{wallets.creditLineRate}/USD</p>
              </CardContent>
            </Card>
          )}
          <Card className="border-border/60 bg-card">
            <CardContent className="p-5">
              <p className="text-sm text-purple-700 dark:text-purple-400">Combined Due / Adv</p>
              <p className="text-2xl font-bold mt-1 text-purple-700 dark:text-purple-300">
                {wallets.totalBdt < 0 ? "-" : ""}{formatBdt(wallets.totalBdt)}
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-purple-700/70 dark:text-purple-400/70">
                  {wallets.totalBdt < 0 ? "Due" : "Adv"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Main ${wallets.mainBalance.toLocaleString()} × ৳{wallets.mainRate}
                {wallets.creditLineEnabled
                  ? ` + Credit Line $${wallets.creditLineBalance.toLocaleString()} × ৳${wallets.creditLineRate}`
                  : ""}
                {wallets.secondaryEnabled
                  ? ` + Secondary $${wallets.secondaryBalance.toLocaleString()} × ৳${wallets.secondaryRate}`
                  : ""}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Move balance from the main wallet into an extra wallet */}
      {extraWalletOn && (
        <Card className="border-border/60">
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px]">
              <p className="text-sm font-semibold">Move Main Wallet balance</p>
              <p className="text-xs text-muted-foreground">
                Converted at each wallet&apos;s own rate. Use it to clear a due or pre-fund a wallet.
              </p>
            </div>
            {wallets.creditLineEnabled && (
              <Button
                size="sm"
                className="bg-sky-600 hover:bg-sky-700 text-white"
                disabled={wallets.mainBalance <= 0}
                onClick={() => { setTransferTarget("credit_line"); setTransferAmount(""); }}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                To Credit Line
              </Button>
            )}
            {wallets.secondaryEnabled && (
              <Button
                size="sm"
                variant="secondary"
                disabled={wallets.mainBalance <= 0}
                onClick={() => { setTransferTarget("secondary"); setTransferAmount(""); }}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                To Secondary
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!transferTarget} onOpenChange={(o) => { if (!o) setTransferTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Main Wallet → {targetLabel}</DialogTitle>
            <DialogDescription>
              Available in Main Wallet: ${wallets.mainBalance.toLocaleString()} (৳{wallets.mainRate}/USD)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="transfer-amount">Amount to move (USD)</Label>
            <Input
              id="transfer-amount"
              type="number"
              min="0"
              step="0.01"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              placeholder="e.g. 100"
              autoFocus
            />
            {previewCredit > 0 && (
              <p className="text-xs text-muted-foreground">
                ${parsedTransfer.toLocaleString()} × ৳{wallets.mainRate} ÷ ৳{targetRate} ={" "}
                <span className="font-semibold text-foreground">
                  ${previewCredit.toFixed(2)}
                </span>{" "}
                credited to {targetLabel}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => transferMutation.mutate()}
              disabled={transferMutation.isPending || parsedTransfer <= 0}
            >
              {transferMutation.isPending ? "Moving…" : "Confirm transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Due Limit Notices — each wallet has its own limit */}
      {(dueLimit > 0 ||
        (wallets.creditLineEnabled && clDueLimit > 0) ||
        (wallets.secondaryEnabled && secDueLimit > 0)) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dueLimit > 0 && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40 p-3 flex items-start gap-2.5">
              <div className="h-8 w-8 shrink-0 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span className="text-amber-700 dark:text-amber-400 text-sm font-bold">!</span>
              </div>
              <div className="flex-1 text-xs">
                <p className="font-semibold text-amber-800 dark:text-amber-300">
                  Main wallet due limit ${dueLimit.toLocaleString()}
                </p>
                <p className="text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                  Used ${mainDueUsed.toFixed(2)} · Remaining ${mainDueRemaining.toFixed(2)}
                </p>
                {dueExpiresAt && (
                  <p className="text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                    {dueExpiresAt.getTime() > Date.now()
                      ? `Expires on ${format(dueExpiresAt, "MMM d, yyyy 'at' h:mm a")}`
                      : "Expired — pending auto-reset"}
                  </p>
                )}
              </div>
            </div>
          )}
          {wallets.creditLineEnabled && clDueLimit > 0 && (
            <div className="rounded-lg border border-sky-300/60 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800/40 p-3 flex items-start gap-2.5">
              <div className="h-8 w-8 shrink-0 rounded-full bg-sky-500/20 flex items-center justify-center">
                <span className="text-sky-700 dark:text-sky-400 text-sm font-bold">!</span>
              </div>
              <div className="flex-1 text-xs">
                <p className="font-semibold text-sky-800 dark:text-sky-300">
                  Credit line due limit ${clDueLimit.toLocaleString()}
                </p>
                <p className="text-sky-700/80 dark:text-sky-400/80 mt-0.5">
                  Used ${clDueUsed.toFixed(2)} · Remaining ${clDueRemaining.toFixed(2)}
                </p>
                {clDueExpiresAt && (
                  <p className="text-sky-700/80 dark:text-sky-400/80 mt-0.5">
                    {clDueExpiresAt.getTime() > Date.now()
                      ? `Expires on ${format(clDueExpiresAt, "MMM d, yyyy 'at' h:mm a")}`
                      : "Expired — pending auto-reset"}
                  </p>
                )}
              </div>
            </div>
          )}
          {wallets.secondaryEnabled && secDueLimit > 0 && (
            <div className="rounded-lg border border-violet-300/60 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800/40 p-3 flex items-start gap-2.5">
              <div className="h-8 w-8 shrink-0 rounded-full bg-violet-500/20 flex items-center justify-center">
                <span className="text-violet-700 dark:text-violet-400 text-sm font-bold">!</span>
              </div>
              <div className="flex-1 text-xs">
                <p className="font-semibold text-violet-800 dark:text-violet-300">
                  Secondary wallet due limit ${secDueLimit.toLocaleString()}
                </p>
                <p className="text-violet-700/80 dark:text-violet-400/80 mt-0.5">
                  Used ${secDueUsed.toFixed(2)} · Remaining ${secDueRemaining.toFixed(2)}
                </p>
                {secDueExpiresAt && (
                  <p className="text-violet-700/80 dark:text-violet-400/80 mt-0.5">
                    {secDueExpiresAt.getTime() > Date.now()
                      ? `Expires on ${format(secDueExpiresAt, "MMM d, yyyy 'at' h:mm a")}`
                      : "Expired — pending auto-reset"}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Card data-tutorial="wallet-history">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base md:text-lg">Top-Up History</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          {isMobile ? (
            <div className="space-y-2.5">
              {topUps?.map((t: any) => (
                <div key={t.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">${Number(t.amount).toLocaleString()}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-xs text-muted-foreground">
                    <span>Cap: ${Number(t.old_spend_cap).toLocaleString()} → ${Number(t.new_spend_cap).toLocaleString()}</span>
                    <span>{format(new Date(t.created_at), "MMM d, yyyy")}</span>
                  </div>
                </div>
              ))}
              {(!topUps || topUps.length === 0) && (
                <p className="text-center text-muted-foreground py-6 text-sm">No top-ups yet</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Amount</TableHead>
                  <TableHead>Old Cap</TableHead>
                  <TableHead>New Cap</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topUps?.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-semibold">${Number(t.amount).toLocaleString()}</TableCell>
                    <TableCell>${Number(t.old_spend_cap).toLocaleString()}</TableCell>
                    <TableCell>${Number(t.new_spend_cap).toLocaleString()}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{format(new Date(t.created_at), "MMM d, yyyy")}</TableCell>
                  </TableRow>
                ))}
                {(!topUps || topUps.length === 0) && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No top-ups yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
