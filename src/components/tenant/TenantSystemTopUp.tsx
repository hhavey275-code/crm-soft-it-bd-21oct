import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { format } from "date-fns";
import { ArrowUpCircle, ImageIcon, X, DollarSign, Shield, Loader2, Building2 } from "lucide-react";

export function TenantSystemTopUp() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [selectedBank, setSelectedBank] = useState("");
  const [bdtAmount, setBdtAmount] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if tenant mode (has master_url configured)
  const { data: masterUrl } = useQuery({
    queryKey: ["site-setting-master-url"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "master_url").single();
      return data?.value || "";
    },
  });

  const { data: tenantApiKey } = useQuery({
    queryKey: ["site-setting-tenant-api-key"],
    queryFn: async () => {
      const { data } = await supabase.from("site_settings").select("value").eq("key", "tenant_api_key").single();
      return data?.value || "";
    },
  });

  // License info from site_settings
  const { data: licenseData } = useQuery({
    queryKey: ["license-data-topup"],
    queryFn: async () => {
      const keys = ["license_system_limit", "license_total_used", "license_status", "license_usd_rate"];
      const { data } = await supabase.from("site_settings").select("key, value").in("key", keys);
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      return map;
    },
  });

  const systemLimit = Number(licenseData?.license_system_limit || 0);
  const totalUsed = Number(licenseData?.license_total_used || 0);
  const remaining = systemLimit - totalUsed;
  const usdRate = Number(licenseData?.license_usd_rate || 120);
  const usagePercent = systemLimit > 0 ? (totalUsed / systemLimit) * 100 : 0;

  // Fetch banks from master via webhook
  const { data: banks } = useQuery({
    queryKey: ["tenant-banks-topup"],
    queryFn: async () => {
      if (!masterUrl || !tenantApiKey) return [];
      const res = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": tenantApiKey },
        body: JSON.stringify({ action: "get-banks" }),
      });
      const data = await res.json();
      return data.banks || [];
    },
    enabled: !!masterUrl && !!tenantApiKey,
  });

  // Payment history from master
  const { data: payments } = useQuery({
    queryKey: ["tenant-limit-payments"],
    queryFn: async () => {
      if (!masterUrl || !tenantApiKey) return [];
      const res = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": tenantApiKey },
        body: JSON.stringify({ action: "get-payments" }),
      });
      const data = await res.json();
      return (data.payments || []).filter((p: any) => p.payment_type === "limit_purchase" || p.payment_type === "manual_adjustment");
    },
    enabled: !!masterUrl && !!tenantApiKey,
  });

  const selectedBankDetails = banks?.find((b: any) => b.id === selectedBank);
  const usdEquivalent = bdtAmount && usdRate ? (parseFloat(bdtAmount) / usdRate).toFixed(2) : "0.00";

  // OCR
  const runOcrExtraction = async (file: File) => {
    setOcrLoading(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("ocr-seller-payment", {
        body: { image_url: dataUrl, verify_account_number: selectedBankDetails?.account_number || null },
      });
      if (error) throw error;
      if (data?.reference) { setPaymentRef(data.reference); toast.success("Transaction ID auto-filled!"); }
      if (data?.bdt_amount) { setBdtAmount(String(Number(data.bdt_amount))); }
    } catch {
      toast.error("OCR failed. Please fill manually.");
    } finally {
      setOcrLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Max 5MB"); return; }
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
    runOcrExtraction(file);
  };

  const clearFile = () => {
    setProofFile(null);
    setProofPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Paste handler
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file || file.size > 5 * 1024 * 1024) return;
        setProofFile(file);
        setProofPreview(URL.createObjectURL(file));
        toast.success("Screenshot pasted!");
        runOcrExtraction(file);
        return;
      }
    }
  }, [selectedBankDetails]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!masterUrl || !tenantApiKey) throw new Error("Not configured as tenant");
      if (!selectedBank) throw new Error("Select a bank");
      if (!bdtAmount || parseFloat(bdtAmount) <= 0) throw new Error("Enter amount");
      if (!proofFile) throw new Error("Upload payment screenshot");

      // Upload proof
      let proofUrl: string | null = null;
      const ext = proofFile.name.split(".").pop();
      const filePath = `tenant/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("payment-proofs").upload(filePath, proofFile);
      if (uploadErr) throw uploadErr;
      const { data: urlData } = supabase.storage.from("payment-proofs").getPublicUrl(filePath);
      proofUrl = urlData.publicUrl;

      const res = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": tenantApiKey },
        body: JSON.stringify({
          action: "submit-payment",
          amount: parseFloat(bdtAmount),
          proof_url: proofUrl,
          payment_type: "limit_purchase",
          limit_amount: parseFloat(usdEquivalent),
          bank_account_id: selectedBank,
          payment_reference: paymentRef || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      // Trigger auto-verify (OCR + Telegram SMS match) — like client top-up
      if (data.payment_id) {
        try {
          const verifyRes = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Tenant-Key": tenantApiKey },
            body: JSON.stringify({ action: "verify-tenant-payment", payment_id: data.payment_id }),
          });
          const verifyData = await verifyRes.json();
          if (verifyData.auto_approved) {
            return { ...data, auto_approved: true };
          }
        } catch (e) {
          console.error("Auto-verify call failed (non-blocking):", e);
        }
      }
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.auto_approved) {
        toast.success("✅ Payment auto-approved! System limit updated.");
      } else {
        toast.success("Payment submitted. Auto-verifying via SMS — will update soon.");
      }
      queryClient.invalidateQueries({ queryKey: ["tenant-limit-payments"] });
      queryClient.invalidateQueries({ queryKey: ["license-data-topup"] });
      setBdtAmount("");
      setSelectedBank("");
      setPaymentRef("");
      clearFile();
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (!masterUrl && !tenantApiKey) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Tenant Mode Not Configured</p>
            <p className="text-sm mt-2">Settings → License Configuration থেকে Master URL এবং API Key সেট করুন।</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ArrowUpCircle className="h-6 w-6 text-primary" />
            System Top-Up
          </h2>
          <p className="text-sm text-muted-foreground mt-1">System limit বাড়াতে payment করুন</p>
        </div>
      </div>

      {/* License Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" /> Current System Limit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span>Used: ${totalUsed.toLocaleString()}</span>
            <span>Limit: ${systemLimit.toLocaleString()}</span>
          </div>
          <Progress value={Math.min(usagePercent, 100)} className="h-3" />
          <div className="flex justify-between">
            <Badge variant={remaining > 0 ? "default" : "destructive"}>
              Remaining: ${remaining.toLocaleString()}
            </Badge>
            <span className="text-xs text-muted-foreground">Rate: ৳{usdRate}/$</span>
          </div>
        </CardContent>
      </Card>

      {/* Payment Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit Payment</CardTitle>
          <CardDescription>Bank select করুন, screenshot আপলোড করুন, amount verify করুন</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Screenshot Upload */}
          <div className="space-y-2">
            <Label>Payment Screenshot *</Label>
            {proofPreview ? (
              <div className="relative inline-block">
                <img src={proofPreview} alt="proof" className="max-h-40 rounded-lg border" />
                <Button size="icon" variant="destructive" className="absolute -top-2 -right-2 h-6 w-6" onClick={clearFile}>
                  <X className="h-3 w-3" />
                </Button>
                {ocrLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              >
                <ImageIcon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to upload or paste screenshot</p>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>

          {/* Bank Selection */}
          <div className="space-y-2">
            <Label>Select Bank *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(banks || []).map((bank: any) => (
                <div
                  key={bank.id}
                  onClick={() => setSelectedBank(bank.id)}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedBank === bank.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    <div>
                      <p className="font-medium text-sm">{bank.bank_name}</p>
                      <p className="text-xs text-muted-foreground">{bank.account_name} • {bank.account_number}</p>
                    </div>
                  </div>
                </div>
              ))}
              {(!banks || banks.length === 0) && (
                <p className="text-sm text-muted-foreground col-span-2">No banks assigned. Contact master admin.</p>
              )}
            </div>
          </div>

          {/* Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>BDT Amount *</Label>
              <Input
                type="number"
                placeholder="৳ Amount"
                value={bdtAmount}
                onChange={(e) => setBdtAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>USD Equivalent</Label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted text-sm font-medium">
                <DollarSign className="h-4 w-4 mr-1" />{usdEquivalent}
              </div>
            </div>
          </div>

          {/* Payment Reference */}
          <div className="space-y-2">
            <Label>Transaction ID / Reference</Label>
            <Input
              placeholder="Enter transaction reference"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
            />
          </div>

          <Button
            className="w-full"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || !selectedBank || !bdtAmount || !proofFile}
          >
            {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowUpCircle className="h-4 w-4 mr-2" />}
            Submit System Top-Up (${usdEquivalent})
          </Button>
        </CardContent>
      </Card>

      {/* Payment History */}
      {payments && payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Limit Change</TableHead>
                  <TableHead>Reason / Note</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p: any) => {
                  const isAdjust = p.payment_type === "manual_adjustment";
                  const limitVal = Number(p.limit_amount || 0);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs">{format(new Date(p.created_at), "dd MMM yyyy")}</TableCell>
                      <TableCell>
                        <Badge variant={isAdjust ? "secondary" : "outline"} className="text-[10px]">
                          {isAdjust ? "Manual Adjustment" : "Payment"}
                        </Badge>
                      </TableCell>
                      <TableCell>{isAdjust ? "—" : `৳${Number(p.amount).toLocaleString()}`}</TableCell>
                      <TableCell className={limitVal < 0 ? "text-destructive font-medium" : "font-medium"}>
                        {limitVal > 0 ? "+" : ""}${limitVal.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate" title={p.adjustment_reason || ""}>
                        {p.adjustment_reason || "—"}
                      </TableCell>
                      <TableCell><StatusBadge status={p.status} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
