import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { format, startOfDay, endOfDay, subDays } from "date-fns";
import { toast } from "sonner";
import { Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatBdt } from "@/lib/sellerRunningTotal";

type Row = {
  kind: "client_topup" | "seller_txn";
  id: string;
  request_id?: string; // top_up id (for client_topup)
  seller_id: string | null;
  seller_name: string;
  bank_label: string;
  bdt: number;
  created_at: string;
  forwarded: boolean;
  type_label: string;
  payment_kind?: string;
  bank_account_id?: string | null;
  proof_url?: string | null;
  reference?: string | null;
};

export function ForwardAudit() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  const { data: rows, isLoading } = useQuery<Row[]>({
    queryKey: ["forward-audit", date],
    queryFn: async () => {
      const day = new Date(date);
      const from = startOfDay(day).toISOString();
      const to = endOfDay(day).toISOString();

      // Approved client top-ups in the day, where bank has telegram_group_id assigned.
      const [{ data: topups }, { data: sellerTxns }, { data: banks }, { data: sellers }] = await Promise.all([
        supabase
          .from("top_up_requests")
          .select("id, bdt_amount, bank_account_id, proof_url, payment_reference, telegram_forwarded, updated_at, created_at, status")
          .eq("status", "approved")
          .gte("updated_at", from).lte("updated_at", to),
        (supabase as any)
          .from("seller_transactions")
          .select("id, seller_id, type, bdt_amount, usdt_amount, rate, bank_account_id, proof_url, description, telegram_forwarded, status, created_at, reviewed_at")
          .in("type", ["bdt_payment", "usdt_received", "withdraw", "tenant_payment"])
          .eq("status", "approved")
          .gte("created_at", from).lte("created_at", to),
        supabase.from("bank_accounts").select("id, bank_name, account_number, telegram_group_id, seller_id"),
        supabase.from("profiles").select("user_id, full_name, email"),
      ]);

      const bankMap = new Map<string, any>((banks || []).map((b: any) => [b.id, b]));
      const sellerMap = new Map<string, any>((sellers || []).map((s: any) => [s.user_id, s]));

      const out: Row[] = [];

      // Client top-ups: only count rows whose receiving bank has a Telegram group.
      for (const r of (topups || []) as any[]) {
        const bank = r.bank_account_id ? bankMap.get(r.bank_account_id) : null;
        if (!bank?.telegram_group_id) continue;
        const seller = bank?.seller_id ? sellerMap.get(bank.seller_id) : null;
        out.push({
          kind: "client_topup",
          id: r.id,
          request_id: r.id,
          seller_id: bank?.seller_id || null,
          seller_name: seller?.full_name || seller?.email || (bank?.seller_id ? bank.seller_id.slice(0, 8) : "—"),
          bank_label: bank ? `${bank.bank_name} ****${(bank.account_number || "").slice(-4)}` : "—",
          bdt: Number(r.bdt_amount || 0),
          created_at: r.updated_at || r.created_at,
          forwarded: r.telegram_forwarded === true,
          type_label: "Client Top-up",
        });
      }

      // Seller transactions: only those where group can be resolved (bank has group OR usdt_received, which uses seller's own group).
      for (const t of (sellerTxns || []) as any[]) {
        const bank = t.bank_account_id ? bankMap.get(t.bank_account_id) : null;
        const expectsForward = !!bank?.telegram_group_id || t.type === "usdt_received";
        if (!expectsForward) continue;
        const seller = t.seller_id ? sellerMap.get(t.seller_id) : null;
        out.push({
          kind: "seller_txn",
          id: t.id,
          seller_id: t.seller_id,
          seller_name: seller?.full_name || seller?.email || (t.seller_id ? t.seller_id.slice(0, 8) : "—"),
          bank_label: bank ? `${bank.bank_name} ****${(bank.account_number || "").slice(-4)}` : t.type === "usdt_received" ? "USDT (seller group)" : "—",
          bdt: Number(t.bdt_amount || (t.usdt_amount || 0) * (t.rate || 0)),
          created_at: t.reviewed_at || t.created_at,
          forwarded: t.telegram_forwarded === true,
          type_label: t.type === "bdt_payment" ? "Seller Payment" : t.type === "usdt_received" ? "USDT Received" : t.type === "withdraw" ? "Withdraw" : "Tenant Payment",
          payment_kind: t.type,
          bank_account_id: t.bank_account_id,
          proof_url: t.proof_url,
          reference: t.description,
        });
      }

      return out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    staleTime: 15_000,
  });

  const summary = useMemo(() => {
    const r = rows || [];
    const expected = r.length;
    const forwarded = r.filter((x) => x.forwarded).length;
    const missing = expected - forwarded;
    const missingBdt = r.filter((x) => !x.forwarded).reduce((s, x) => s + x.bdt, 0);
    return { expected, forwarded, missing, missingBdt };
  }, [rows]);

  const resend = useMutation({
    mutationFn: async (row: Row) => {
      if (row.kind === "client_topup") {
        const { data, error } = await supabase.functions.invoke("forward-proof", { body: { request_id: row.request_id } });
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.functions.invoke("forward-seller-proof", {
        body: {
          seller_transaction_id: row.id,
          payment_kind: row.payment_kind === "tenant_payment" ? "bdt_payment" : row.payment_kind,
          proof_url: row.proof_url || null,
          seller_id: row.seller_id,
          seller_name: row.seller_name,
          bdt_amount: row.bdt,
          bank_account_id: row.bank_account_id || undefined,
          reference: row.reference || null,
          withdraw_note: row.payment_kind === "withdraw" ? row.reference : undefined,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.skipped) toast.info(`Skipped: ${data.reason || "already forwarded"}`);
      else toast.success("Resent to Telegram!");
      queryClient.invalidateQueries({ queryKey: ["forward-audit"] });
    },
    onError: (e: any) => toast.error(`Resend failed: ${e.message}`),
  });

  const missingRows = (rows || []).filter((r) => !r.forwarded);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-[180px]"
        />
        <Button size="sm" variant="outline" onClick={() => setDate(format(new Date(), "yyyy-MM-dd"))}>Today</Button>
        <Button size="sm" variant="outline" onClick={() => setDate(format(subDays(new Date(), 1), "yyyy-MM-dd"))}>Yesterday</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Expected to forward</div>
          <div className="text-2xl font-bold">{summary.expected}</div>
        </CardContent></Card>
        <Card className="border-green-500/40"><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" /> Forwarded</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.forwarded}</div>
        </CardContent></Card>
        <Card className={summary.missing > 0 ? "border-destructive" : ""}><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> Missing</div>
          <div className="text-2xl font-bold text-destructive">{summary.missing}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">Missing BDT</div>
          <div className="text-2xl font-bold">{formatBdt(summary.missingBdt)}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Missing forwards ({missingRows.length})</h3>
            {missingRows.length > 0 && (
              <Button
                size="sm"
                disabled={resend.isPending}
                onClick={async () => {
                  for (const r of missingRows) {
                    try { await resend.mutateAsync(r); } catch { /* continue */ }
                  }
                }}
              >
                <Send className="h-3 w-3 mr-1" /> Resend all
              </Button>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Seller</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead className="text-right">BDT</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : (rows || []).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No payments expected to forward on this day</TableCell></TableRow>
              ) : (rows || []).map((r) => (
                <TableRow key={`${r.kind}-${r.id}`} className={!r.forwarded ? "bg-destructive/5" : ""}>
                  <TableCell className="text-xs">{format(new Date(r.created_at), "HH:mm")}</TableCell>
                  <TableCell className="text-xs">{r.type_label}</TableCell>
                  <TableCell className="text-xs">{r.seller_name}</TableCell>
                  <TableCell className="text-xs">{r.bank_label}</TableCell>
                  <TableCell className="text-right font-medium">{formatBdt(r.bdt)}</TableCell>
                  <TableCell>
                    {r.forwarded ? (
                      <Badge variant="default" className="bg-green-500/15 text-green-700 dark:text-green-400 hover:bg-green-500/15">Forwarded</Badge>
                    ) : (
                      <Badge variant="destructive">Missing</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!r.forwarded && (
                      <Button size="sm" variant="outline" disabled={resend.isPending} onClick={() => resend.mutate(r)}>
                        <Send className="h-3 w-3 mr-1" /> Resend
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
