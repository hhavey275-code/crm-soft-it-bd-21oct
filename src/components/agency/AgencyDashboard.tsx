import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/components/MetricCard";
import { Users, Wallet, ArrowUpCircle, MonitorSmartphone, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format, differenceInDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export function AgencyDashboard() {
  const { user } = useAuth();

  const { data: agency } = useQuery({
    queryKey: ["my-agency", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("*").eq("owner_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: agencyWallet } = useQuery({
    queryKey: ["agency-wallet", agency?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("*").eq("agency_id", agency!.id).single();
      return data;
    },
    enabled: !!agency?.id,
  });

  const { data: clients } = useQuery({
    queryKey: ["agency-clients", agency?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, status, company")
        .eq("agency_id", agency!.id);
      return data || [];
    },
    enabled: !!agency?.id,
  });

  const { data: recentTopups } = useQuery({
    queryKey: ["agency-recent-topups", agency?.id],
    queryFn: async () => {
      const clientIds = clients?.map(c => c.user_id) || [];
      if (!clientIds.length) return [];
      const { data } = await supabase
        .from("top_up_requests")
        .select("id, amount, status, created_at, user_id")
        .in("user_id", clientIds)
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(100);
      return data || [];
    },
    enabled: !!(clients && clients.length > 0),
  });

  // Top spenders calculation
  const spenderMap: Record<string, { name: string; total: number }> = {};
  recentTopups?.forEach(t => {
    const client = clients?.find(c => c.user_id === t.user_id);
    const name = client?.full_name || client?.email || "Unknown";
    if (!spenderMap[t.user_id]) spenderMap[t.user_id] = { name, total: 0 };
    spenderMap[t.user_id].total += Number(t.amount);
  });
  const topSpenders = Object.values(spenderMap).sort((a, b) => b.total - a.total).slice(0, 10);
  const top3 = topSpenders.slice(0, 3);

  const COLORS = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--primary) / 0.7)",
    "hsl(var(--primary) / 0.55)",
    "hsl(var(--chart-2) / 0.7)",
    "hsl(var(--chart-3) / 0.7)",
    "hsl(var(--primary) / 0.4)",
    "hsl(var(--chart-2) / 0.5)",
    "hsl(var(--chart-3) / 0.5)",
  ];

  const activeClients = clients?.filter(c => c.status === "active").length || 0;
  const pendingClients = clients?.filter(c => c.status === "pending").length || 0;
  const walletBalance = Number(agencyWallet?.balance || 0);
  const isLowBalance = walletBalance <= 0;

  const subscriptionDaysLeft = agency?.subscription_paid_until
    ? Math.max(0, differenceInDays(new Date(agency.subscription_paid_until), new Date()))
    : 0;
  const isExpired = agency?.subscription_paid_until && new Date(agency.subscription_paid_until) < new Date();

  return (
    <div className="space-y-6">
      {isLowBalance && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4 flex items-center gap-3">
            <span className="text-destructive font-semibold text-sm">⚠️ Please top up fast! Due to insufficient limit, your clients are unable to top up.</span>
          </CardContent>
        </Card>
      )}

      <div>
        <h1 className="text-2xl font-bold text-foreground">{agency?.name || "Agency"} Dashboard</h1>
        <p className="text-muted-foreground">Manage your clients and ad accounts</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard title="Agency Wallet" value={`$${walletBalance.toLocaleString()}`} icon={Wallet} />
        <MetricCard title="Active Clients" value={String(activeClients)} icon={Users} />
        <MetricCard title="Pending Approvals" value={String(pendingClients)} icon={ArrowUpCircle} />
        <MetricCard title="Total Deposited" value={`$${Number(agencyWallet?.total_deposited || 0).toLocaleString()}`} icon={MonitorSmartphone} />
        <MetricCard title="Subscription" value={`${subscriptionDaysLeft} days`} icon={Clock} />
      </div>

      {/* Subscription Alert */}
      {isExpired && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="p-4">
            <span className="text-destructive font-semibold text-sm">⚠️ Your subscription has expired! Please renew to continue service.</span>
          </CardContent>
        </Card>
      )}

      {/* Top Spenders Chart */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Spenders</CardTitle>
          </CardHeader>
          <CardContent>
            {topSpenders.length === 0 ? (
              <p className="text-muted-foreground text-sm">No spending data</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topSpenders} layout="vertical">
                  <XAxis type="number" tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                    {topSpenders.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top 3 List */}
        <Card>
          <CardHeader>
            <CardTitle>Top 3 Clients</CardTitle>
          </CardHeader>
          <CardContent>
            {top3.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data</p>
            ) : (
              <div className="space-y-4">
                {top3.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-lg">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground">Total spending</p>
                    </div>
                    <span className="font-bold text-lg">${s.total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Top-Ups */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Top-Up Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {!recentTopups?.length ? (
            <p className="text-muted-foreground text-sm">No recent top-up requests</p>
          ) : (
            <div className="space-y-3">
              {recentTopups.slice(0, 10).map(t => {
                const client = clients?.find(c => c.user_id === t.user_id);
                return (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{client?.full_name || client?.email || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(t.created_at), "MMM dd, yyyy HH:mm")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">${Number(t.amount).toLocaleString()}</span>
                      <Badge variant="default">{t.status}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
