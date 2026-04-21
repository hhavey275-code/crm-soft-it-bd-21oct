import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Landmark, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seller: { user_id: string; full_name?: string | null; email?: string | null } | null;
}

export function ManageSellerUsdtBanksDialog({ open, onOpenChange, seller }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // All active banks
  const { data: allBanks } = useQuery({
    queryKey: ["all-active-banks"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("bank_accounts")
        .select("id, bank_name, account_number, account_name")
        .eq("status", "active")
        .order("bank_name");
      return (data as any[]) ?? [];
    },
  });

  // Currently assigned USDT banks for this seller
  const { data: currentAssignments } = useQuery({
    queryKey: ["seller-usdt-banks-admin", seller?.user_id],
    enabled: open && !!seller?.user_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("seller_usdt_banks")
        .select("bank_account_id")
        .eq("seller_id", seller!.user_id);
      return ((data as any[]) ?? []).map((r) => r.bank_account_id);
    },
  });

  useEffect(() => {
    if (open && currentAssignments) {
      setSelected(new Set(currentAssignments));
    }
  }, [open, currentAssignments]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!seller?.user_id) throw new Error("No seller selected");
      const current = new Set(currentAssignments || []);
      const next = selected;

      const toAdd = Array.from(next).filter((id) => !current.has(id));
      const toRemove = Array.from(current).filter((id) => !next.has(id));

      if (toAdd.length) {
        const rows = toAdd.map((bid) => ({ seller_id: seller.user_id, bank_account_id: bid }));
        const { error } = await (supabase as any).from("seller_usdt_banks").insert(rows);
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await (supabase as any)
          .from("seller_usdt_banks")
          .delete()
          .eq("seller_id", seller.user_id)
          .in("bank_account_id", toRemove);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("USDT banks updated!");
      queryClient.invalidateQueries({ queryKey: ["seller-usdt-banks-admin", seller?.user_id] });
      queryClient.invalidateQueries({ queryKey: ["seller-usdt-banks", seller?.user_id] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4" />
            USDT Banks — {seller?.full_name || seller?.email}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          <p className="text-xs text-muted-foreground">
            এই seller-এর কাছে USDT পাঠানোর জন্য কোন কোন bank অ্যাকাউন্ট ব্যবহার করা যাবে select করুন।
          </p>
          {allBanks?.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">No active bank accounts available.</p>
          )}
          {allBanks?.map((b: any) => {
            const isChecked = selected.has(b.id);
            return (
              <label
                key={b.id}
                className="flex items-center gap-3 p-2.5 rounded-md border hover:bg-muted/40 cursor-pointer transition-colors"
              >
                <Checkbox checked={isChecked} onCheckedChange={() => toggle(b.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{b.bank_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {b.account_number} {b.account_name ? `· ${b.account_name}` : ""}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
