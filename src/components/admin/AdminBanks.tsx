import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Plus, Trash2, UserPlus, Pencil, Building2, BarChart3, RotateCcw, MinusCircle, ImageIcon, X, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { logSystemAction } from "@/lib/systemLog";
import { format } from "date-fns";

const emptyForm = { bank_name: "", account_name: "", account_number: "", branch: "", routing_number: "", telegram_group_id: "", seller_id: "", logo_url: "" };

function BankStatsDialog({ bankId, bankName, open, onClose }: { bankId: string; bankName: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["bank-stats", bankId],
    enabled: open && !!bankId,
    queryFn: async () => {
      const [{ data: topups }, { data: withdrawals }, { data: profiles }] = await Promise.all([
        supabase.from("top_up_requests").select("id, bdt_amount, amount, created_at, user_id, proof_url, payment_reference").eq("bank_account_id", bankId).eq("status", "approved").order("created_at", { ascending: false }),
        (supabase as any).from("transactions").select("amount, created_at, description").eq("bank_account_id", bankId).eq("type", "withdraw").order("created_at", { ascending: false }),
        supabase.from("profiles").select("user_id, full_name, email"),
      ]);

      const topupRows = topups ?? [];
      const withdrawRows = (withdrawals as any[]) ?? [];
      const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.full_name || p.email || p.user_id.slice(0, 8)]));
      const totalBdt = topupRows.reduce((s, r: any) => s + Number(r.bdt_amount || 0), 0);
      const totalUsd = topupRows.reduce((s, r: any) => s + Number(r.amount || 0), 0);
      const totalWithdrawn = withdrawRows.reduce((s, r: any) => s + Number(r.amount || 0), 0);

      // Group by day
      const dayMap: Record<string, { bdt: number; usd: number; count: number; withdrawn: number; transactions: any[] }> = {};
      for (const r of topupRows) {
        const day = format(new Date((r as any).created_at), "yyyy-MM-dd");
        if (!dayMap[day]) dayMap[day] = { bdt: 0, usd: 0, count: 0, withdrawn: 0, transactions: [] };
        dayMap[day].bdt += Number((r as any).bdt_amount || 0);
        dayMap[day].usd += Number((r as any).amount || 0);
        dayMap[day].count += 1;
        dayMap[day].transactions.push({
          id: (r as any).id,
          amount: Number((r as any).amount || 0),
          bdt_amount: Number((r as any).bdt_amount || 0),
          client_name: profileMap.get((r as any).user_id) || (r as any).user_id?.slice(0, 8),
          proof_url: (r as any).proof_url,
          reference: (r as any).payment_reference,
          time: format(new Date((r as any).created_at), "HH:mm"),
        });
      }
      for (const w of withdrawRows) {
        const day = format(new Date(w.created_at), "yyyy-MM-dd");
        if (!dayMap[day]) dayMap[day] = { bdt: 0, usd: 0, count: 0, withdrawn: 0, transactions: [] };
        dayMap[day].withdrawn += Number(w.amount || 0);
      }

      const daily = Object.entries(dayMap)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, v]) => ({ date, ...v }));

      return { totalBdt, totalUsd, totalCount: topupRows.length, totalWithdrawn, netBdt: totalBdt - totalWithdrawn, daily };
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const amt = Number(withdrawAmount);
      if (!amt || amt <= 0) throw new Error("Enter a valid amount");
      const { error } = await (supabase as any).from("transactions").insert({
        user_id: "00000000-0000-0000-0000-000000000000",
        type: "withdraw",
        amount: amt,
        bank_account_id: bankId,
        description: withdrawNote || `Bank withdraw from ${bankName}`,
        processed_by: "admin",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Withdraw recorded!");
      queryClient.invalidateQueries({ queryKey: ["bank-stats", bankId] });
      setWithdrawAmount("");
      setWithdrawNote("");
      setShowWithdrawForm(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            {bankName} — Stats
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground animate-pulse">Loading stats...</div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <Card className="border">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Received (BDT)</p>
                  <p className="text-lg font-bold text-primary">৳{stats?.totalBdt?.toLocaleString() ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="border">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Withdrawn</p>
                  <p className="text-lg font-bold text-destructive">৳{stats?.totalWithdrawn?.toLocaleString() ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="border">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Net Balance (BDT)</p>
                  <p className="text-lg font-bold text-emerald-600">৳{stats?.netBdt?.toLocaleString() ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="border">
                <CardContent className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total USD / Txns</p>
                  <p className="text-lg font-bold">${stats?.totalUsd?.toLocaleString() ?? 0} <span className="text-xs text-muted-foreground">({stats?.totalCount ?? 0})</span></p>
                </CardContent>
              </Card>
            </div>

            {/* Record Withdraw */}
            <div>
              {!showWithdrawForm ? (
                <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setShowWithdrawForm(true)}>
                  <MinusCircle className="h-4 w-4" /> Record Withdraw
                </Button>
              ) : (
                <div className="space-y-2 p-3 border rounded-md bg-muted/30">
                  <Label className="text-xs">Withdraw Amount (BDT)</Label>
                  <Input type="number" placeholder="Amount" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} />
                  <Input placeholder="Note (optional)" value={withdrawNote} onChange={e => setWithdrawNote(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowWithdrawForm(false)}>Cancel</Button>
                    <Button size="sm" onClick={() => withdrawMutation.mutate()} disabled={withdrawMutation.isPending}>
                      {withdrawMutation.isPending ? "Saving..." : "Save Withdraw"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Day-by-day with expandable details */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Day-by-Day Breakdown</h3>
              {stats?.daily && stats.daily.length > 0 ? (
                <div className="space-y-1">
                  {stats.daily.map((d) => (
                    <div key={d.date} className="border rounded-md overflow-hidden">
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                        onClick={() => setExpandedDay(expandedDay === d.date ? null : d.date)}
                      >
                        {expandedDay === d.date ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <span className="text-xs flex-1">{format(new Date(d.date), "MMM d, yyyy")}</span>
                        <span className="text-xs font-mono font-medium">৳{d.bdt.toLocaleString()}</span>
                        {d.withdrawn > 0 && <span className="text-xs font-mono text-destructive">-৳{d.withdrawn.toLocaleString()}</span>}
                        <span className="text-xs text-muted-foreground">({d.count})</span>
                      </button>
                      {expandedDay === d.date && d.transactions.length > 0 && (
                        <div className="border-t bg-muted/20 divide-y">
                          {d.transactions.map((tx: any) => (
                            <div key={tx.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                              {tx.proof_url && (
                                <button onClick={() => setProofPreview(tx.proof_url)} className="shrink-0">
                                  <img src={tx.proof_url} alt="proof" className="h-10 w-10 rounded object-cover border" />
                                </button>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{tx.client_name}</p>
                                <p className="text-muted-foreground truncate">
                                  ${tx.amount.toLocaleString()} • ৳{tx.bdt_amount.toLocaleString()} • {tx.time}
                                </p>
                                <p className="text-muted-foreground truncate text-[10px]">ID: {tx.id.slice(0, 8)} {tx.reference ? `• Ref: ${tx.reference}` : ""}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No transactions yet</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    {/* Proof preview */}
    {proofPreview && (
      <Dialog open={!!proofPreview} onOpenChange={() => setProofPreview(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-2 sm:p-4 flex items-center justify-center">
          <img src={proofPreview} alt="Payment Proof" className="max-w-full max-h-[85vh] object-contain rounded" />
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

export function AdminBanks() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [showAdd, setShowAdd] = useState(false);
  const [showAssign, setShowAssign] = useState<string | null>(null);
  const [editingBank, setEditingBank] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedClient, setSelectedClient] = useState("");
  const [statsBank, setStatsBank] = useState<{ id: string; name: string } | null>(null);
  const [bankTab, setBankTab] = useState("active");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo must be under 2MB"); return; }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile) return form.logo_url || null;
    const ext = logoFile.name.split(".").pop();
    const filePath = `banks/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("logos").upload(filePath, logoFile);
    if (error) throw error;
    const { data: urlData } = supabase.storage.from("logos").getPublicUrl(filePath);
    return urlData.publicUrl;
  };

  const { data: banks } = useQuery({
    queryKey: ["admin-banks", bankTab],
    queryFn: async () => {
      const { data } = await (supabase as any).from("bank_accounts").select("*").eq("status", bankTab).order("created_at", { ascending: false });
      return (data as any[]) ?? [];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*");
      return (data as any[]) ?? [];
    },
  });

  // Fetch sellers for bank assignment
  const { data: sellers } = useQuery({
    queryKey: ["admin-sellers-list"],
    queryFn: async () => {
      const { data: roles } = await (supabase as any).from("user_roles").select("user_id").eq("role", "seller");
      if (!roles?.length) return [];
      const sellerIds = roles.map((r: any) => r.user_id);
      const { data: profs } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", sellerIds);
      return (profs as any[]) ?? [];
    },
  });

  const { data: clientBanks } = useQuery({
    queryKey: ["admin-client-banks"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("client_banks").select("*, bank_accounts(bank_name), profiles!inner(full_name, email)");
      return (data as any[]) ?? [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const logoUrl = await uploadLogo();
      const insertData: any = { bank_name: form.bank_name, account_name: form.account_name, account_number: form.account_number, branch: form.branch, routing_number: form.routing_number, logo_url: logoUrl };
      if (form.telegram_group_id) insertData.telegram_group_id = form.telegram_group_id;
      if (form.seller_id) insertData.seller_id = form.seller_id;
      const { error } = await (supabase as any).from("bank_accounts").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => { logSystemAction("Bank Added", `${form.bank_name} — ${form.account_number}`); toast.success("Bank added!"); queryClient.invalidateQueries({ queryKey: ["admin-banks"] }); setShowAdd(false); setForm(emptyForm); clearLogo(); },
    onError: (e: any) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: async () => {
      const logoUrl = await uploadLogo();
      const updateData: any = {
        bank_name: form.bank_name, account_name: form.account_name, account_number: form.account_number, branch: form.branch, routing_number: form.routing_number,
        telegram_group_id: form.telegram_group_id || null,
        seller_id: form.seller_id || null,
        logo_url: logoUrl,
      };
      const { error } = await (supabase as any).from("bank_accounts").update(updateData).eq("id", editingBank.id);
      if (error) throw error;
    },
    onSuccess: () => { logSystemAction("Bank Updated", `${form.bank_name} — ${form.account_number}`); toast.success("Bank updated!"); queryClient.invalidateQueries({ queryKey: ["admin-banks"] }); setEditingBank(null); setForm(emptyForm); clearLogo(); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("bank_accounts").update({ status: "inactive" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { logSystemAction("Bank Deactivated", "Bank set to inactive"); toast.success("Bank deactivated"); queryClient.invalidateQueries({ queryKey: ["admin-banks"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("bank_accounts").update({ status: "active" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { logSystemAction("Bank Reactivated", "Bank set to active"); toast.success("Bank reactivated!"); queryClient.invalidateQueries({ queryKey: ["admin-banks"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("client_banks").upsert({ user_id: selectedClient, bank_account_id: showAssign }, { onConflict: "user_id,bank_account_id" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Bank assigned to client!"); queryClient.invalidateQueries({ queryKey: ["admin-client-banks"] }); setShowAssign(null); setSelectedClient(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const unassignMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("client_banks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Assignment removed"); queryClient.invalidateQueries({ queryKey: ["admin-client-banks"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const isActive = bankTab === "active";

  const openEditBank = (b: any) => {
    setEditingBank(b);
    setForm({ bank_name: b.bank_name, account_name: b.account_name, account_number: b.account_number, branch: b.branch || "", routing_number: b.routing_number || "", telegram_group_id: b.telegram_group_id || "", seller_id: b.seller_id || "", logo_url: b.logo_url || "" });
    setLogoPreview(b.logo_url || null);
    setLogoFile(null);
  };

  const LogoUploadField = () => (
    <div className="space-y-2">
      <Label>Bank Logo <span className="text-xs text-muted-foreground">(optional)</span></Label>
      <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
      {logoPreview ? (
        <div className="relative inline-block">
          <img src={logoPreview} alt="Bank logo" className="h-16 w-16 rounded-lg border object-contain bg-white" />
          <button type="button" onClick={clearLogo} className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => logoInputRef.current?.click()}>
          <ImageIcon className="h-4 w-4" /> Upload Logo
        </Button>
      )}
    </div>
  );

  const BankLogo = ({ url, size = "sm" }: { url?: string; size?: "sm" | "md" }) => {
    const dim = size === "sm" ? "h-8 w-8" : "h-10 w-10";
    if (url) return <img src={url} alt="Bank" className={cn(dim, "rounded-md border object-contain bg-white shrink-0")} />;
    return (
      <div className={cn(dim, "rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0")}>
        <Building2 className="h-4 w-4 text-blue-600" />
      </div>
    );
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Bank Accounts</h1>
        <Button size={isMobile ? "sm" : "default"} onClick={() => { setShowAdd(true); clearLogo(); }}>
          <Plus className="mr-1.5 h-4 w-4" /> Add Bank
        </Button>
      </div>

      {/* Active / Inactive Toggle */}
      <Tabs value={bankTab} onValueChange={setBankTab}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* All Banks */}
      {isMobile ? (
        <div className="space-y-2.5">
          {banks?.map((b: any) => (
            <Card key={b.id} className="border border-border/60 shadow-sm">
              <CardContent className="p-3">
                <div className="flex items-start gap-3">
                  <BankLogo url={b.logo_url} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{b.bank_name}</p>
                      <StatusBadge status={b.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{b.account_name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{b.account_number}</p>
                    {b.branch && <p className="text-[11px] text-muted-foreground">Branch: {b.branch}</p>}
                    <div className="flex items-center gap-1.5 mt-2">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setStatsBank({ id: b.id, name: b.bank_name })}>
                        <BarChart3 className="h-3.5 w-3.5" />
                      </Button>
                      {isActive ? (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditBank(b)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowAssign(b.id)}>
                            <UserPlus className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-destructive" onClick={() => deleteMutation.mutate(b.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-green-600" onClick={() => reactivateMutation.mutate(b.id)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {(!banks || banks.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">{isActive ? "No active banks" : "No inactive banks"}</p>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-lg">{isActive ? "Active" : "Inactive"} Banks</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Logo</TableHead>
                  <TableHead>Bank Name</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Account Number</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {banks?.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell><BankLogo url={b.logo_url} /></TableCell>
                    <TableCell className="font-medium">{b.bank_name}</TableCell>
                    <TableCell>{b.account_name}</TableCell>
                    <TableCell>{b.account_number}</TableCell>
                    <TableCell>{b.branch || "—"}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setStatsBank({ id: b.id, name: b.bank_name })} title="View Stats">
                          <BarChart3 className="h-4 w-4" />
                        </Button>
                        {isActive ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEditBank(b)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setShowAssign(b.id)}><UserPlus className="h-4 w-4" /></Button>
                            <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => deleteMutation.mutate(b.id)}><Trash2 className="h-4 w-4" /></Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-green-600 gap-1" onClick={() => reactivateMutation.mutate(b.id)}>
                            <RotateCcw className="h-4 w-4" /> Reactivate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(!banks || banks.length === 0) && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{isActive ? "No active banks" : "No inactive banks"}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Client Bank Assignments */}
      {isMobile ? (
        <div>
          <h2 className="text-base font-semibold mb-2">Client Bank Assignments</h2>
          <div className="space-y-2">
            {clientBanks?.map((cb: any) => (
              <Card key={cb.id} className="border border-border/60 shadow-sm">
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{cb.profiles?.full_name || cb.profiles?.email}</p>
                    <p className="text-xs text-muted-foreground">{cb.bank_accounts?.bank_name}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="hover:text-destructive h-7 w-7 p-0" onClick={() => unassignMutation.mutate(cb.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
            {(!clientBanks || clientBanks.length === 0) && (
              <p className="text-center text-muted-foreground py-4 text-sm">No assignments</p>
            )}
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-lg">Client Bank Assignments</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Bank</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientBanks?.map((cb: any) => (
                  <TableRow key={cb.id}>
                    <TableCell className="font-medium">{cb.profiles?.full_name || cb.profiles?.email}</TableCell>
                    <TableCell>{cb.bank_accounts?.bank_name}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => unassignMutation.mutate(cb.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(!clientBanks || clientBanks.length === 0) && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No assignments</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Bank Stats Dialog */}
      {statsBank && (
        <BankStatsDialog bankId={statsBank.id} bankName={statsBank.name} open={!!statsBank} onClose={() => setStatsBank(null)} />
      )}

      {/* Add Bank Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Bank Account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <LogoUploadField />
            <div><Label>Bank Name</Label><Input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
            <div><Label>Account Name</Label><Input value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} /></div>
            <div><Label>Account Number</Label><Input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} /></div>
            <div><Label>Branch</Label><Input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} /></div>
            <div><Label>Routing Number</Label><Input value={form.routing_number} onChange={e => setForm(f => ({ ...f, routing_number: e.target.value }))} /></div>
            <div><Label>Telegram Group ID <span className="text-xs text-muted-foreground">(for proof forwarding)</span></Label><Input placeholder="-100xxxxxxxxxx" value={form.telegram_group_id} onChange={e => setForm(f => ({ ...f, telegram_group_id: e.target.value }))} /></div>
            <div>
              <Label>Assign to Seller <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Select value={form.seller_id} onValueChange={v => setForm(f => ({ ...f, seller_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="No seller" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No seller</SelectItem>
                  {sellers?.map((s: any) => (
                    <SelectItem key={s.user_id} value={s.user_id}>{s.full_name || s.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={!form.bank_name || !form.account_name || !form.account_number || addMutation.isPending}>
              {addMutation.isPending ? "Adding..." : "Add Bank"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Bank Dialog */}
      <Dialog open={!!showAssign} onOpenChange={() => setShowAssign(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Bank to Client</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Select Client</Label>
            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger><SelectValue placeholder="Choose a client" /></SelectTrigger>
              <SelectContent>
                {profiles?.map((p: any) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssign(null)}>Cancel</Button>
            <Button onClick={() => assignMutation.mutate()} disabled={!selectedClient || assignMutation.isPending}>
              {assignMutation.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Bank Dialog */}
      <Dialog open={!!editingBank} onOpenChange={(open) => { if (!open) { setEditingBank(null); setForm(emptyForm); clearLogo(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Bank Account</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <LogoUploadField />
            <div><Label>Bank Name</Label><Input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} /></div>
            <div><Label>Account Name</Label><Input value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} /></div>
            <div><Label>Account Number</Label><Input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} /></div>
            <div><Label>Branch</Label><Input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} /></div>
            <div><Label>Routing Number</Label><Input value={form.routing_number} onChange={e => setForm(f => ({ ...f, routing_number: e.target.value }))} /></div>
            <div><Label>Telegram Group ID <span className="text-xs text-muted-foreground">(for proof forwarding)</span></Label><Input placeholder="-100xxxxxxxxxx" value={form.telegram_group_id} onChange={e => setForm(f => ({ ...f, telegram_group_id: e.target.value }))} /></div>
            <div>
              <Label>Assign to Seller <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Select value={form.seller_id} onValueChange={v => setForm(f => ({ ...f, seller_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="No seller" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No seller</SelectItem>
                  {sellers?.map((s: any) => (
                    <SelectItem key={s.user_id} value={s.user_id}>{s.full_name || s.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingBank(null); setForm(emptyForm); clearLogo(); }}>Cancel</Button>
            <Button onClick={() => editMutation.mutate()} disabled={!form.bank_name || !form.account_name || !form.account_number || editMutation.isPending}>
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
