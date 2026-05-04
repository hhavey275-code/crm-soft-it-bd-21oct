import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Copy, ExternalLink, Loader2, CreditCard } from "lucide-react";
import { format } from "date-fns";

interface Props {
  targetUserId: string;
  targetUserName?: string | null;
  trigger?: React.ReactNode;
}

export function StripeLinkDialog({ targetUserId, targetUserName, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: pastLinks } = useQuery({
    queryKey: ["stripe-links", targetUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from("stripe_payment_links")
        .select("*")
        .eq("target_user_id", targetUserId)
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: open,
  });

  const handleCreate = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-stripe-checkout", {
        body: { target_user_id: targetUserId, amount_usd: amt, description },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResultUrl((data as any).url);
      toast.success("Payment link created");
      qc.invalidateQueries({ queryKey: ["stripe-links"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to create link");
    } finally {
      setLoading(false);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  const reset = () => {
    setAmount("");
    setDescription("");
    setResultUrl(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      {trigger || (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <CreditCard className="h-4 w-4 mr-2" />
          Generate Stripe Link
        </Button>
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stripe Payment Link {targetUserName ? `— ${targetUserName}` : ""}</DialogTitle>
          <DialogDescription>
            Create a secure Stripe Checkout link (USD). Send to client via WhatsApp/email.
            Wallet auto-credits on payment.
          </DialogDescription>
        </DialogHeader>

        {!resultUrl ? (
          <div className="space-y-4">
            <div>
              <Label>Amount (USD)</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 100.00"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Wallet top-up — Nov invoice"
                rows={2}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4 bg-muted rounded-lg">
            <p className="text-sm font-medium">✅ Payment link ready (valid 24 hours)</p>
            <div className="flex gap-2">
              <Input value={resultUrl} readOnly className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={() => copyLink(resultUrl)}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={resultUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this link with the client. They pay by card → wallet auto-credits.
            </p>
          </div>
        )}

        {pastLinks && pastLinks.length > 0 && (
          <div className="border-t pt-4 max-h-60 overflow-y-auto">
            <p className="text-sm font-medium mb-2">Recent links</p>
            <div className="space-y-2">
              {pastLinks.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/50">
                  <div>
                    <span className="font-semibold">${Number(l.amount_usd).toFixed(2)}</span>
                    <span className="text-muted-foreground ml-2">
                      {format(new Date(l.created_at), "MMM d, HH:mm")}
                    </span>
                    {l.failure_message && (
                      <div className="text-destructive mt-1">{l.failure_code}: {l.failure_message}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      l.status === "paid" ? "default" :
                      l.status === "pending" ? "secondary" :
                      "destructive"
                    }>{l.status}</Badge>
                    {l.status === "pending" && (
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyLink(l.checkout_url)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {!resultUrl ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Link
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset}>Create Another</Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
