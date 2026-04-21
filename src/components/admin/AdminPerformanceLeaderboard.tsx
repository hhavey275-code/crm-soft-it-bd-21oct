import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy } from "lucide-react";
import { AdminMetric, formatResponseTime } from "@/lib/adminMetrics";

export function AdminPerformanceLeaderboard({ metrics }: { metrics: AdminMetric[] }) {
  if (metrics.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No activity in this period
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Top-Ups ✓</TableHead>
              <TableHead className="text-right">Top-Ups ✗</TableHead>
              <TableHead className="text-right">Accounts</TableHead>
              <TableHead className="text-right">Hold Solved</TableHead>
              <TableHead className="text-right">Chat</TableHead>
              <TableHead className="text-right">Avg Resp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map((m, i) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  {i === 0 ? (
                    <Trophy className="h-4 w-4 text-primary" />
                  ) : (
                    <span className="text-muted-foreground">{i + 1}</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{m.user_name}</TableCell>
                <TableCell className="text-right font-semibold">{m.total}</TableCell>
                <TableCell className="text-right text-success">{m.topupsApproved}</TableCell>
                <TableCell className="text-right text-destructive">{m.topupsRejected}</TableCell>
                <TableCell className="text-right">{m.accountsAssigned}</TableCell>
                <TableCell className="text-right">{m.failedSolved}</TableCell>
                <TableCell className="text-right">{m.chatReplies}</TableCell>
                <TableCell className="text-right">{formatResponseTime(m.avgResponseSec)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
