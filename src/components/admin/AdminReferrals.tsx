import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import { Download, RefreshCw, Gift } from "lucide-react";

const money = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (d: string) => format(new Date(`${d}T00:00:00`), "MMM yyyy");

export function AdminReferrals() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [minInput, setMinInput] = useState("");
  const [recalcMonth, setRecalcMonth] = useState(format(new Date(), "yyyy-MM"));
  const [busy, setBusy] = useState<string | null>(null);

  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ["referral-settings-admin"],
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

  const { data: earnings = [], refetch: refetchEarnings } = useQuery({
    queryKey: ["admin-referral-earnings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_monthly_earnings")
        .select("*")
        .order("period_month", { ascending: false });
      return data ?? [];
    },
  });

  const { data: referrers = [], refetch: refetchReferrers } = useQuery({
    queryKey: ["admin-referrers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, referral_code, referral_rate_usd, referred_by")
        .not("referral_code", "is", null);
      return data ?? [];
    },
  });

  const { data: payouts = [], refetch: refetchPayouts } = useQuery({
    queryKey: ["admin-referral-payouts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_payout_requests")
        .select("*")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of referrers as any[]) m.set(p.user_id, p.full_name || p.email || p.user_id);
    return m;
  }, [referrers]);

  const referredCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of referrers as any[]) {
      if (p.referred_by) m.set(p.referred_by, (m.get(p.referred_by) ?? 0) + 1);
    }
    return m;
  }, [referrers]);

  const commissionByReferrer = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of earnings as any[]) {
      m.set(e.referrer_id, (m.get(e.referrer_id) ?? 0) + Number(e.commission_usd || 0));
    }
    return m;
  }, [earnings]);

  const activeReferrers = useMemo(
    () => (referrers as any[]).filter((p) => (referredCount.get(p.user_id) ?? 0) > 0),
    [referrers, referredCount],
  );

  const saveSetting = async (key: string, value: string) => {
    setSaving(true);
    const { error } = await supabase.from("site_settings").upsert({ key, value }, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    refetchSettings();
  };

  const saveOverride = async (userId: string, value: string) => {
    const rate = value.trim() === "" ? null : Number(value);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
      toast.error("সঠিক rate দিন");
      return;
    }
    const { error } = await supabase.from("profiles").update({ referral_rate_usd: rate }).eq("user_id", userId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Rate update হয়েছে");
    refetchReferrers();
  };

  const recalc = async () => {
    setBusy("recalc");
    const { error } = await supabase.rpc("recalc_referral_earnings", { p_month: `${recalcMonth}-01` });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Commission recalculate হয়েছে");
    refetchEarnings();
  };

  const review = async (id: string, approve: boolean) => {
    const note = window.prompt(approve ? "Approve note (optional)" : "Reject reason") ?? "";
    if (!approve && !note.trim()) {
      toast.error("Reject করার কারণ দিন");
      return;
    }
    setBusy(id);
    const { data, error } = await supabase.rpc("review_referral_payout", {
      p_id: id,
      p_approve: approve,
      p_note: note || undefined,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as { ok?: boolean; error?: string } | null;
    if (!res?.ok) {
      toast.error(res?.error || "Action ব্যর্থ হয়েছে");
      return;
    }
    toast.success(approve ? "Approve হয়েছে — wallet-এ credit হয়েছে" : "Reject হয়েছে");
    refetchPayouts();
    queryClient.invalidateQueries({ queryKey: ["admin-referral-earnings"] });
  };

  const downloadCsv = () => {
    const rows = [
      ["Month", "Referrer", "Referred client", "Spend (USD)", "Eligible", "Rate", "Commission (USD)", "Status"],
      ...(earnings as any[]).map((e) => [
        monthLabel(e.period_month),
        nameById.get(e.referrer_id) ?? e.referrer_id,
        e.referred_name ?? "",
        Number(e.spend_usd || 0).toFixed(2),
        e.eligible ? "Yes" : "No",
        Number(e.rate_used || 0).toFixed(4),
        Number(e.commission_usd || 0).toFixed(2),
        e.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `referral-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pendingPayouts = (payouts as any[]).filter((p) => p.status === "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gift className="h-6 w-6 text-primary" /> Referral Program
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Referrer, commission এবং payout request management
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Program settings</CardTitle>
          <CardDescription>Global default rate, minimum monthly spend এবং program on/off</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Default rate (per $1 spend)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                placeholder={String(settings?.defaultRate ?? 0.1)}
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={saving || !rateInput}
                onClick={() => void saveSetting("referral_default_rate", rateInput)}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">এখন: {money(settings?.defaultRate ?? 0.1)}</p>
          </div>
          <div className="space-y-2">
            <Label>Minimum monthly spend</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder={String(settings?.minSpend ?? 3000)}
                value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={saving || !minInput}
                onClick={() => void saveSetting("referral_min_monthly_spend", minInput)}
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">এখন: {money(settings?.minSpend ?? 3000)} / month</p>
          </div>
          <div className="space-y-2">
            <Label>Program enabled</Label>
            <div className="flex items-center gap-3">
              <Switch
                checked={settings?.enabled !== false}
                disabled={saving}
                onCheckedChange={(next) => void saveSetting("referral_enabled", next ? "on" : "off")}
              />
              <span className="text-sm text-muted-foreground">
                {settings?.enabled === false ? "Client-দের কাছে বন্ধ" : "Client-রা দেখতে পাচ্ছে"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="referrers">
        <TabsList>
          <TabsTrigger value="referrers">Referrers ({activeReferrers.length})</TabsTrigger>
          <TabsTrigger value="commission">Commission</TabsTrigger>
          <TabsTrigger value="payouts">
            Payouts{pendingPayouts.length > 0 ? ` (${pendingPayouts.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="referrers" className="mt-4">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referrer</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Referred</TableHead>
                    <TableHead className="text-right">Total commission</TableHead>
                    <TableHead>Rate override</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeReferrers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        এখনো কোনো active referrer নেই
                      </TableCell>
                    </TableRow>
                  ) : (
                    activeReferrers.map((p: any) => (
                      <TableRow key={p.user_id}>
                        <TableCell>
                          <div className="font-medium">{p.full_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{p.email}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{p.referral_code}</TableCell>
                        <TableCell className="text-right">{referredCount.get(p.user_id) ?? 0}</TableCell>
                        <TableCell className="text-right">{money(commissionByReferrer.get(p.user_id) ?? 0)}</TableCell>
                        <TableCell>
                          <RateEditor
                            initial={p.referral_rate_usd}
                            fallback={settings?.defaultRate ?? 0.1}
                            onSave={(v) => void saveOverride(p.user_id, v)}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commission" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Recalculate month</Label>
              <Input type="month" value={recalcMonth} onChange={(e) => setRecalcMonth(e.target.value)} />
            </div>
            <Button variant="outline" onClick={recalc} disabled={busy === "recalc"}>
              <RefreshCw className={`h-4 w-4 mr-2 ${busy === "recalc" ? "animate-spin" : ""}`} /> Recalculate
            </Button>
            <Button variant="outline" onClick={downloadCsv} disabled={earnings.length === 0}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Referrer</TableHead>
                    <TableHead>Referred client</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Eligible</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {earnings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        কোনো data নেই — উপরে Recalculate চাপুন
                      </TableCell>
                    </TableRow>
                  ) : (
                    (earnings as any[]).map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{monthLabel(e.period_month)}</TableCell>
                        <TableCell>{nameById.get(e.referrer_id) ?? "—"}</TableCell>
                        <TableCell>{e.referred_name ?? "—"}</TableCell>
                        <TableCell className="text-right">{money(e.spend_usd)}</TableCell>
                        <TableCell className="text-right">
                          {e.eligible ? (
                            <Badge className="bg-emerald-600 hover:bg-emerald-600">Yes</Badge>
                          ) : (
                            <Badge variant="outline">No</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">{money(e.commission_usd)}</TableCell>
                        <TableCell className="capitalize">{e.status}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payouts" className="mt-4">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Referrer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        কোনো payout request নেই
                      </TableCell>
                    </TableRow>
                  ) : (
                    (payouts as any[]).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(p.created_at), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell>{nameById.get(p.referrer_id) ?? p.referrer_id}</TableCell>
                        <TableCell className="text-right">{money(p.amount_usd)}</TableCell>
                        <TableCell className="capitalize">{p.status}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.admin_note ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {p.status === "pending" ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" disabled={busy === p.id} onClick={() => void review(p.id, true)}>
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy === p.id}
                                onClick={() => void review(p.id, false)}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RateEditor({
  initial,
  fallback,
  onSave,
}: {
  initial: number | null;
  fallback: number;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial === null || initial === undefined ? "" : String(initial));
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        step="0.01"
        className="h-8 w-24"
        placeholder={String(fallback)}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button size="sm" variant="ghost" onClick={() => onSave(value)}>
        Save
      </Button>
    </div>
  );
}
