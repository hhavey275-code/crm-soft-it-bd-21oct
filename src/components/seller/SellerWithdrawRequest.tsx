import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Banknote, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function SellerWithdrawRequest() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setAmount(""); setNote(""); };

  const handleSubmit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    if (!user?.id) { toast.error("Not signed in"); return; }
    setSubmitting(true);
    try {
      const { error } = await (supabase as any).from("seller_transactions").insert({
        seller_id: user.id,
        type: "withdraw",
        bdt_amount: amt,
        usdt_amount: 0,
        rate: 0,
        description: note?.trim() || null,
        status: "pending",
        entry_by_name: profile?.full_name || profile?.email || "Self-request",
      });
      if (error) throw error;

      // Notify admins
      const { data: admins } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "superadmin"] as any);
      if (admins?.length) {
        const sellerName = profile?.full_name || profile?.email || "Seller";
        await (supabase as any).from("notifications").insert(
          admins.map((a: any) => ({
            user_id: a.user_id,
            type: "seller_withdraw_request",
            title: "Seller Withdraw Request",
            message: `${sellerName} requested withdraw of ৳${amt.toLocaleString()}.${note ? ` Note: ${note}` : ""}`,
          }))
        );
      }

      toast.success("Withdraw request submitted! Awaiting admin approval.");
      qc.invalidateQueries({ queryKey: ["seller-transactions"] });
      reset();
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-rose-600 border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950">
          <Banknote className="h-4 w-4 mr-1" /> Request Withdraw
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Withdraw (BDT)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Amount (৳ BDT)</Label>
            <Input
              type="number"
              inputMode="decimal"
              placeholder="e.g. 50000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea
              placeholder="Bank / reference / reason..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Submit korle admin er approval lagbe. Approve hole apnar Due/Advance balance theke minus hobe.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Submitting…</> : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
