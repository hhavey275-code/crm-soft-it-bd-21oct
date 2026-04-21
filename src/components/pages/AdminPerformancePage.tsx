import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, Activity, CheckCircle2, AlertTriangle, MessageCircle, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Navigate } from "react-router-dom";
import {
  computeAdminMetrics,
  categoryBreakdown,
  dailyActivity,
  formatResponseTime,
  type SystemLogRow,
  type ChatMessageRow,
} from "@/lib/adminMetrics";
import {
  AdminPerformanceLeaderboard,
} from "@/components/admin/AdminPerformanceLeaderboard";
import {
  CategoryBreakdownChart,
  DailyActivityChart,
} from "@/components/admin/AdminActivityChart";

const RANGE_DAYS: Record<string, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export default function AdminPerformancePage() {
  const { isSuperAdmin, isAdmin } = useAuth();
  const [range, setRange] = useState<string>("30d");
  const [selectedAdmin, setSelectedAdmin] = useState<string>("all");

  const sinceISO = useMemo(() => {
    const d = new Date();
    if (range === "today") {
      d.setHours(0, 0, 0, 0);
    } else {
      d.setDate(d.getDate() - RANGE_DAYS[range]);
    }
    return d.toISOString();
  }, [range]);

  // Fetch admin user_ids + names
  const { data: admins = [] } = useQuery({
    queryKey: ["perf-admins"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles" as any)
        .select("user_id, role")
        .in("role", ["admin", "superadmin"] as any);

      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", ids);
      const map = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
      return ids.map((id: string) => ({
        user_id: id,
        name: (map.get(id) as any)?.full_name || (map.get(id) as any)?.email || "Admin",
      }));
    },
    staleTime: 5 * 60_000,
  });

  const adminIdSet = useMemo(() => new Set(admins.map(a => a.user_id)), [admins]);

  // System logs in range
  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["perf-system-logs", sinceISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_logs")
        .select("id, action, details, user_id, user_name, created_at")
        .gte("created_at", sinceISO)
        .order("created_at", { ascending: false })
        .limit(5000);
      return (data ?? []) as SystemLogRow[];
    },
    staleTime: 60_000,
  });

  // Chat messages in range (lightweight: just the cols we need)
  const { data: chatMsgs = [] } = useQuery({
    queryKey: ["perf-chat-msgs", sinceISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, conversation_id, sender_id, created_at")
        .gte("created_at", sinceISO)
        .order("created_at", { ascending: true })
        .limit(5000);
      return (data ?? []) as ChatMessageRow[];
    },
    staleTime: 60_000,
  });

  const metrics = useMemo(
    () => computeAdminMetrics(logs, chatMsgs, adminIdSet),
    [logs, chatMsgs, adminIdSet]
  );

  const filteredMetrics = useMemo(
    () => (selectedAdmin === "all" ? metrics : metrics.filter(m => m.user_id === selectedAdmin)),
    [metrics, selectedAdmin]
  );

  const totals = useMemo(() => {
    const src = filteredMetrics;
    return {
      total: src.reduce((s, m) => s + m.total, 0),
      topupsApproved: src.reduce((s, m) => s + m.topupsApproved, 0),
      accountsAssigned: src.reduce((s, m) => s + m.accountsAssigned, 0),
      failedSolved: src.reduce((s, m) => s + m.failedSolved, 0),
      chatReplies: src.reduce((s, m) => s + m.chatReplies, 0),
      avgResponse:
        src.filter(m => m.avgResponseSec != null).length > 0
          ? src
              .filter(m => m.avgResponseSec != null)
              .reduce((s, m) => s + (m.avgResponseSec ?? 0), 0) /
            src.filter(m => m.avgResponseSec != null).length
          : null,
    };
  }, [filteredMetrics]);

  const breakdown = useMemo(
    () => categoryBreakdown(logs, selectedAdmin === "all" ? undefined : selectedAdmin),
    [logs, selectedAdmin]
  );

  const trend = useMemo(
    () => dailyActivity(logs, selectedAdmin === "all" ? undefined : selectedAdmin, 30),
    [logs, selectedAdmin]
  );

  const recentActivity = useMemo(() => {
    const src = selectedAdmin === "all" ? logs : logs.filter(l => l.user_id === selectedAdmin);
    return src.slice(0, 50);
  }, [logs, selectedAdmin]);

  // Access guard — superadmin only
  if (!isSuperAdmin && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Trophy className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              Admin Performance
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              Track team activity, response time and workload
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Select value={selectedAdmin} onValueChange={setSelectedAdmin}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Admins</SelectItem>
                {admins.map(a => (
                  <SelectItem key={a.user_id} value={a.user_id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryCard icon={Activity} label="Total Actions" value={totals.total} loading={logsLoading} />
          <SummaryCard icon={CheckCircle2} label="Top-Ups Approved" value={totals.topupsApproved} loading={logsLoading} />
          <SummaryCard icon={CheckCircle2} label="Accounts Delivered" value={totals.accountsAssigned} loading={logsLoading} />
          <SummaryCard icon={AlertTriangle} label="Hold Solved" value={totals.failedSolved} loading={logsLoading} />
          <SummaryCard icon={MessageCircle} label="Chat Replies" value={totals.chatReplies} loading={logsLoading} />
          <SummaryCard icon={Clock} label="Avg Response" value={formatResponseTime(totals.avgResponse)} loading={logsLoading} />
        </div>

        {/* Leaderboard */}
        {selectedAdmin === "all" && (
          <div>
            <h2 className="text-sm font-semibold mb-2">Leaderboard</h2>
            <AdminPerformanceLeaderboard metrics={metrics} />
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CategoryBreakdownChart data={breakdown} />
          <DailyActivityChart data={trend} />
        </div>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Recent Activity {selectedAdmin !== "all" && `— ${admins.find(a => a.user_id === selectedAdmin)?.name ?? ""}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-2">
              {recentActivity.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No activity</p>
              )}
              <div className="space-y-2">
                {recentActivity.map(log => (
                  <div key={log.id} className="flex items-start gap-3 p-2 rounded-md border bg-card">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{log.action}</Badge>
                        <span className="text-xs font-medium">{log.user_name ?? "—"}</span>
                      </div>
                      {log.details && (
                        <p className="text-xs text-muted-foreground mt-1 break-words">{log.details}</p>
                      )}
                    </div>
                    <span
                      className="text-[10px] text-muted-foreground whitespace-nowrap"
                      title={format(new Date(log.created_at), "PPpp")}
                    >
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: any;
  label: string;
  value: number | string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] md:text-xs text-muted-foreground">{label}</span>
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <p className="text-lg md:text-2xl font-bold mt-1">{loading ? "…" : value}</p>
      </CardContent>
    </Card>
  );
}
