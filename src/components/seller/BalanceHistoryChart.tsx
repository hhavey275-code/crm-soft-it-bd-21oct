/**
 * BalanceHistoryChart — visualizes how a seller's Due/Advance balance built up
 * over time, transaction by transaction.
 *
 * - Line chart (recharts) with Y=0 reference line.
 *   - Above 0 (Advance) → green segment
 *   - Below 0 (Due)     → red segment
 * - Compact timeline list of the last N movements:
 *     "Apr 22  +৳800,000 BDT Payment → Due −৳48,09,340"
 *
 * Only approved (or legacy null/empty status) transactions contribute, matching
 * the running-total math in `computeDueAdvanceRunning`.
 */

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, ChevronDown, ChevronUp, ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDueAdvance } from "@/lib/sellerRunningTotal";

interface Props {
  transactions: any[] | undefined;
  defaultOpen?: boolean;
  /** How many recent movements to show in the timeline list. */
  timelineLimit?: number;
}

interface Step {
  id: string;
  date: Date;
  type: string;
  delta: number;        // signed BDT delta applied to balance
  balance: number;      // running balance after this step
  meta?: string;        // small detail e.g. "32694 × 126"
}

function getTypeLabel(type: string) {
  switch (type) {
    case "bdt_payment": return "BDT Payment";
    case "client_topup": return "Client Top-Up";
    case "usdt_received": return "USDT Given";
    case "withdraw": return "Withdraw";
    default: return type;
  }
}

function getTypeIcon(type: string) {
  switch (type) {
    case "bdt_payment":
    case "client_topup":
      return <ArrowDownLeft className="h-3 w-3" />;
    case "usdt_received":
      return <ArrowUpRight className="h-3 w-3" />;
    case "withdraw":
      return <RefreshCw className="h-3 w-3" />;
    default:
      return <TrendingUp className="h-3 w-3" />;
  }
}

function formatBdtSigned(value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}৳${Math.abs(Math.round(value)).toLocaleString("en-IN")}`;
}

export function BalanceHistoryChart({ transactions, defaultOpen = true, timelineLimit = 12 }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const steps = useMemo<Step[]>(() => {
    if (!transactions || transactions.length === 0) return [];
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    let running = 0;
    const out: Step[] = [];
    for (const t of sorted) {
      const status = (t.status || "approved").toLowerCase();
      if (status !== "approved") continue;
      let delta = 0;
      let meta: string | undefined;
      if (t.type === "bdt_payment" || t.type === "client_topup") {
        delta = Number(t.bdt_amount || 0);
      } else if (t.type === "withdraw") {
        delta = -Number(t.bdt_amount || 0);
      } else if (t.type === "usdt_received") {
        const usdt = Number(t.usdt_amount || 0);
        const rate = Number(t.rate || 0);
        delta = -(usdt * rate);
        if (usdt && rate) meta = `${usdt.toLocaleString()} × ${rate}`;
      } else {
        continue;
      }
      running += delta;
      out.push({
        id: t.id,
        date: new Date(t.created_at),
        type: t.type,
        delta,
        balance: running,
        meta,
      });
    }
    return out;
  }, [transactions]);

  const chartData = useMemo(
    () =>
      steps.map((s, i) => ({
        idx: i,
        dateLabel: format(s.date, "MMM d"),
        balance: Math.round(s.balance),
        type: s.type,
        delta: s.delta,
        fullDate: format(s.date, "MMM d, yyyy HH:mm"),
      })),
    [steps]
  );

  const recent = useMemo(() => steps.slice(-timelineLimit).reverse(), [steps, timelineLimit]);

  const finalBalance = steps.length ? steps[steps.length - 1].balance : 0;
  const finalFmt = formatDueAdvance(finalBalance);

  if (!transactions || transactions.length === 0) return null;

  return (
    <Card className="border bg-card/80 backdrop-blur-sm overflow-hidden rounded-xl">
      <CardHeader className="p-4 pb-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm md:text-base font-bold tracking-tight">Balance History</CardTitle>
              <p className="text-[11px] text-muted-foreground truncate">
                কিভাবে Due / Advance build up হলো
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                "text-sm md:text-base font-extrabold tabular-nums px-2 py-0.5 rounded-md",
                finalFmt.isZero
                  ? "text-muted-foreground bg-muted"
                  : finalFmt.isAdvance
                  ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                  : "text-rose-700 dark:text-rose-400 bg-rose-500/10"
              )}
            >
              {finalFmt.isZero ? "৳0" : finalFmt.isAdvance ? `Adv ${finalFmt.text}` : `Due ${finalFmt.text}`}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} className="h-8 w-8 p-0">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="p-3 md:p-4 space-y-4">
          {/* Chart */}
          <div className="h-48 md:h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={56}
                  tickFormatter={(v: number) => {
                    const abs = Math.abs(v);
                    if (abs >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
                    if (abs >= 100000) return `${(v / 100000).toFixed(1)}L`;
                    if (abs >= 1000) return `${(v / 1000).toFixed(0)}K`;
                    return String(v);
                  }}
                  className="text-muted-foreground"
                />
                <ReferenceLine y={0} strokeDasharray="3 3" className="stroke-muted-foreground/60" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: any, _n, p: any) => {
                    const v = Number(value);
                    const sign = v >= 0 ? "Advance " : "Due ";
                    return [`${sign}${formatBdtSigned(v)}`, getTypeLabel(p.payload.type)];
                  }}
                  labelFormatter={(_l, payload: any) => payload?.[0]?.payload?.fullDate ?? ""}
                />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke={finalBalance >= 0 ? "hsl(142 76% 36%)" : "hsl(0 72% 51%)"}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Timeline list */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Recent movements
            </p>
            <ul className="space-y-1.5">
              {recent.map((s) => {
                const fmt = formatDueAdvance(s.balance);
                const positive = s.delta >= 0;
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 text-[12px] py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors"
                  >
                    <span className="text-muted-foreground w-14 shrink-0 tabular-nums">
                      {format(s.date, "MMM d")}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0",
                        positive
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {getTypeIcon(s.type)}
                      {getTypeLabel(s.type)}
                    </span>
                    <span
                      className={cn(
                        "font-bold tabular-nums shrink-0",
                        positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {formatBdtSigned(s.delta)}
                    </span>
                    {s.meta && (
                      <span className="text-[10px] text-muted-foreground hidden sm:inline truncate">
                        ({s.meta})
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground shrink-0">→</span>
                    <span
                      className={cn(
                        "font-extrabold tabular-nums shrink-0",
                        fmt.isZero
                          ? "text-muted-foreground"
                          : fmt.isAdvance
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {fmt.isZero ? "৳0" : fmt.isAdvance ? `Adv ${fmt.text}` : `Due ${fmt.text}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
