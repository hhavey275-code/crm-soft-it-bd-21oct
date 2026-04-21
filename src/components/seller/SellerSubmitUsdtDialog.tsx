import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Upload, Loader2, X, Landmark } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided (admin acting on behalf of a seller), this seller_id will be used instead of the logged-in user. */
  sellerId?: string;
  /** Optional invalidation key (e.g. admin-seller-txns) — defaults to seller-transactions */
  invalidateQueryKey?: any[];
}

export function SellerSubmitUsdtDialog({ open, onOpenChange, sellerId, invalidateQueryKey }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [usdtAmount, setUsdtAmount] = useState("");
  const [rate, setRate] = useState("");
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bankAccountId, setBankAccountId] = useState<string>("");

  const targetSellerForBanks = sellerId || user?.id;

  // Fetch USDT-assigned banks for the target seller
  const { data: usdtBanks } = useQuery({
    queryKey: ["seller-usdt-banks", targetSellerForBanks],
    enabled: !!targetSellerForBanks && open,
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from("seller_usdt_banks")
        .select("bank_account_id, bank_accounts(id, bank_name, account_number, status)")
        .eq("seller_id", targetSellerForBanks);
      return ((rows as any[]) ?? [])
        .map((r) => r.bank_accounts)
        .filter((b: any) => b && b.status === "active");
    },
  });

  const reset = () => {
    setUsdtAmount("");
    setRate("");
    setDescription("");
    setProofUrl(null);
    setPreviewUrl(null);
    setUploading(false);
    setBankAccountId("");
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const getCurrentUserId = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user?.id || user?.id || null;
  }, [user?.id]);

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image");
      return;
    }
    setUploading(true);
    try {
      const currentUserId = await getCurrentUserId();
      if (!currentUserId) throw new Error("Login session পাওয়া যায়নি। আবার login করুন");

      const ext = file.name.split(".").pop() || "png";
      const path = `${currentUserId}/seller-usdt-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("payment-proofs").upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("payment-proofs").getPublicUrl(path);
      setProofUrl(urlData.publicUrl);
      setPreviewUrl(URL.createObjectURL(file));
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [getCurrentUserId]);

  // Ctrl+V paste support
  useEffect(() => {
    if (!open) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) uploadFile(file);
          break;
        }
      }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, [open, uploadFile]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const currentUserId = await getCurrentUserId();
      if (!currentUserId) throw new Error("Login session পাওয়া যায়নি। আবার login করুন");

      const usdt = Number(usdtAmount);
      const r = Number(rate);
      if (!usdt || usdt <= 0) throw new Error("Valid USDT amount দিন");
      if (!r || r <= 0) throw new Error("Valid rate দিন");
      if (!proofUrl) throw new Error("Payment screenshot upload করুন");
      if (!bankAccountId) throw new Error("যে bank-এ USDT পাঠানো হয়েছে সেটা select করুন");

      const targetSellerId = sellerId || currentUserId;
      const isAdminEntry = !!sellerId && sellerId !== currentUserId;

      // Resolve display name of submitter (admin or seller themselves)
      let submitterName = "";
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", currentUserId)
          .single();
        submitterName = profile?.full_name || profile?.email || "";
      } catch {}

      const { data: inserted, error } = await (supabase as any).from("seller_transactions").insert({
        seller_id: targetSellerId,
        type: "usdt_received",
        usdt_amount: usdt,
        rate: r,
        bdt_amount: 0,
        description: description || null,
        proof_url: proofUrl,
        bank_account_id: bankAccountId,
        // Admin-submitted entries are auto-approved; seller's own submissions go to pending
        status: isAdminEntry ? "approved" : "pending",
        entry_by_name: submitterName || null,
        ...(isAdminEntry ? { reviewed_by: currentUserId, reviewed_at: new Date().toISOString() } : {}),
      }).select("id").single();
      if (error) throw error;

      return inserted;
    },
    onSuccess: () => {
      toast.success(sellerId ? "USDT entry recorded!" : "Submitted! Admin review-এর অপেক্ষায়।");
      if (invalidateQueryKey) {
        queryClient.invalidateQueries({ queryKey: invalidateQueryKey });
      } else {
        queryClient.invalidateQueries({ queryKey: ["seller-transactions", user?.id] });
      }
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit USDT Payment</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1.5 block flex items-center gap-1">
              <Landmark className="h-3 w-3" /> USDT Bank <span className="text-destructive">*</span>
            </Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger>
                <SelectValue placeholder={usdtBanks && usdtBanks.length === 0 ? "No USDT bank assigned — contact admin" : "Select bank you sent USDT to"} />
              </SelectTrigger>
              <SelectContent>
                {usdtBanks?.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.bank_name} — {b.account_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {usdtBanks && usdtBanks.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                ⚠️ এই seller-কে কোন USDT bank assign করা হয়নি। Admin → Sellers → "USDT Banks" থেকে assign করুন।
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">USDT Amount</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="100.00"
                value={usdtAmount}
                onChange={(e) => setUsdtAmount(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Rate (BDT/USDT)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="120.00"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              placeholder="TrxID, sender, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Payment Screenshot</Label>
            {previewUrl ? (
              <div className="relative rounded-lg border overflow-hidden bg-muted">
                <img src={previewUrl} alt="proof" className="w-full max-h-48 object-contain" />
                <button
                  onClick={() => { setProofUrl(null); setPreviewUrl(null); }}
                  className="absolute top-2 right-2 h-7 w-7 rounded-full bg-background/90 border flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full border-2 border-dashed border-border rounded-lg p-6 hover:border-primary/50 hover:bg-muted/40 transition-colors flex flex-col items-center gap-2 text-muted-foreground"
              >
                {uploading ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-6 w-6" />
                    <span className="text-xs">Click to upload or paste (Ctrl+V)</span>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
            />
          </div>

          {usdtAmount && rate && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
              ≈ ৳{(Number(usdtAmount) * Number(rate)).toLocaleString(undefined, { maximumFractionDigits: 2 })} BDT equivalent
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending || uploading}>
            {submitMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {sellerId ? "Save Entry" : "Submit for Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
