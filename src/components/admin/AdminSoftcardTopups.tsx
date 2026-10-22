import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Check, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { decideSoftcardTopup, sweepSoftcardTopups } from "@/lib/softcards.functions";

export function AdminSoftcardTopups() {
  const qc = useQueryClient();
  const decide = useServerFn(decideSoftcardTopup);
  const sweep = useServerFn(sweepSoftcardTopups);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectRow, setRejectRow] = useState<any>(null);
  const [note, setNote] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["softcard-topups"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("softcard_topups").select("*").order("created_at", { ascending: false }).limit(200);
      return (data ?? []) as any[];
    },
    refetchInterval: 15000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["softcard-topups"] });
    qc.invalidateQueries({ queryKey: ["system-logs"] });
    qc.invalidateQueries({ queryKey: ["admin-softcard-pending-count"] });
  };

  const runSweep = async (silent = false) => {
    try {
      const r = await sweep();
      if (!silent) toast.success(`আবার চেষ্টা: ${r.retried}, অটো-অ্যাপ্রুভ: ${r.matched}`);
      refresh();
    } catch (e: any) { if (!silent) toast.error(e?.message ?? "Failed"); }
  };

  // Retry failed callbacks + auto-match every minute while page is open
  useEffect(() => {
    runSweep(true);
    const t = setInterval(() => runSweep(true), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (row: any, action: "approve" | "reject", n?: string) => {
    setBusy(row.deposit_id);
    try {
      const r = await decide({ data: { deposit_id: row.deposit_id, action, note: n } });
      if (r.ok) toast.success(action === "approve" ? "Approved — SoftCards-এ জানানো হয়েছে" : "Rejected — SoftCards-এ জানানো হয়েছে");
      else toast.error("SoftCards-এ পাঠানো যায়নি, pending রাখা হলো — অটো আবার চেষ্টা হবে");
      setRejectRow(null); setNote("");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    setBusy(null);
    refresh();
  };

  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  const money = (r: any) => r.local_amount_minor != null ? `${(r.local_amount_minor / 100).toLocaleString()} ${r.local_currency ?? ""}` : "—";
  const when = (r: any) => format(new Date(r.source_created_at ?? r.created_at), "dd MMM yyyy, h:mm a");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => runSweep(false)}><RefreshCw className="mr-1 h-4 w-4" />Retry / Auto-check</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pending ({pending.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Client</TableHead><TableHead>USD</TableHead><TableHead>Local</TableHead>
              <TableHead>Reference</TableHead><TableHead>Time</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pending.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">কোনো pending রিকোয়েস্ট নেই</TableCell></TableRow>}
              {pending.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.client_name ?? "—"}<div className="text-[10px] text-muted-foreground">{r.deposit_id}</div></TableCell>
                  <TableCell className="font-semibold">${(r.amount_cents / 100).toFixed(2)}</TableCell>
                  <TableCell>{money(r)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.reference ?? "—"}</TableCell>
                  <TableCell className="text-xs">{when(r)}</TableCell>
                  <TableCell className="text-right">
                    {r.pending_action ? (
                      <div className="space-y-1">
                        <Badge variant="destructive">{r.pending_action} পাঠানো যায়নি ({r.callback_attempts}x)</Badge>
                        <div className="max-w-[220px] truncate text-[10px] text-destructive">{r.last_callback_error}</div>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" disabled={busy === r.deposit_id} onClick={() => act(r, "approve")}><Check className="mr-1 h-3 w-3" />Approve</Button>
                        <Button size="sm" variant="outline" className="text-destructive" disabled={busy === r.deposit_id} onClick={() => { setRejectRow(r); setNote(""); }}><X className="mr-1 h-3 w-3" />Reject</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableBody>
              {done.slice(0, 50).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.client_name ?? "—"}</TableCell>
                  <TableCell>${(r.amount_cents / 100).toFixed(2)}</TableCell>
                  <TableCell>{money(r)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.reference ?? "—"}</TableCell>
                  <TableCell><Badge variant={r.status === "approved" ? "default" : "destructive"}>{r.status}{r.decided_via === "auto" ? " (auto)" : ""}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.status === "rejected" ? r.pending_note : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!rejectRow} onOpenChange={(o) => !o && setRejectRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject — {rejectRow?.client_name}</DialogTitle></DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reject করার কারণ লিখুন..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectRow(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!note.trim() || busy === rejectRow?.deposit_id} onClick={() => act(rejectRow, "reject", note)}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
