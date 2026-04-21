import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { format, addMonths } from "date-fns";
import { CreditCard, ImageIcon, X, Loader2, Building2, Shield, CalendarDays, Check } from "lucide-react";

const DURATION_OPTIONS = [
  { months: 1, label: "1 Month" },
  { months: 2, label: "2 Months" },
  { months: 3, label: "3 Months" },
  { months: 6, label: "6 Months" },
  { months: 12, label: "1 Year" },
];

export function TenantSubscriptions() {
  const queryClient = useQueryClient();
  const [selectedBank, setSelectedBank] = useState("");
  const [selectedDuration, setSelectedDuration] = useState<number>(1);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // License info
  const { data: licenseData } = useQuery({
    queryKey: ["license-data-sub"],
    queryFn: async () => {
      const keys = ["license_status", "license_subscription_fee", "license_subscription_paid_until", "license_subscription_type", "license_usd_rate"];
      const { data } = await supabase.from("site_settings").select("key, value").in("key", keys);
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      return map;
    },
  });

  const subscriptionFee = Number(licenseData?.license_subscription_fee || 0);
  const subscriptionPaidUntil = licenseData?.license_subscription_paid_until || null;
  const totalAmount = subscriptionFee * selectedDuration;
  const isExpired = subscriptionPaidUntil ? new Date(subscriptionPaidUntil) < new Date() : true;

  // Banks
  const { data: banks } = useQuery({
    queryKey: ["tenant-banks-sub"],
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

  // Payment history
  const { data: payments } = useQuery({
    queryKey: ["tenant-sub-payments"],
    queryFn: async () => {
      if (!masterUrl || !tenantApiKey) return [];
      const res = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tenant-Key": tenantApiKey },
        body: JSON.stringify({ action: "get-payments" }),
      });
      const data = await res.json();
      return (data.payments || []).filter((p: any) => p.payment_type === "subscription");
    },
    enabled: !!masterUrl && !!tenantApiKey,
  });

  const selectedBankDetails = banks?.find((b: any) => b.id === selectedBank);

  // OCR
  const runOcr = async (file: File) => {
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
    } catch {
      toast.error("OCR failed.");
    } finally {
      setOcrLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) return;
    setProofFile(file);
    setProofPreview(URL.createObjectURL(file));
    runOcr(file);
  };

  const clearFile = () => {
    setProofFile(null);
    setProofPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
        runOcr(file);
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
      if (!masterUrl || !tenantApiKey) throw new Error("Not configured");
      if (!selectedBank) throw new Error("Select a bank");
      if (!proofFile) throw new Error("Upload screenshot");

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
          amount: totalAmount,
          proof_url: proofUrl,
          payment_type: "subscription",
          duration_months: selectedDuration,
          bank_account_id: selectedBank,
          payment_reference: paymentRef || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Payment submitted! Approval pending.");
      queryClient.invalidateQueries({ queryKey: ["tenant-sub-payments"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-heartbeat"] });
      queryClient.invalidateQueries({ queryKey: ["license-data-sub"] });
      setSelectedBank("");
      setSelectedDuration(1);
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
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-primary" />
          Subscription
        </h2>
        <p className="text-sm text-muted-foreground mt-1">Subscription renew করতে payment করুন</p>
      </div>

      {/* Current Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" /> Subscription Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Monthly Fee</p>
              <p className="text-lg font-bold">৳{subscriptionFee.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Paid Until</p>
              <p className="text-sm font-medium">
                {subscriptionPaidUntil
                  ? format(new Date(subscriptionPaidUntil), "dd MMM yyyy")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <Badge variant={isExpired ? "destructive" : "default"}>
                {isExpired ? "Expired" : "Active"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Renew Subscription</CardTitle>
          <CardDescription>Duration সিলেক্ট করুন, payment করুন</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Duration Select */}
          <div className="space-y-2">
            <Label>Duration</Label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <div
                  key={opt.months}
                  onClick={() => setSelectedDuration(opt.months)}
                  className={`p-3 rounded-lg border-2 cursor-pointer text-center transition-all ${
                    selectedDuration === opt.months
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">৳{(subscriptionFee * opt.months).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-muted text-center">
            <p className="text-sm text-muted-foreground">Total Amount</p>
            <p className="text-2xl font-bold">৳{totalAmount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {subscriptionPaidUntil
                ? `Validity extend: ${format(addMonths(new Date(subscriptionPaidUntil > new Date().toISOString() ? subscriptionPaidUntil : new Date().toISOString()), selectedDuration), "dd MMM yyyy")} পর্যন্ত`
                : `${selectedDuration} month(s) validity`}
            </p>
          </div>

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
            </div>
          </div>

          {/* Reference */}
          <div className="space-y-2">
            <Label>Transaction ID / Reference</Label>
            <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Enter reference" />
          </div>

          <Button
            className="w-full"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || !selectedBank || !proofFile}
          >
            {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
            Pay ৳{totalAmount.toLocaleString()} for {selectedDuration} month(s)
          </Button>
        </CardContent>
      </Card>

      {/* History */}
      {payments && payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs">{format(new Date(p.created_at), "dd MMM yyyy")}</TableCell>
                    <TableCell>৳{Number(p.amount).toLocaleString()}</TableCell>
                    <TableCell>{p.duration_months || "—"} month(s)</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
