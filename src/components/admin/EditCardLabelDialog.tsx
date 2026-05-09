import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface CardRow {
  id: string;
  display_string: string;
  admin_label?: string | null;
  bank_name?: string | null;
  holder_name?: string | null;
  notes?: string | null;
  card_type?: string | null;
}

interface Props {
  card: CardRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditCardLabelDialog({ card, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [adminLabel, setAdminLabel] = useState("");
  const [bankName, setBankName] = useState("");
  const [holderName, setHolderName] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (card) {
      setAdminLabel(card.admin_label ?? "");
      setBankName(card.bank_name ?? "");
      setHolderName(card.holder_name ?? "");
      setNotes(card.notes ?? "");
    }
  }, [card]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!card) throw new Error("No card");
      const { error } = await (supabase as any)
        .from("ad_account_cards")
        .update({
          admin_label: adminLabel.trim() || null,
          bank_name: bankName.trim() || null,
          holder_name: holderName.trim() || null,
          notes: notes.trim() || null,
        })
        .eq("id", card.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Card details saved");
      queryClient.invalidateQueries({ queryKey: ["card-vault"] });
      queryClient.invalidateQueries({ queryKey: ["ad-account-cards-meta"] });
      queryClient.invalidateQueries({ queryKey: ["card-assignment-history"] });
      onOpenChange(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Card Details</DialogTitle>
          <DialogDescription>{card?.display_string}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Admin Label</Label>
            <Input value={adminLabel} onChange={(e) => setAdminLabel(e.target.value)} placeholder="e.g. Sumon-er DBBL" />
          </div>
          <div>
            <Label>Bank Name</Label>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. DBBL, EBL" />
          </div>
          <div>
            <Label>Holder Name</Label>
            <Input value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Card holder" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
