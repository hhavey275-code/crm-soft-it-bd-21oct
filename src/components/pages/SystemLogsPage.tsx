import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Search, Filter, Globe } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { format } from "date-fns";

const ACTION_COLORS: Record<string, string> = {
  "Top-Up Approved": "bg-green-500/10 text-green-700 border-green-200",
  "Top-Up Rejected": "bg-red-500/10 text-red-700 border-red-200",
  "Top-Up On Hold": "bg-amber-500/10 text-amber-700 border-amber-200",
  "Top-Up Submitted": "bg-cyan-500/10 text-cyan-700 border-cyan-200",
  "Spend Cap Updated": "bg-blue-500/10 text-blue-700 border-blue-200",
  "Ad Account Assigned": "bg-purple-500/10 text-purple-700 border-purple-200",
  "Ad Account Unassigned": "bg-orange-500/10 text-orange-700 border-orange-200",
  "Ad Account Deleted": "bg-red-500/10 text-red-700 border-red-200",
  "Ad Account Requested": "bg-sky-500/10 text-sky-700 border-sky-200",
  "Ad Account Request Approved": "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  "Ad Account Request Rejected": "bg-rose-500/10 text-rose-700 border-rose-200",
  "BM Access Requested": "bg-violet-500/10 text-violet-700 border-violet-200",
  "BM Access Approved": "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  "BM Access Rejected": "bg-rose-500/10 text-rose-700 border-rose-200",
  "Client Status Changed": "bg-yellow-500/10 text-yellow-700 border-yellow-200",
  "Bank Added": "bg-teal-500/10 text-teal-700 border-teal-200",
  "Bank Updated": "bg-indigo-500/10 text-indigo-700 border-indigo-200",
  "Failed Top-Up Retry": "bg-orange-500/10 text-orange-700 border-orange-200",
  "Failed Top-Up Refund": "bg-pink-500/10 text-pink-700 border-pink-200",
  "Meta Update": "bg-blue-500/10 text-blue-700 border-blue-200",
  "Withdraw": "bg-amber-500/10 text-amber-700 border-amber-200",
  "Auto Top-Up": "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  "Auto Top-Up Failed": "bg-red-500/10 text-red-700 border-red-200",
  "Top-Up Failed": "bg-red-500/10 text-red-700 border-red-200",
};

// Extract IP from details string like "... [IP: 1.2.3.4]"
function extractIp(details: string | null): { ip: string | null; cleanDetails: string } {
  if (!details) return { ip: null, cleanDetails: details || "" };
  const match = details.match(/\s*\[IP:\s*([^\]]+)\]/);
  if (match) {
    return {
      ip: match[1].trim(),
      cleanDetails: details.replace(match[0], "").trim(),
    };
  }
  return { ip: null, cleanDetails: details };
}

export default function SystemLogsPage() {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const { data: logs, isLoading } = useQuery({
    queryKey: ["system-logs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("system_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const uniqueActions = [...new Set(logs?.map((l: any) => l.action) ?? [])];

  const filtered = logs?.filter((log: any) => {
    const matchSearch =
      !search ||
      log.user_name?.toLowerCase().includes(search.toLowerCase()) ||
      log.action?.toLowerCase().includes(search.toLowerCase()) ||
      log.details?.toLowerCase().includes(search.toLowerCase());
    const matchAction = actionFilter === "all" || log.action === actionFilter;
    return matchSearch && matchAction;
  }) ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <ScrollText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold">System Log</h1>
            <p className="text-xs md:text-sm text-muted-foreground">All CRM activity logs</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, action, details, IP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {uniqueActions.map((action: string) => (
                <SelectItem key={action} value={action}>{action}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ScrollText className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No logs found</p>
            </CardContent>
          </Card>
        ) : isMobile ? (
          <div className="space-y-3">
            {filtered.map((log: any) => {
              const { ip, cleanDetails } = extractIp(log.details);
              return (
                <Card key={log.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className={ACTION_COLORS[log.action] || ""}>{log.action}</Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(log.created_at), "dd MMM yyyy, hh:mm a")}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{log.user_name || "System"}</p>
                    {cleanDetails && <p className="text-xs text-muted-foreground">{cleanDetails}</p>}
                    {ip && (
                      <div className="flex items-center gap-1.5">
                        <Globe className="h-3 w-3 text-blue-500" />
                        <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{ip}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Proxy IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((log: any) => {
                  const { ip, cleanDetails } = extractIp(log.details);
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.created_at), "dd MMM yyyy, hh:mm a")}
                      </TableCell>
                      <TableCell className="font-medium">{log.user_name || "System"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ACTION_COLORS[log.action] || ""}>{log.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{cleanDetails || "—"}</TableCell>
                      <TableCell>
                        {ip ? (
                          <span className="inline-flex items-center gap-1 text-xs font-mono text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                            <Globe className="h-3 w-3" />
                            {ip}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
