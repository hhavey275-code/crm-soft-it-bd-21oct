import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ImageIcon, Download } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { openProof } from "@/lib/proofUrl";

type Props = { sellerId: string };

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

export function SellerNotInSheetCard({ sellerId }: Props) {
  const [open, setOpen] = useState(true);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["seller-self-not-in-sheet", sellerId],
    enabled: !!sellerId,
    queryFn: async (): Promise<Row[]> => {
      const { data: banks } = await (supabase as any)
        .from("bank_accounts")
        .select("id, bank_name")
        .eq("seller_id", sellerId);
      const bankIds = (banks || []).map((b: any) => b.id);
      if (!bankIds.length) return [];
      const bankMap: Record<string, any> = {};
      (banks || []).forEach((b: any) => { bankMap[b.id] = b; });

      const { data: reqs } = await (supabase as any)
        .from("top_up_requests")
        .select("id, amount, bdt_amount, created_at, proof_url, telegram_forwarded, user_id, bank_account_id, forward_dismissed_at")
        .in("bank_account_id", bankIds)
        .eq("status", "approved")
        .order("created_at", { ascending: false });
      const candidates = (reqs || []).filter((r: any) => !r.forward_dismissed_at);
      if (!candidates.length) return [];

      const reqIds = candidates.map((r: any) => r.id);
      // Use SECURITY DEFINER RPC so we also detect mirrors that belong to a
      // different/old seller (RLS would otherwise hide them and produce false
      // "not in sheet" alerts).
      const { data: mirrors } = await (supabase as any).rpc("topup_requests_mirrored", {
        p_ids: reqIds,
      });
      const mirrorSet = new Set((mirrors || []).map((m: any) => m.top_up_request_id));

      const missing = candidates.filter((r: any) => !mirrorSet.has(r.id));
      if (!missing.length) return [];

      const userIds = [...new Set(missing.map((r: any) => r.user_id as string))] as string[];
      const { data: profiles } = await supabase
        .from("profiles").select("user_id, full_name, email").in("user_id", userIds);
      const pMap: Record<string, any> = {};
      (profiles || []).forEach((p: any) => { pMap[p.user_id] = p; });

      return missing.map((r: any) => ({
        ...r,
        bank_name: bankMap[r.bank_account_id]?.bank_name,
        client_name: pMap[r.user_id]?.full_name || pMap[r.user_id]?.email || r.user_id.slice(0, 8),
        mirror_present: false,
      }));
    },
  });

  if (isLoading || !rows || rows.length === 0) return null;

  const exportExcel = () => {
    const data = rows.map((r) => ({
      Date: format(new Date(r.created_at), "yyyy-MM-dd HH:mm"),
      Client: r.client_name,
      Bank: r.bank_name || "—",
      "USD Amount": Number(r.amount || 0),
      "BDT Amount": Number(r.bdt_amount || 0),
      "Telegram Forwarded": r.telegram_forwarded ? "Yes" : "No",
      "Proof URL": r.proof_url || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Not In Sheet");
    XLSX.writeFile(wb, `not-in-sheet-${format(new Date(), "yyyy-MM-dd-HHmm")}.xlsx`);
    toast.success("Exported");
  };

  return (
    <Card className="border-rose-500/40 bg-rose-500/5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="p-3 md:p-4 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 flex-1 text-left">
                <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <CardTitle className="text-sm">
                  Not in Seller Sheet ({rows.length})
                </CardTitle>
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <Button size="sm" variant="outline" className="h-7" onClick={exportExcel}>
              <Download className="h-3.5 w-3.5 mr-1" /> Excel
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            এই top-up গুলো আপনার bank-এ approved হয়েছে কিন্তু seller sheet-এ যোগ হয়নি। Admin-কে জানান।
          </p>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="p-3 md:p-4 pt-2 space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-xs">
                <div className="flex flex-col min-w-[180px]">
                  <span className="font-medium">{format(new Date(r.created_at), "MMM d, yyyy HH:mm")} · {r.client_name}</span>
                  <span className="text-muted-foreground">
                    ${Number(r.amount || 0).toLocaleString()} · ৳{Number(r.bdt_amount || 0).toLocaleString()} · {r.bank_name || "—"}
                  </span>
                </div>
                {r.proof_url && (
                  <Button size="sm" variant="ghost" className="h-7 px-2" asChild>
                    <a href={r.proof_url} onClick={(e) => { e.preventDefault(); openProof(r.proof_url); }} target="_blank" rel="noreferrer"><ImageIcon className="h-3.5 w-3.5" /></a>
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
