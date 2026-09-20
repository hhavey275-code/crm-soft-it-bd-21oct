import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { Copy, Download, Gift, Users, Wallet, TrendingUp, RefreshCw } from "lucide-react";
import { buildReferralLink } from "@/lib/referral";

const usd = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const bdt = (n: number) =>
  `৳${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (d: string) => format(new Date(`${d}T00:00:00`), "MMMM yyyy");

export function ClientReferral() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));

  const { data: settings } = useQuery({
    queryKey: ["referral-settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["referral_min_monthly_spend", "referral_enabled"]);
      const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value ?? ""]));
      return {
        minSpend: Number(map["referral_min_monthly_spend"] ?? 3000) || 3000,
        enabled: (map["referral_enabled"] ?? "on") !== "off",
      };
    },
  });

  const enabledForMe = !!(profile as any)?.referral_enabled;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["referral-account-earnings", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_account_earnings")
        .select("*")
        .eq("referrer_id", user!.id)
        .order("period_month", { ascending: false });
      return data ?? [];
    },
    enabled: !!user && enabledForMe,
  });

  const { data: payouts = [] } = useQuery({
    queryKey: ["referral-payouts", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_payout_requests")
        .select("*")
        .eq("referrer_id", user!.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!user && enabledForMe,
  });

  const { data: available = 0 } = useQuery({
    queryKey: ["referral-available-bdt", user?.id, payouts.length, rows.length],
    queryFn: async () => {
      const { data } = await supabase.rpc("referral_available_bdt", { p_referrer: user!.id });
      return Number(data ?? 0);
    },
    enabled: !!user && enabledForMe,
  });

  const code = (profile as any)?.referral_code as string | undefined;
  const rate = Number((profile as any)?.referral_rate_bdt ?? 0);
  const minSpend = settings?.minSpend ?? 3000;
  const link = code ? buildReferralLink(code) : "";
  const selectedMonth = `${month}-01`;

  const monthRows = useMemo(
    () => (rows as any[]).filter((r) => r.period_month === selectedMonth),
    [rows, selectedMonth],
  );

  const stats = useMemo(() => {
    const clients = new Set(monthRows.map((r) => r.referred_user_id)).size;
    const qualified = monthRows.filter((r) => r.eligible).length;
    const spend = monthRows.reduce((s, r) => s + Number(r.spend_usd || 0), 0);
    const commission = monthRows.reduce((s, r) => s + Number(r.commission_bdt || 0), 0);
    return { clients, qualified, spend, commission };
  }, [monthRows]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Referral link copy হয়েছে");
    } catch {
      toast.error("Copy করা যায়নি — link টা manually copy করুন");
    }
  };

  const lastSynced = useMemo(() => {
    const times = (rows as any[])
      .map((r) => (r.synced_at ? new Date(r.synced_at).getTime() : 0))
      .filter((t) => t > 0);
    return times.length > 0 ? new Date(Math.max(...times)) : null;
  }, [rows]);



  const downloadCsv = () => {
    const csvRows = [
      ["Month", "Client", "Ad account", "Account ID", "Spend (USD)", "Qualified", "Rate (৳ per $1)", "Commission (৳)"],
      ...(rows as any[]).map((r) => [
        monthLabel(r.period_month),
        r.referred_name ?? "",
        r.account_name ?? "",
        r.account_ref ?? "",
        Number(r.spend_usd || 0).toFixed(2),
        r.eligible ? "Yes" : "No",
        Number(r.rate_bdt || 0).toFixed(2),
        Number(r.commission_bdt || 0).toFixed(2),
      ]),
    ];
    const csv = csvRows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `referral-commission-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const submitPayout = async () => {
    const amount = Math.round(Number(payoutAmount) * 100) / 100;
    if (!amount || amount <= 0) {
      toast.error("সঠিক amount দিন");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("request_referral_payout_bdt", { p_amount: amount });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string } | null;
      if (!res?.ok) throw new Error(res?.error === "insufficient_balance" ? "Available balance-এর বেশি" : "Request তৈরি হয়নি");
      toast.success("Payout request পাঠানো হয়েছে");
      setPayoutOpen(false);
      setPayoutAmount("");
      queryClient.invalidateQueries({ queryKey: ["referral-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["referral-available-bdt"] });
    } catch (err: any) {
      toast.error(err?.message || "Request পাঠানো যায়নি");
    } finally {
      setSubmitting(false);
    }
  };

  if (!enabledForMe || settings?.enabled === false) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          আপনার account-এ referral program চালু নেই।
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gift className="h-6 w-6 text-primary" /> Referral Program
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          আপনার link দিয়ে আসা client-এর যেই ad account-এ মাসে {usd(minSpend)} বা তার বেশি spend হবে, সেই account-এর
          পুরো spend-এর প্রতি $1-এ {bdt(rate)} commission পাবেন — মাস শেষে payment।
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your referral link</CardTitle>
          <CardDescription>এই link দিয়ে signup করলেই client আপনার সাথে যুক্ত হবে</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input readOnly value={link} className="font-mono text-sm" />
            <Button onClick={copyLink} disabled={!code} className="shrink-0">
              <Copy className="h-4 w-4 mr-2" /> Copy link
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Code: {code ?? "—"}</Badge>
            <Badge variant="secondary">Rate: {bdt(rate)} per $1 spend</Badge>
            <Badge variant="secondary">Minimum: {usd(minSpend)} per ad account / month</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="Referred clients" value={String(stats.clients)} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Month spend" value={usd(stats.spend)} />
        <StatCard icon={<Gift className="h-4 w-4" />} label="Qualified accounts" value={String(stats.qualified)} />
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Month commission" value={bdt(stats.commission)} />
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Ad account wise commission</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              প্রতিদিন রাত ১২টায় system নিজে থেকে spend আপডেট করে
              {lastSynced ? ` — সর্বশেষ: ${format(lastSynced, "dd MMM yyyy, hh:mm a")}` : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Month</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9" />
            </div>

            <Button size="sm" variant="outline" onClick={downloadCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPayoutOpen(true)} disabled={available <= 0}>
              <Wallet className="h-4 w-4 mr-2" /> Withdraw {bdt(available)}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : monthRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              এই মাসের কোনো data এখনো আসেনি — রাত ১২টার update-এর পর দেখা যাবে।
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Ad account</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Qualified</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthRows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.referred_name ?? "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.account_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.account_ref ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-right">{usd(r.spend_usd)}</TableCell>
                    <TableCell className="text-right">
                      {r.eligible ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Yes</Badge>
                      ) : (
                        <Badge variant="outline">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{bdt(r.rate_bdt)}</TableCell>
                    <TableCell className="text-right font-medium">{bdt(r.commission_bdt)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={5} className="font-semibold">
                    {monthLabel(selectedMonth)} total
                  </TableCell>
                  <TableCell className="text-right font-bold">{bdt(stats.commission)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payout requests</CardTitle>
          <CardDescription>মাস শেষ হওয়া commission withdraw করা যাবে</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">এখনো কোনো payout request নেই</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payouts as any[]).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(p.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(p.amount_bdt || 0) > 0 ? bdt(p.amount_bdt) : usd(p.amount_usd)}
                    </TableCell>
                    <TableCell className="capitalize">{p.status}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.admin_note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw referral commission</DialogTitle>
            <DialogDescription>Available: {bdt(available)} — admin approve করলে payment দেওয়া হবে।</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payout-amount">Amount (BDT)</Label>
            <Input
              id="payout-amount"
              type="number"
              step="0.01"
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
              placeholder={available.toFixed(2)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitPayout} disabled={submitting}>
              {submitting ? "Sending..." : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <p className="text-xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
