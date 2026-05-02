import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";

/**
 * Admin tool: insert a manual entry into the archive
 * (`seller_transactions_archive_2026_05`) for a given seller. Because manual
 * entries (bdt_payment / tenant_payment) are auto-mirrored into the Forwarded
 * sheet by `splitBuckets`, this effectively adds a "Forwarded" entry.
 */
export function AddForwardedEntryDialog({
  sellerId,
  sellerName,
  defaults,
}: {
  sellerId: string;
  sellerName: string;
  /** Optional pre-fill values (e.g. parsed from a receipt). */
  defaults?: {
    bdt_amount?: number;
    description?: string;
    created_at?: string; // ISO datetime-local format YYYY-MM-DDTHH:mm
    bank_account_id?: string;
  };
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [bdtAmount, setBdtAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [createdAt, setCreatedAt] = useState<string>("");
  const [bankAccountId, setBankAccountId] = useState<string>("");

  // Load seller's bank accounts for dropdown
  const { data: banks } = useQuery({
    queryKey: ["seller-bank-accounts", sellerId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bank_accounts")
        .select("id, bank_name, account_number, account_name")
        .eq("seller_id", sellerId)
        .order("bank_name");
      if (error) throw error;
      return data as Array<{ id: string; bank_name: string; account_number: string; account_name: string }>;
    },
    enabled: open,
  });

  // Reset form whenever dialog opens
  useEffect(() => {
    if (!open) return;
    setBdtAmount(defaults?.bdt_amount ? String(defaults.bdt_amount) : "");
    setDescription(defaults?.description || "");
    setCreatedAt(
      defaults?.created_at ||
        new Date().toISOString().slice(0, 16), // YYYY-MM-DDTHH:mm
    );
    setBankAccountId(defaults?.bank_account_id || "");
  }, [open, defaults?.bdt_amount, defaults?.description, defaults?.created_at, defaults?.bank_account_id]);

  const handleSubmit = async () => {
    const amt = Number(bdtAmount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid BDT amount");
      return;
    }
    if (!createdAt) {
      toast.error("Pick a date/time");
      return;
    }
    setSubmitting(true);
    try {
      const isoCreated = new Date(createdAt).toISOString();
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("seller_transactions_archive_2026_05")
        .insert({
          seller_id: sellerId,
          type: "bdt_payment", // manual entry → auto-mirrored into Forwarded sheet
          bdt_amount: amt,
          usdt_amount: 0,
          rate: 0,
          description: description || "Manual forwarded entry",
          bank_account_id: bankAccountId || null,
          status: "approved",
          created_at: isoCreated,
          entry_by_name: "Admin (manual archive entry)",
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString(),
        });
      if (error) throw error;
      toast.success(`Forwarded entry added for ${sellerName}: ৳${amt.toLocaleString("en-IN")}`);
      queryClient.invalidateQueries({ queryKey: ["old-seller-bundle", sellerId] });
      queryClient.invalidateQueries({ queryKey: ["archived-sellers"] });
      setOpen(false);
    } catch (e: any) {
      toast.error(`Failed: ${e?.message || String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" size="sm" className="gap-1">
          <Plus className="h-4 w-4" /> Add Forwarded Entry
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Forwarded Entry — {sellerName}</DialogTitle>
          <DialogDescription>
            Insert a manual payment-IN entry into the archive. It will appear on the Forwarded sheet
            and update Due/Advance automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="bdt">BDT Amount</Label>
            <Input
              id="bdt"
              type="number"
              inputMode="decimal"
              value={bdtAmount}
              onChange={(e) => setBdtAmount(e.target.value)}
              placeholder="38400"
            />
          </div>
          <div>
            <Label htmlFor="when">Date / Time (local)</Label>
            <Input
              id="when"
              type="datetime-local"
              value={createdAt}
              onChange={(e) => setCreatedAt(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="bank">Bank (optional)</Label>
            <Select value={bankAccountId || "__none__"} onValueChange={(v) => setBankAccountId(v === "__none__" ? "" : v)}>
              <SelectTrigger id="bank">
                <SelectValue placeholder="Select bank…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {(banks || []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.bank_name} · {b.account_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="desc">Description / Reference</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. EBL Skybanking Transfer · REF: 1188006261200122"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
