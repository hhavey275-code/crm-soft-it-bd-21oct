import { Fragment, useMemo, useState } from "react";
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
import { Copy, Download, Gift, Users, Wallet, TrendingUp } from "lucide-react";
import { buildReferralLink } from "@/lib/referral";

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (d: string) => format(new Date(`${d}T00:00:00`), "MMMM yyyy");

export function ClientReferral() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["referral-settings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["referral_default_rate", "referral_min_monthly_spend", "referral_enabled"]);
      const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value ?? ""]));
      return {
        defaultRate: Number(map["referral_default_rate"] ?? 0.1) || 0.1,
        minSpend: Number(map["referral_min_monthly_spend"] ?? 3000) || 3000,
        enabled: (map["referral_enabled"] ?? "on") !== "off",
      };
    },
  });

  const { data: earnings = [], isLoading } = useQuery({
    queryKey: ["referral-earnings", user?.id],
    queryFn: async () => {
      // Refresh the running month before reading.
      await supabase.rpc("recalc_referral_earnings", {});
      const { data } = await supabase
        .from("referral_monthly_earnings")
        .select("*")
        .eq("referrer_id", user!.id)
        .order("period_month", { ascending: false });
      return data ?? [];
    },
    enabled: !!user,
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
    enabled: !!user,
  });

  const { data: available = 0 } = useQuery({
    queryKey: ["referral-available", user?.id, payouts.length, earnings.length],
    queryFn: async () => {
      const { data } = await supabase.rpc("referral_available_balance", { p_referrer: user!.id });
      return Number(data ?? 0);
    },
    enabled: !!user,
  });

  const code = (profile as any)?.referral_code as string | undefined;
  const rate = Number((profile as any)?.referral_rate_usd ?? settings?.defaultRate ?? 0.1);
  const minSpend = settings?.minSpend ?? 3000;
  const link = code ? buildReferralLink(code) : "";

  const currentMonth = format(new Date(), "yyyy-MM-01");

  const stats = useMemo(() => {
    const referred = new Set(earnings.map((e: any) => e.referred_user_id)).size;
    const totalEarned = earnings.reduce((s: number, e: any) => s + Number(e.commission_usd || 0), 0);
    const paid = payouts
      .filter((p: any) => p.status === "approved")
      .reduce((s: number, p: any) => s + Number(p.amount_usd || 0), 0);
    const thisMonthSpend = earnings
      .filter((e: any) => e.period_month === currentMonth)
      .reduce((s: number, e: any) => s + Number(e.spend_usd || 0), 0);
    return { referred, totalEarned, paid, thisMonthSpend };
  }, [earnings, payouts, currentMonth]);

  const byMonth = useMemo(() => {
    const map = new Map<string, { month: string; spend: number; eligibleSpend: number; commission: number; rows: any[] }>();
    for (const e of earnings as any[]) {
      const key = e.period_month;
      const cur = map.get(key) ?? { month: key, spend: 0, eligibleSpend: 0, commission: 0, rows: [] };
      cur.spend += Number(e.spend_usd || 0);
      if (e.eligible) cur.eligibleSpend += Number(e.spend_usd || 0);
      cur.commission += Number(e.commission_usd || 0);
      (cur.rows as any[]).push(e);
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [earnings]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Referral link copy হয়েছে");
    } catch {
      toast.error("Copy করা যায়নি — link টা manually copy করুন");
    }
  };

  const downloadCsv = () => {
    const rows = [
      ["Month", "Referred Client", "Spend (USD)", "Minimum Met", "Rate per $1", "Commission (USD)", "Status"],
      ...(earnings as any[]).map((e) => [
        monthLabel(e.period_month),
        e.referred_name ?? "",
        Number(e.spend_usd || 0).toFixed(2),
        e.eligible ? "Yes" : "No",
        Number(e.rate_used || 0).toFixed(4),
        Number(e.commission_usd || 0).toFixed(2),
        e.status,
      ]),
    ];
    const csv = rows
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
    const amount = Number(payoutAmount);
    if (!amount || amount <= 0) {
      toast.error("সঠিক amount দিন");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("request_referral_payout", { p_amount: amount });
      if (error) throw error;
      const res = data as { ok?: boolean } | null;
      if (!res?.ok) throw new Error("Request তৈরি হয়নি");
      toast.success("Payout request পাঠানো হয়েছে — admin approve করলে wallet-এ যোগ হবে");
      setPayoutOpen(false);
      setPayoutAmount("");
      queryClient.invalidateQueries({ queryKey: ["referral-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["referral-available"] });
    } catch (err: any) {
      toast.error(err?.message || "Request পাঠানো যায়নি");
    } finally {
      setSubmitting(false);
    }
  };

  if (settings && !settings.enabled) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          Referral program এখন বন্ধ আছে।
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
          আপনার link দিয়ে নতুন client join করলে তার ad spend-এর প্রতি $1-এ {money(rate)} commission পাবেন —
          শুধু সেই মাসে, যেই মাসে সে কমপক্ষে {money(minSpend)} spend করে।
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your referral link</CardTitle>
          <CardDescription>এই link শেয়ার করুন — এই link দিয়ে signup করলেই client আপনার সাথে যুক্ত হবে</CardDescription>
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
            <Badge variant="secondary">Rate: {money(rate)} per $1 spend</Badge>
            <Badge variant="secondary">Minimum: {money(minSpend)} / month</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="Referred clients" value={String(stats.referred)} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="This month spend" value={money(stats.thisMonthSpend)} />
        <StatCard icon={<Gift className="h-4 w-4" />} label="Total commission" value={money(stats.totalEarned)} />
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Available to withdraw" value={money(available)} />
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Month-wise commission</CardTitle>
            <CardDescription>চলতি মাস running হিসাব, মাস শেষ হলে withdraw করা যাবে</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={downloadCsv} disabled={earnings.length === 0}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
            <Button size="sm" onClick={() => setPayoutOpen(true)} disabled={available <= 0}>
              <Wallet className="h-4 w-4 mr-2" /> Withdraw to wallet
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : earnings.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              এখনো কোনো referral নেই — link শেয়ার করে শুরু করুন।
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Referred client</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Eligible</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMonth.map((m) => (
                  <Fragment key={m.month}>
                    {m.rows.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{monthLabel(e.period_month)}</TableCell>
                        <TableCell>{e.referred_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{money(e.spend_usd)}</TableCell>
                        <TableCell className="text-right">
                          {e.eligible ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600">Yes</Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{money(e.rate_used)}</TableCell>
                        <TableCell className="text-right font-medium">{money(e.commission_usd)}</TableCell>
                        <TableCell className="capitalize">{e.status}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50">
                      <TableCell colSpan={5} className="font-semibold">
                        {monthLabel(m.month)} total
                      </TableCell>
                      <TableCell className="text-right font-bold">{money(m.commission)}</TableCell>
                      <TableCell />
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payout requests</CardTitle>
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
                    <TableCell className="text-right">{money(p.amount_usd)}</TableCell>
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
            <DialogDescription>
              Available: {money(available)} — admin approve করলে এই USD আপনার main wallet-এ যোগ হবে।
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payout-amount">Amount (USD)</Label>
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
