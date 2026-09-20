import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Download, RefreshCw, Gift, Copy } from "lucide-react";
import { buildReferralLink } from "@/lib/referral";

const usd = (n: number) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const bdt = (n: number) =>
  `৳${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthLabel = (d: string) => format(new Date(`${d}T00:00:00`), "MMM yyyy");

export function AdminReferrals() {
  const [saving, setSaving] = useState(false);
  const [minInput, setMinInput] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));

  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ["referral-settings-admin"],
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

  const { data: clients = [], refetch: refetchClients } = useQuery({
    queryKey: ["admin-referral-clients"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, referral_code, referral_enabled, referral_rate_bdt, referred_by")
        .order("full_name", { ascending: true });
      return data ?? [];
    },
  });

  const { data: rows = [], refetch: refetchRows } = useQuery({
    queryKey: ["admin-referral-account-earnings"],
    queryFn: async () => {
      const { data } = await supabase
        .from("referral_account_earnings")
        .select("*")
        .order("period_month", { ascending: false });
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
    for (const p of clients as any[]) m.set(p.user_id, p.full_name || p.email || p.user_id);
    return m;
  }, [clients]);

  const referredCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of clients as any[]) {
      if (p.referred_by) m.set(p.referred_by, (m.get(p.referred_by) ?? 0) + 1);
    }
    return m;
  }, [clients]);

  const commissionByReferrer = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows as any[]) {
      m.set(r.referrer_id, (m.get(r.referrer_id) ?? 0) + Number(r.commission_bdt || 0));
    }
    return m;
  }, [rows]);

  const enabledClients = useMemo(
    () => (clients as any[]).filter((p) => p.referral_enabled),
    [clients],
  );

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? (clients as any[]).filter(
          (p) =>
            (p.full_name ?? "").toLowerCase().includes(q) ||
            (p.email ?? "").toLowerCase().includes(q) ||
            (p.referral_code ?? "").toLowerCase().includes(q),
        )
      : enabledClients;
    return list.slice(0, 100);
  }, [clients, enabledClients, search]);

  const monthRows = useMemo(
    () => (rows as any[]).filter((r) => r.period_month === `${month}-01`),
    [rows, month],
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

  const setClientReferral = async (userId: string, enabled: boolean, rateBdt: number) => {
    setBusy(userId);
    const { data, error } = await supabase.rpc("set_client_referral", {
      p_user_id: userId,
      p_enabled: enabled,
      p_rate_bdt: rateBdt,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const res = data as { ok?: boolean; error?: string } | null;
    if (!res?.ok) {
      toast.error(res?.error === "invalid_rate" ? "সঠিক rate দিন (৳ per $1)" : res?.error || "Update হয়নি");
      return;
    }
    toast.success(enabled ? "Referral চালু হয়েছে" : "Referral বন্ধ হয়েছে");
    refetchClients();
  };

  const refreshSpend = async (referrerId: string) => {
    setBusy(`sync-${referrerId}`);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Session পাওয়া যায়নি");
      const res = await fetch("/api/referral-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ month, referrerId }),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Update করা যায়নি");
      toast.success(`${json.updated ?? 0} টি ad account update হয়েছে`);
      refetchRows();
    } catch (err: any) {
      toast.error(err?.message || "Update করা যায়নি");
    } finally {
      setBusy(null);
    }
  };

  const review = async (id: string, approve: boolean) => {
    const note = window.prompt(approve ? "Approve note (optional)" : "Reject reason") ?? "";
    if (!approve && !note.trim()) {
      toast.error("Reject করার কারণ দিন");
      return;
    }
    setBusy(id);
    const { data, error } = await supabase.rpc("review_referral_payout_bdt", {
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
    toast.success(approve ? "Approve হয়েছে" : "Reject হয়েছে");
    refetchPayouts();
  };

  const downloadCsv = () => {
    const csvRows = [
      ["Month", "Referrer", "Client", "Ad account", "Spend (USD)", "Qualified", "Rate (BDT per $1)", "Commission (BDT)"],
      ...(rows as any[]).map((r) => [
        monthLabel(r.period_month),
        nameById.get(r.referrer_id) ?? r.referrer_id,
        r.referred_name ?? "",
        `${r.account_name ?? ""} (${r.account_ref ?? ""})`,
        Number(r.spend_usd || 0).toFixed(2),
        r.eligible ? "Yes" : "No",
        Number(r.rate_bdt || 0).toFixed(2),
        Number(r.commission_bdt || 0).toFixed(2),
      ]),
    ];
    const csv = csvRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
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
          প্রতি client-কে আলাদা করে referral enable করুন এবং টাকায় commission rate ঠিক করে দিন
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Program settings</CardTitle>
          <CardDescription>প্রতি ad account-এর minimum monthly spend এবং program on/off</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Minimum monthly spend (per ad account)</Label>
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
            <p className="text-xs text-muted-foreground">এখন: {usd(settings?.minSpend ?? 3000)} / ad account / month</p>
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
                {settings?.enabled === false
                  ? "সবার জন্য বন্ধ"
                  : "শুধু যেসব client-কে enable করা হয়েছে তারা দেখবে"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients">Clients ({enabledClients.length})</TabsTrigger>
          <TabsTrigger value="commission">Commission</TabsTrigger>
          <TabsTrigger value="payouts">
            Payouts{pendingPayouts.length > 0 ? ` (${pendingPayouts.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-4 space-y-3">
          <Input
            placeholder="Client নাম / email / code দিয়ে খুঁজুন (referral enable করতে)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Referral</TableHead>
                    <TableHead>Rate (৳ per $1)</TableHead>
                    <TableHead>Link</TableHead>
                    <TableHead className="text-right">Referred</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        {search ? "কোনো client পাওয়া যায়নি" : "এখনো কারো referral enable করা হয়নি — উপরে খুঁজুন"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredClients.map((p: any) => (
                      <ClientRow
                        key={p.user_id}
                        client={p}
                        busy={busy === p.user_id}
                        referred={referredCount.get(p.user_id) ?? 0}
                        commission={commissionByReferrer.get(p.user_id) ?? 0}
                        onSave={(enabled, rate) => void setClientReferral(p.user_id, enabled, rate)}
                        onSync={() => void refreshSpend(p.user_id)}
                        syncing={busy === `sync-${p.user_id}`}
                      />
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
              <Label>Month</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => refetchRows()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Reload
            </Button>
            <Button variant="outline" onClick={downloadCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referrer</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Ad account</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Qualified</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        এই মাসের কোনো data নেই — Clients tab থেকে Update চাপুন
                      </TableCell>
                    </TableRow>
                  ) : (
                    monthRows.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell>{nameById.get(r.referrer_id) ?? "—"}</TableCell>
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
                        <TableCell className="text-right font-medium">{bdt(r.commission_bdt)}</TableCell>
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
                        <TableCell className="text-right">
                          {Number(p.amount_bdt || 0) > 0 ? bdt(p.amount_bdt) : usd(p.amount_usd)}
                        </TableCell>
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

function ClientRow({
  client,
  busy,
  syncing,
  referred,
  commission,
  onSave,
  onSync,
}: {
  client: any;
  busy: boolean;
  syncing: boolean;
  referred: number;
  commission: number;
  onSave: (enabled: boolean, rate: number) => void;
  onSync: () => void;
}) {
  const [rate, setRate] = useState(String(client.referral_rate_bdt ?? ""));

  const copy = async () => {
    if (!client.referral_code) return;
    try {
      await navigator.clipboard.writeText(buildReferralLink(client.referral_code));
      toast.success("Link copy হয়েছে");
    } catch {
      toast.error("Copy করা যায়নি");
    }
  };

  const saveRate = () => {
    const value = Math.round(Number(rate) * 100) / 100;
    if (!value || value <= 0) {
      toast.error("সঠিক rate দিন");
      return;
    }
    onSave(true, value);
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{client.full_name || "—"}</div>
        <div className="text-xs text-muted-foreground">{client.email}</div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={!!client.referral_enabled}
            disabled={busy}
            onCheckedChange={(next) => {
              const value = Math.round(Number(rate) * 100) / 100;
              if (next && (!value || value <= 0)) {
                toast.error("আগে rate (৳ per $1) দিন");
                return;
              }
              onSave(next, value);
            }}
          />
          <span className="text-xs text-muted-foreground">{client.referral_enabled ? "On" : "Off"}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex gap-2">
          <Input
            type="number"
            step="0.01"
            className="h-8 w-24"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={saveRate}>
            Save
          </Button>
        </div>
      </TableCell>
      <TableCell>
        {client.referral_code ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs">
              {client.referral_code}
            </Badge>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copy}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">{referred}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <span>{bdt(commission)}</span>
          {client.referral_enabled ? (
            <Button size="sm" variant="ghost" disabled={syncing} onClick={onSync}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
