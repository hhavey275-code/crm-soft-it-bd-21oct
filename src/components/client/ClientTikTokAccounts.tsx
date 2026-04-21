import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { SpendProgressBar } from "@/components/SpendProgressBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowUpCircle, Search, Loader2, AlertTriangle, CheckCircle2, ExternalLink, ArrowUpDown } from "lucide-react";
import { friendlyEdgeError } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface PendingTopUp {
  ad_account_id: string;
  account_name: string;
  account_id: string;
  amount: number;
  old_spend_cap: number;
  expected_new_cap: number;
  billing_url: string;
}

export function ClientTikTokAccounts() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState(() => sessionStorage.getItem("tiktokAccountsSearch") || "");
  useEffect(() => { sessionStorage.setItem("tiktokAccountsSearch", search); }, [search]);
  const [topUpAccount, setTopUpAccount] = useState<any>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [pendingTopUp, setPendingTopUp] = useState<PendingTopUp | null>(null);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sortField, setSortField] = useState<string>("account_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [statusFilter, setStatusFilter] = useState("all");

  // Restore pending top-up from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem("pendingTikTokTopUp");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setPendingTopUp(parsed);
        setShowVerifyDialog(true);
      } catch { /* ignore */ }
    }
  }, []);

  // Fetch wallet balance
  const { data: wallet } = useQuery({
    queryKey: ["client-wallet", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("balance").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  // Trigger background sync on mount and every 2 minutes
  useEffect(() => {
    if (!user) return;
    const doSync = () => {
      supabase.functions.invoke("tiktok-sync-client").then(({ data }) => {
        if (data?.account_frozen) {
          toast.error("Account frozen due to spending cap mismatch. Contact admin.");
        }
      }).catch(() => {});
    };
    doSync();
    // No repeat sync — only on mount. Realtime handles updates.
    return () => {};
  }, [user]);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["client-tiktok-accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_accounts")
        .select("*")
        .eq("platform", "tiktok")
        .order("account_name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchInterval: false,
    refetchOnWindowFocus: true,
  });

  const topUpMutation = useMutation({
    mutationFn: async () => {
      if (!topUpAccount || !topUpAmount) throw new Error("Missing data");
      const amt = parseFloat(topUpAmount);
      if (isNaN(amt) || amt <= 0) throw new Error("Invalid amount");

      const { data, error } = await supabase.functions.invoke("tiktok-topup", {
        body: { ad_account_id: topUpAccount.id, amount: amt, deduct_wallet: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data.pending_verify) {
        const pending: PendingTopUp = {
          ad_account_id: data.ad_account_id,
          account_name: topUpAccount.account_name,
          account_id: data.account_id,
          amount: data.amount,
          old_spend_cap: data.old_spend_cap,
          expected_new_cap: data.expected_new_cap,
          billing_url: data.billing_url,
        };
        sessionStorage.setItem("pendingTikTokTopUp", JSON.stringify(pending));
        setPendingTopUp(pending);

        setTopUpAccount(null);
        setTopUpAmount("");
        queryClient.invalidateQueries({ queryKey: ["client-tiktok-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["client-wallet"] });

        window.open(data.billing_url, "_blank");
        setTimeout(() => setShowVerifyDialog(true), 1000);
      } else {
        toast.success(`Top up successful: $${topUpAmount}`);
        setTopUpAccount(null);
        setTopUpAmount("");
        queryClient.invalidateQueries({ queryKey: ["client-tiktok-accounts"] });
        queryClient.invalidateQueries({ queryKey: ["client-wallet"] });
      }
    },
    onError: (err: any) => toast.error(friendlyEdgeError(err)),
  });

  const handleVerify = async (confirmed: boolean) => {
    if (!confirmed || !pendingTopUp) {
      sessionStorage.removeItem("pendingTikTokTopUp");
      setPendingTopUp(null);
      setShowVerifyDialog(false);
      toast.info("Top-up not verified. Contact admin if you need assistance.");
      return;
    }

    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("tiktok-verify-topup", {
        body: {
          ad_account_id: pendingTopUp.ad_account_id,
          amount: pendingTopUp.amount,
          old_spend_cap: pendingTopUp.old_spend_cap,
        },
      });

      if (error) throw error;

      if (data?.verified) {
        toast.success("Top-up verified successfully! Spending cap updated.", { duration: 5000 });
        sessionStorage.removeItem("pendingTikTokTopUp");
        setPendingTopUp(null);
        setShowVerifyDialog(false);
        queryClient.invalidateQueries({ queryKey: ["client-tiktok-accounts"] });
      } else if (data?.mismatch) {
        toast.error(data.error || "Spending cap mismatch. Your account has been frozen.", { duration: 10000 });
        sessionStorage.removeItem("pendingTikTokTopUp");
        setPendingTopUp(null);
        setShowVerifyDialog(false);
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch (err: any) {
      toast.error(friendlyEdgeError(err));
    } finally {
      setVerifying(false);
    }
  };

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const s = search.toLowerCase();
    return [...accounts]
      .filter((a: any) => {
        if (s && !a.account_name.toLowerCase().includes(s) && !a.account_id.toLowerCase().includes(s)) return false;
        if (statusFilter !== "all" && a.status?.toLowerCase() !== statusFilter) return false;
        return true;
      })
      .sort((a: any, b: any) => {
        let valA: any, valB: any;
        switch (sortField) {
          case "account_name": valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase(); break;
          case "spend_cap": valA = Number(a.spend_cap); valB = Number(b.spend_cap); break;
          default: valA = a.account_name?.toLowerCase(); valB = b.account_name?.toLowerCase();
        }
        if (valA < valB) return sortDir === "asc" ? -1 : 1;
        if (valA > valB) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [accounts, search, statusFilter, sortField, sortDir]);

  const walletBalance = Number(wallet?.balance ?? 0);
  const parsedAmount = parseFloat(topUpAmount) || 0;
  const insufficientFunds = parsedAmount > walletBalance;

  const getBillingUrl = (accountId: string) => {
    return `https://business.tiktok.com/manage/payment/v2?org_id=7385945312675807249&aadvid=${accountId}`;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-foreground">TikTok Ad Accounts</h2>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 rounded-full"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[110px] md:w-[140px] h-9 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {isMobile && (
          <Select value={`${sortField}:${sortDir}`} onValueChange={(v) => { const [f, d] = v.split(":"); setSortField(f); setSortDir(d as "asc" | "desc"); }}>
            <SelectTrigger className="w-[120px] h-9 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="account_name:asc">Name A-Z</SelectItem>
              <SelectItem value="account_name:desc">Name Z-A</SelectItem>
              <SelectItem value="spend_cap:desc">Cap High</SelectItem>
              <SelectItem value="spend_cap:asc">Cap Low</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Mobile Card Layout */}
      {isMobile ? (
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No TikTok ad accounts assigned</p>
          ) : (
            filtered.map((acc: any) => (
              <Card
                key={acc.id}
                className="border border-border/60 shadow-sm cursor-pointer active:scale-[0.98] transition-transform"
                onClick={() => navigate(`/ad-accounts/${acc.id}`)}
              >
                <CardContent className="p-3">
                  <div className="flex-1 min-w-0">
                    {/* Top row: name + status */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{acc.account_name}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[11px] text-muted-foreground font-mono">{acc.account_id}</span>
                          <a
                            href={getBillingUrl(acc.account_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                      <StatusBadge status={acc.status} />
                    </div>

                    {/* Spend progress */}
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <SpendProgressBar
                        amountSpent={Number(acc.amount_spent)}
                        spendCap={Number(acc.spend_cap)}
                        balanceAfterTopup={Number(acc.balance_after_topup ?? 0)}
                        platform="tiktok"
                      />
                    </div>

                    {/* Top Up button */}
                    <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs h-8"
                        onClick={() => { setTopUpAccount(acc); setTopUpAmount(""); }}
                      >
                        <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
                        Top Up
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : (
        /* Desktop Table Layout */
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Account ID</TableHead>
                  <TableHead>Spend Cap</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No TikTok ad accounts assigned
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((acc: any) => (
                    <TableRow
                      key={acc.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/ad-accounts/${acc.id}`)}
                    >
                      <TableCell className="font-medium">{acc.account_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground font-mono text-xs">{acc.account_id}</span>
                          <a
                            href={getBillingUrl(acc.account_id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <SpendProgressBar amountSpent={acc.amount_spent} spendCap={acc.spend_cap} balanceAfterTopup={Number(acc.balance_after_topup ?? 0)} platform="tiktok" />
                      </TableCell>
                      <TableCell><StatusBadge status={acc.status} /></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="default" className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => { setTopUpAccount(acc); setTopUpAmount(""); }}>
                          <ArrowUpCircle className="h-4 w-4 mr-1" /> Top Up
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Top Up Dialog */}
      <Dialog open={!!topUpAccount} onOpenChange={(o) => !o && setTopUpAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Top Up TikTok Account</DialogTitle>
            <DialogDescription>
              Wallet balance থেকে amount কেটে নেওয়া হবে এবং TikTok Billing page এ redirect হবে।
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{topUpAccount?.account_name} ({topUpAccount?.account_id})</p>
          
          <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Wallet Balance:</span>
              <span className="font-medium">${walletBalance.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Spend Cap:</span>
              <span className="font-medium">${Number(topUpAccount?.spend_cap ?? 0).toFixed(2)}</span>
            </div>
            {parsedAmount > 0 && (
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="text-muted-foreground">New Spend Cap:</span>
                <span className="font-semibold text-emerald-600">${(Number(topUpAccount?.spend_cap ?? 0) + parsedAmount).toFixed(2)}</span>
              </div>
            )}
          </div>

          <div>
            <Label>Amount (USD)</Label>
            <Input
              type="number"
              min="1"
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              placeholder="Enter amount"
            />
            {insufficientFunds && (
              <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Insufficient wallet balance
              </p>
            )}
          </div>

          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-200">
            <p className="font-medium mb-1">⚠️ গুরুত্বপূর্ণ:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Top Up click করলে wallet থেকে amount কেটে নেবে</li>
              <li>TikTok Billing page open হবে — সেখানে exactly এই পরিমাণ limit বাড়ান</li>
              <li>CRM এ ফিরে আসলে confirm করতে হবে</li>
              <li>ভুল amount বাড়ালে account freeze হয়ে যাবে</li>
            </ol>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTopUpAccount(null)}>Cancel</Button>
            <Button
              onClick={() => topUpMutation.mutate()}
              disabled={topUpMutation.isPending || insufficientFunds || parsedAmount <= 0}
            >
              {topUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Top Up & Open TikTok
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verification Confirmation Dialog */}
      <AlertDialog open={showVerifyDialog} onOpenChange={setShowVerifyDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Top-Up Confirmation
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>আপনি কি TikTok এ exactly <strong className="text-foreground">${pendingTopUp?.amount}</strong> spending limit বাড়িয়েছেন?</p>
                <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Account:</span>
                    <span className="font-medium">{pendingTopUp?.account_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Amount:</span>
                    <span className="font-medium">${pendingTopUp?.amount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Expected New Cap:</span>
                    <span className="font-medium">${pendingTopUp?.expected_new_cap}</span>
                  </div>
                </div>
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2 text-xs text-destructive">
                  ⚠️ ভুল amount বাড়ালে আপনার account freeze হয়ে যাবে!
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleVerify(false)} disabled={verifying}>
              না, বাড়াইনি
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleVerify(true)} disabled={verifying}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              হ্যাঁ, বাড়িয়েছি — Verify করো
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
