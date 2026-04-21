import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState } from "react";
import { format, differenceInDays } from "date-fns";
import { Wallet, Clock, CreditCard, Upload } from "lucide-react";

export function AgencyPayment() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedBank, setSelectedBank] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: agency } = useQuery({
    queryKey: ["my-agency", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agencies").select("*").eq("owner_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: agencyWallet } = useQuery({
    queryKey: ["agency-wallet", agency?.id],
    queryFn: async () => {
      const { data } = await supabase.from("agency_wallets").select("*").eq("agency_id", agency!.id).single();
      return data;
    },
    enabled: !!agency?.id,
  });

  // Fetch admin bank accounts (seller_id IS NULL = admin banks)
  const { data: adminBanks } = useQuery({
    queryKey: ["admin-banks-for-agency"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bank_accounts")
        .select("*")
        .is("seller_id", null)
        .eq("status", "active");
      return data || [];
    },
  });

  const { data: paymentHistory } = useQuery({
    queryKey: ["agency-payment-history", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("top_up_requests")
        .select("*")
        .eq("user_id", user!.id)
        .eq("payment_method", "agency_topup")
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!user,
  });

  const subscriptionDaysLeft = agency?.subscription_paid_until
    ? Math.max(0, differenceInDays(new Date(agency.subscription_paid_until), new Date()))
    : 0;
  const isExpired = agency?.subscription_paid_until && new Date(agency.subscription_paid_until) < new Date();

  const handleSubmit = async () => {
    if (!selectedBank || !amount || Number(amount) <= 0) {
      toast.error("Please select a bank and enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      let proofUrl = null;
      if (proofFile) {
        const ext = proofFile.name.split(".").pop();
        const path = `agency-topup/${user!.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("payment-proofs").upload(path, proofFile);
        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from("payment-proofs").getPublicUrl(path);
        proofUrl = urlData.publicUrl;
      }

      const { error } = await supabase.from("top_up_requests").insert({
        user_id: user!.id,
        amount: Number(amount),
        bank_account_id: selectedBank,
        payment_method: "agency_topup",
        payment_reference: reference || null,
        proof_url: proofUrl,
        status: "pending",
      });
      if (error) throw error;

      toast.success("Payment request submitted! Admin will review shortly.");
      setAmount("");
      setReference("");
      setProofFile(null);
      setSelectedBank("");
      qc.invalidateQueries({ queryKey: ["agency-payment-history"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedBankInfo = adminBanks?.find(b => b.id === selectedBank);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Agency Top-Up</h1>
      <p className="text-muted-foreground">Pay admin to add balance to your agency wallet</p>

      {/* Subscription & Wallet Info */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Wallet className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Wallet Balance</p>
              <p className="text-xl font-bold">${Number(agencyWallet?.balance || 0).toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Subscription</p>
              <div className="flex items-center gap-2">
                <p className="text-xl font-bold">{subscriptionDaysLeft} days</p>
                <Badge variant={isExpired ? "destructive" : "default"}>
                  {isExpired ? "Expired" : "Active"}
                </Badge>
              </div>
              {agency?.subscription_paid_until && (
                <p className="text-xs text-muted-foreground">
                  Until {format(new Date(agency.subscription_paid_until), "MMM dd, yyyy")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CreditCard className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Monthly Fee</p>
              <p className="text-xl font-bold">${Number(agency?.subscription_fee || 0)}/mo</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment Form */}
      <Card>
        <CardHeader>
          <CardTitle>Submit Payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Select Bank Account</Label>
            <Select value={selectedBank} onValueChange={setSelectedBank}>
              <SelectTrigger><SelectValue placeholder="Choose a bank..." /></SelectTrigger>
              <SelectContent>
                {adminBanks?.map(bank => (
                  <SelectItem key={bank.id} value={bank.id}>
                    {bank.bank_name} - {bank.account_name} ({bank.account_number})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedBankInfo && (
            <Card className="bg-muted/50">
              <CardContent className="p-3 text-sm space-y-1">
                <p><span className="font-medium">Bank:</span> {selectedBankInfo.bank_name}</p>
                <p><span className="font-medium">Account Name:</span> {selectedBankInfo.account_name}</p>
                <p><span className="font-medium">Account Number:</span> {selectedBankInfo.account_number}</p>
                {selectedBankInfo.branch && <p><span className="font-medium">Branch:</span> {selectedBankInfo.branch}</p>}
                {selectedBankInfo.routing_number && <p><span className="font-medium">Routing:</span> {selectedBankInfo.routing_number}</p>}
              </CardContent>
            </Card>
          )}

          <div>
            <Label>Amount (USD)</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" />
          </div>

          <div>
            <Label>Payment Reference / Transaction ID</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. TXN-12345" />
          </div>

          <div>
            <Label>Payment Proof (Screenshot)</Label>
            <div className="flex items-center gap-2">
              <Input type="file" accept="image/*" onChange={e => setProofFile(e.target.files?.[0] || null)} />
              {proofFile && <Upload className="h-4 w-4 text-green-600" />}
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? "Submitting..." : "Submit Payment Request"}
          </Button>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {!paymentHistory?.length ? (
            <p className="text-muted-foreground text-sm">No payment history</p>
          ) : (
            <div className="space-y-3">
              {paymentHistory.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium text-sm">${Number(p.amount).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(p.created_at), "MMM dd, yyyy HH:mm")}</p>
                    {p.payment_reference && <p className="text-xs text-muted-foreground">Ref: {p.payment_reference}</p>}
                  </div>
                  <Badge variant={p.status === "approved" ? "default" : p.status === "pending" ? "secondary" : "destructive"}>
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
