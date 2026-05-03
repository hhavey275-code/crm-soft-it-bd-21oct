import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, AlertTriangle, Loader2, CheckCircle2, XCircle, ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

type Props = { sellerId: string; sellerName: string };

type Row = {
  id: string;
  amount: number | null;
  bdt_amount: number | null;
  created_at: string;
  proof_url: string | null;
  telegram_forwarded: boolean | null;
  user_id: string;
  bank_account_id: string;
  bank_name?: string;
  client_name?: string;
  mirror_present?: boolean;
};

export function SellerNotForwardedCard({ sellerId, sellerName }: Props) {
  const qc = useQueryClient();
  const [results, setResults] = useState<Record<string, "ok" | "skipped" | "error" | "loading">>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const toggleOne = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = (all: boolean, ids: string[]) => {
    setSelected(all ? new Set(ids) : new Set());
  };

  const dismissIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("top_up_requests")
        .update({
          forward_dismissed_at: new Date().toISOString(),
          forward_dismissed_by: userData?.user?.id ?? null,
        })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Removed ${ids.length} from list`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["seller-not-forwarded", sellerId] });
      refetch();
    } catch (e: any) {
      toast.error(e.message || "Failed to remove");
    } finally {
      setDeleting(false);
    }
  };

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ["seller-not-forwarded", sellerId],
    queryFn: async (): Promise<Row[]> => {
      // 1) seller's banks that have a Telegram group
      const { data: banks } = await (supabase as any)
        .from("bank_accounts")
        .select("id, bank_name, telegram_group_id")
        .eq("seller_id", sellerId)
        .not("telegram_group_id", "is", null);
      const eligibleBanks = (banks || []).filter((b: any) => (b.telegram_group_id || "").trim().length > 0);
      if (eligibleBanks.length === 0) return [];
      const bankIds = eligibleBanks.map((b: any) => b.id);
      const bankMap: Record<string, any> = {};
      eligibleBanks.forEach((b: any) => { bankMap[b.id] = b; });

      // 2) approved top-up requests on those banks where forwarded != true and not dismissed
      const { data: reqs } = await (supabase as any)
        .from("top_up_requests")
        .select("id, amount, bdt_amount, created_at, proof_url, telegram_forwarded, user_id, bank_account_id, forward_dismissed_at")
        .in("bank_account_id", bankIds)
        .eq("status", "approved")
        .not("proof_url", "is", null)
        .is("forward_dismissed_at", null)
        .order("created_at", { ascending: false });
      const candidates = (reqs || []).filter((r: any) => r.telegram_forwarded !== true);
      if (candidates.length === 0) return [];

      // 3) Check seller_transactions mirrors for these requests
      const reqIds = candidates.map((r: any) => r.id);
      const { data: mirrors } = await (supabase as any)
        .from("seller_transactions")
        .select("top_up_request_id")
        .in("top_up_request_id", reqIds);
      const mirrorSet = new Set((mirrors || []).map((m: any) => m.top_up_request_id));

      // 4) Fetch client names
      const userIds = [...new Set(candidates.map((r: any) => r.user_id as string))] as string[];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      const pMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { pMap[p.user_id] = p; });

      return candidates.map((r: any) => ({
        ...r,
        bank_name: bankMap[r.bank_account_id]?.bank_name,
        client_name: pMap[r.user_id]?.full_name || pMap[r.user_id]?.email || r.user_id.slice(0, 8),
        mirror_present: mirrorSet.has(r.id),
      }));
    },
    enabled: !!sellerId,
  });

  const forwardOne = async (id: string): Promise<"ok" | "skipped" | "error"> => {
    setResults((p) => ({ ...p, [id]: "loading" }));
    try {
      const { data, error } = await supabase.functions.invoke("forward-proof", { body: { request_id: id } });
      if (error) throw error;
      if (data?.skipped) {
        setResults((p) => ({ ...p, [id]: "skipped" }));
        setReasons((p) => ({ ...p, [id]: data.reason || "skipped" }));
        return "skipped";
      }
      setResults((p) => ({ ...p, [id]: "ok" }));
      return "ok";
    } catch (e: any) {
      setResults((p) => ({ ...p, [id]: "error" }));
      setReasons((p) => ({ ...p, [id]: e.message || "error" }));
      return "error";
    }
  };

  const forwardAll = async () => {
    if (!rows?.length) return;
    setBulkRunning(true);
    let ok = 0;
    for (const r of rows) {
      const status = await forwardOne(r.id);
      if (status === "ok") ok++;
    }
    setBulkRunning(false);
    toast.success(`Forwarded ${ok} of ${rows.length}`);
    qc.invalidateQueries({ queryKey: ["seller-not-forwarded", sellerId] });
    qc.invalidateQueries({ queryKey: ["seller-transactions"] });
    refetch();
  };

  if (isLoading) return null;
  if (!rows || rows.length === 0) return null;

  return (
    <Card className="border-rose-500/40 bg-rose-500/5">
      <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          Not Forwarded ({rows.length})
          <span className="text-xs text-muted-foreground font-normal">
            — bank+Telegram assigned but never sent for {sellerName}
          </span>
        </CardTitle>
        <Button size="sm" variant="destructive" onClick={forwardAll} disabled={bulkRunning} className="gap-1.5">
          {bulkRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Forward All
        </Button>
      </CardHeader>
      <CardContent className="p-4 pt-2 space-y-2">
        {rows.map((r) => {
          const st = results[r.id];
          return (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-xs">
              <div className="flex flex-col min-w-[200px]">
                <span className="font-medium">{format(new Date(r.created_at), "MMM d, yyyy HH:mm")} · {r.client_name}</span>
                <span className="text-muted-foreground">
                  ${Number(r.amount || 0).toLocaleString()} · ৳{Number(r.bdt_amount || 0).toLocaleString()} · {r.bank_name || "—"}
                  {!r.mirror_present && <span className="ml-2 text-rose-600 font-semibold">· not in seller sheet</span>}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {r.proof_url && (
                  <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
                    <a href={r.proof_url} target="_blank" rel="noreferrer"><ImageIcon className="h-3.5 w-3.5" /></a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={st === "ok" ? "outline" : "default"}
                  className="h-7"
                  disabled={st === "loading" || st === "ok"}
                  onClick={() => forwardOne(r.id)}
                >
                  {st === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                    st === "ok" ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Sent</> :
                    st === "skipped" ? <><XCircle className="h-3.5 w-3.5 mr-1" />Skipped</> :
                    st === "error" ? <><XCircle className="h-3.5 w-3.5 mr-1" />Retry</> :
                    <><Send className="h-3.5 w-3.5 mr-1" />Forward</>}
                </Button>
              </div>
              {(st === "skipped" || st === "error") && reasons[r.id] && (
                <span className="basis-full text-[11px] text-muted-foreground">{reasons[r.id]}</span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
