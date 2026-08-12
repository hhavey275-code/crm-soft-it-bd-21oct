import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedCallback } from "@/lib/debounce";
import { TelegramPollStatus } from "@/components/TelegramPollStatus";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, startOfDay, endOfDay, subDays, isWithinInterval } from "date-fns";
import { toast } from "sonner";
import { useState, Fragment, useMemo, useEffect } from "react";

import { Check, X, Pause, ImageIcon, Radio, ChevronDown, ChevronUp, MessageSquareText, RotateCcw, ClipboardCheck, FileText, DollarSign, Banknote, Bot, UserCheck, CalendarIcon, Send, Search } from "lucide-react";
import { Link } from "@/lib/router-compat";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { MetricCard } from "@/components/MetricCard";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { logSystemAction } from "@/lib/systemLog";

type ActionType = "approved" | "rejected" | "hold";

// Manual approve is blocked ONLY when an OCR check failed (ref / amount / account
// mismatch or missing). Telegram SMS-only mismatch is allowed for manual approve
// because bank SMS sometimes never arrives due to bank/server issues — the OCR
// proof itself remains the source of truth and must still pass all 3 checks.
const hasTopUpVerificationFailure = (note?: string | null) => {
  if (!note) return true;
  const text = note.toLowerCase();
  if (!text.includes("auto-verification")) return true;
  // Hard fail: any OCR ❌ marker (ref / amount / account / atm credit)
  return /❌\s*(ocr|atm)/i.test(text) || text.includes("⚠️");
};


const getTelegramDisplayText = (m: any) => {
  const raw = m?.raw_update || {};
  const payload = raw.message || raw.edited_message || raw.channel_post || raw.edited_channel_post || {};
  if (typeof m?.text === "string" && m.text.trim()) return m.text;
  if (typeof payload?.text === "string" && payload.text.trim()) return payload.text;
  if (typeof payload?.caption === "string" && payload.caption.trim()) return payload.caption;
  if (Array.isArray(payload?.new_chat_members) && payload.new_chat_members.length > 0) {
    const names = payload.new_chat_members.map((member: any) => member?.username || member?.first_name || "member").join(", ");
    return `[service] new_chat_members: ${names}`;
  }
  if (payload?.left_chat_member) {
    return `[service] left_chat_member: ${payload.left_chat_member?.username || payload.left_chat_member?.first_name || "member"}`;
  }
  return "(non-text Telegram update)";
};

function BankSmsPanel({ request }: { request: any }) {
  const last4 = request.bankAccount?.account_number?.slice(-4) || "";
  const bdtAmount = request.bdt_amount ? Number(request.bdt_amount) : null;
  const createdAt = new Date(request.created_at);
  const windowMs = 60 * 60 * 1000;

  const { data: messages, isLoading } = useQuery({
    queryKey: ["bank-sms", request.id],
    queryFn: async () => {
      const from = new Date(createdAt.getTime() - windowMs).toISOString();
      const to = new Date(createdAt.getTime() + windowMs).toISOString();
      const { data } = await (supabase as any).from("telegram_messages").select("*").gte("created_at", from).lte("created_at", to).order("created_at", { ascending: false }).limit(50);
      return (data as any[]) ?? [];
    },
  });

  const relevantMessages = messages?.filter((m: any) => {
    const text = getTelegramDisplayText(m).toLowerCase();
    const hasLast4 = last4 && text.includes(last4);
    const hasAmount = bdtAmount && text.includes(String(Math.round(bdtAmount)));
    const hasRef = request.payment_reference && text.includes(String(request.payment_reference).toLowerCase());
    return hasLast4 || hasAmount || hasRef;
  }) ?? [];

  if (isLoading) return <div className="px-4 py-3 text-sm text-muted-foreground animate-pulse">Loading bank SMS...</div>;
  if (relevantMessages.length === 0) return <div className="px-4 py-3 text-sm text-muted-foreground bg-muted/30 rounded-md">No matching bank SMS found</div>;

  return (
    <div className="space-y-2">
      {relevantMessages.map((m: any) => (
        <div key={m.update_id} className="p-3 bg-muted/40 rounded-md border text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{format(new Date(m.created_at), "MMM d, HH:mm:ss")}</span>
          </div>
          <p className="whitespace-pre-wrap text-foreground">{getTelegramDisplayText(m)}</p>
        </div>
      ))}
    </div>
  );
}

function BankSmsTab() {
  const { data: messages, isLoading } = useQuery({
    queryKey: ["matched-bank-sms"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("telegram_messages").select("*").not("matched_request_id", "is", null).order("created_at", { ascending: false }).limit(100);
      return (data as any[]) ?? [];
    },
  });

  const allMessages = messages ?? [];

  if (isLoading) return <Card><CardContent className="p-6 text-center text-muted-foreground animate-pulse">Loading bank SMS...</CardContent></Card>;

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-primary" />Matched Bank SMS ({allMessages.length})</CardTitle></CardHeader>
      <CardContent>
        {allMessages.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No matched SMS messages yet.</p>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {allMessages.map((m: any) => (
              <div key={m.update_id} className="p-3 bg-muted/40 rounded-md border text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{format(new Date(m.created_at), "MMM d, yyyy HH:mm:ss")}</span>
                  <span className="text-xs text-green-600 font-medium">✅ Matched</span>
                </div>
                <p className="whitespace-pre-wrap text-foreground">{getTelegramDisplayText(m)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminTopUp() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [proofDialog, setProofDialog] = useState<string | null>(null);
  const [isFetchingTelegram, setIsFetchingTelegram] = useState(false);
  const [expandedSms, setExpandedSms] = useState<Record<string, boolean>>({});
  const [verifyingIds, setVerifyingIds] = useState<Record<string, boolean>>({});
  const [actionDialog, setActionDialog] = useState<{
    id: string; action: ActionType; userId: string; amount: number; bdtAmount: number | null; usdRate: number | null;
  } | null>(null);

  const today = startOfDay(new Date());
  const [datePreset, setDatePreset] = useState<"today" | "yesterday" | "custom">("today");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: today,
    to: endOfDay(new Date()),
  });

  const handlePreset = (preset: "today" | "yesterday") => {
    setDatePreset(preset);
    if (preset === "today") {
      setDateRange({ from: today, to: endOfDay(new Date()) });
    } else {
      const yesterday = subDays(today, 1);
      setDateRange({ from: yesterday, to: endOfDay(yesterday) });
    }
  };




  const debouncedInvalidateTopUp = useDebouncedCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-topup-requests"] });
    queryClient.invalidateQueries({ queryKey: ["admin-wallets"] });
  }, 1500);
  useEffect(() => {
    const channel = supabase.channel("admin-topup-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "top_up_requests" }, () => debouncedInvalidateTopUp())
      .on("postgres_changes", { event: "*", schema: "public", table: "tenant_payments" }, () => debouncedInvalidateTopUp())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [debouncedInvalidateTopUp]);

  const toggleSms = (id: string) => setExpandedSms(prev => ({ ...prev, [id]: !prev[id] }));

  const fetchTelegram = async () => {
    setIsFetchingTelegram(true);
    try {
      const { data, error } = await supabase.functions.invoke('telegram-poll', { body: { quick: true } });
      if (error) throw error;
      toast.success(`Telegram synced! ${data?.processed ?? 0} messages fetched${data?.auto_verified ? `, ${data.auto_verified} request(s) auto-approved!` : ''}.`);
    } catch (err: any) { toast.error(`Telegram fetch failed: ${err.message}`); }
    finally { setIsFetchingTelegram(false); }
  };

  const reVerify = async (requestId: string) => {
    setVerifyingIds(prev => ({ ...prev, [requestId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('verify-topup', { body: { request_id: requestId } });
      if (error) throw error;
      if (data?.auto_approved) { toast.success('Request auto-approved!'); queryClient.invalidateQueries({ queryKey: ["admin-topup-requests"] }); queryClient.invalidateQueries({ queryKey: ["admin-wallets"] }); }
      else { toast.info(`Not auto-approved: ${data?.reason || 'No match found'}`); }
    } catch (err: any) { toast.error(`Verify failed: ${err.message}`); }
    finally { setVerifyingIds(prev => ({ ...prev, [requestId]: false })); }
  };

  const { data: requests } = useQuery({
    queryKey: ["admin-topup-requests"],
    queryFn: async () => {
      // Fetch client top-up requests
      const { data } = await supabase.from("top_up_requests").select("*").order("created_at", { ascending: false });
      const rows = (data ?? []).map((r: any) => ({ ...r, _source: "client" as const }));

      // Fetch tenant payments
      const { data: tenantPayments } = await (supabase as any).from("tenant_payments").select("*, tenants(name, domain, usd_rate, subscription_fee, subscription_paid_until, system_limit, subscription_type, total_used)").order("created_at", { ascending: false });
      const tenantRows = (tenantPayments ?? []).map((tp: any) => ({
        id: tp.id,
        user_id: tp.tenant_id,
        amount: tp.limit_amount || (Number(tp.amount) / (Number(tp.tenants?.usd_rate) || 120)),
        bdt_amount: tp.amount,
        usd_rate: tp.tenants?.usd_rate || 120,
        status: tp.status,
        proof_url: tp.proof_url,
        bank_account_id: tp.bank_account_id,
        payment_reference: tp.payment_reference || null,
        payment_method: "bank_transfer",
        admin_note: null,
        reviewed_by: tp.reviewed_by,
        telegram_forwarded: null,
        created_at: tp.created_at,
        updated_at: tp.updated_at,
        verify_attempts: 0,
        last_verify_at: null,
        _source: "tenant" as const,
        _tenant: tp.tenants,
        _tenant_id: tp.tenant_id,
        _payment_type: tp.payment_type,
        _duration_months: tp.duration_months,
        _limit_amount: tp.limit_amount,
        _original_amount: tp.amount,
      }));

      const allRows = [...rows, ...tenantRows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const userIds = [...new Set(allRows.filter(r => r._source === "client").map((r: any) => r.user_id))];
      const reviewerIds = [...new Set(allRows.filter((r: any) => r.reviewed_by).map((r: any) => r.reviewed_by))];
      const allIds = [...new Set([...userIds, ...reviewerIds])];
      const bankIds = [...new Set(allRows.filter((r: any) => r.bank_account_id).map((r: any) => r.bank_account_id))];

      const [{ data: profiles }, { data: banks }] = await Promise.all([
        allIds.length > 0 ? supabase.from("profiles").select("user_id, full_name, email").in("user_id", allIds) : Promise.resolve({ data: [] }),
        bankIds.length > 0 ? supabase.from("bank_accounts").select("id, bank_name, account_number, telegram_group_id").in("id", bankIds) : Promise.resolve({ data: [] }),
      ]);

      const profileMap: Record<string, any> = {};
      (profiles ?? []).forEach((p: any) => { profileMap[p.user_id] = p; });
      const bankMap: Record<string, any> = {};
      (banks ?? []).forEach((b: any) => { bankMap[b.id] = b; });

      return allRows.map((r: any) => ({
        ...r,
        profile: r._source === "tenant" ? { full_name: `🏢 ${r._tenant?.name || "Tenant"}`, email: r._tenant?.domain } : (profileMap[r.user_id] || null),
        reviewerProfile: r.reviewed_by ? profileMap[r.reviewed_by] || null : null,
        bankAccount: r.bank_account_id ? bankMap[r.bank_account_id] || null : null,
      }));
    },
  });

  const filtered = requests?.filter((r: any) => {
    // Date range filter — skip for actionable tabs (pending/hold) so old items remain visible
    if (statusFilter !== "bank_sms" && statusFilter !== "hold" && statusFilter !== "pending" && statusFilter !== "rejected" && dateRange?.from) {
      const from = startOfDay(dateRange.from);
      const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
      const ts = new Date(r.created_at).getTime();
      if (ts < from.getTime() || ts > to.getTime()) return false;
    }
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      const acc = String(r.bankAccount?.account_number || "").replace(/\s+/g, "").toLowerCase();
      const bankName = String(r.bankAccount?.bank_name || "").toLowerCase();
      const clientName = String(r.profile?.full_name || "").toLowerCase();
      const clientEmail = String(r.profile?.email || "").toLowerCase();
      const ref = String(r.payment_reference || "").toLowerCase();
      const matches =
        acc.includes(q) ||
        acc.endsWith(q) ||
        bankName.includes(q) ||
        clientName.includes(q) ||
        clientEmail.includes(q) ||
        ref.includes(q);
      if (!matches) return false;
    }
    if (statusFilter === "all" || statusFilter === "bank_sms") return true;
    if (statusFilter === "tenant") return r._source === "tenant";
    return r.status === statusFilter;
  });

  // Approved top-ups whose bank has a Telegram group but were never forwarded
  const missingForwardsBase = useMemo(() => {
    if (!requests) return [];
    return requests.filter((r: any) =>
      r._source === "client" &&
      r.status === "approved" &&
      r.proof_url &&
      r.bankAccount?.telegram_group_id &&
      r.telegram_forwarded !== true &&
      !r.forward_dismissed_at
    );
  }, [requests]);

  const missingIds = useMemo(() => missingForwardsBase.map((r: any) => r.id), [missingForwardsBase]);

  const { data: mirrorSet } = useQuery({
    queryKey: ["missing-forward-mirrors", missingIds],
    enabled: missingIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("seller_transactions")
        .select("top_up_request_id")
        .in("top_up_request_id", missingIds);
      return new Set((data || []).map((m: any) => m.top_up_request_id));
    },
  });

  const missingForwards = useMemo(
    () => missingForwardsBase.map((r: any) => ({ ...r, mirror_present: mirrorSet?.has(r.id) ?? false })),
    [missingForwardsBase, mirrorSet]
  );

  const willCreateSheetCount = missingForwards.filter((r: any) => !r.mirror_present).length;

  const [forwardingMissing, setForwardingMissing] = useState(false);
  const [forwardMissingOpen, setForwardMissingOpen] = useState(false);
  const [forwardResults, setForwardResults] = useState<Array<{ id: string; name: string; amount: number; status: "ok" | "skipped" | "error"; reason?: string }>>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const dismissMissing = async (ids: string[]) => {
    if (!ids.length) return;
    setDismissingIds((s) => { const n = new Set(s); ids.forEach((i) => n.add(i)); return n; });
    try {
      const { error } = await (supabase as any)
        .from("top_up_requests")
        .update({
          forward_dismissed_at: new Date().toISOString(),
          forward_dismissed_by: user?.id ?? null,
        })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Removed ${ids.length} from list`);
      queryClient.invalidateQueries({ queryKey: ["admin-topup-requests"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to remove");
    } finally {
      setDismissingIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
    }
  };

  const runForwardMissing = async () => {
    if (!missingForwards.length) { toast.info("Nothing to forward."); return; }
    setForwardingMissing(true);
    setForwardResults([]);
    const results: typeof forwardResults = [];
    for (const r of missingForwards) {
      const name = r.profile?.full_name || r.profile?.email || r.user_id?.slice(0, 8) || "—";
      try {
        const { data, error } = await supabase.functions.invoke("forward-proof", { body: { request_id: r.id, force_resend: true } });
        if (error) throw error;
        if (data?.skipped) results.push({ id: r.id, name, amount: Number(r.amount || 0), status: "skipped", reason: data.reason });
        else results.push({ id: r.id, name, amount: Number(r.amount || 0), status: "ok" });
      } catch (e: any) {
        results.push({ id: r.id, name, amount: Number(r.amount || 0), status: "error", reason: e.message });
      }
      setForwardResults([...results]);
    }
    setForwardingMissing(false);
    const okCount = results.filter(r => r.status === "ok").length;
    toast.success(`Forwarded ${okCount} of ${results.length}`);
    queryClient.invalidateQueries({ queryKey: ["admin-topup-requests"] });
  };

  const summaryMetrics = useMemo(() => {
    if (!requests) return { totalUsd: 0, totalBdt: 0, autoApproved: 0, manualApproved: 0 };
    const from = dateRange?.from ? startOfDay(dateRange.from) : today;
    const to = dateRange?.to ? endOfDay(dateRange.to) : endOfDay(new Date());
    const approvedInRange = requests.filter((r: any) =>
      r.status === "approved" &&
      isWithinInterval(new Date(r.updated_at || r.created_at), { start: from, end: to })
    );
    const totalUsd = approvedInRange.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const totalBdt = approvedInRange.reduce((s: number, r: any) => s + Number(r.bdt_amount || 0), 0);
    const autoApproved = approvedInRange.filter((r: any) => !r.reviewed_by).length;
    const manualApproved = approvedInRange.filter((r: any) => !!r.reviewed_by).length;
    return { totalUsd, totalBdt, autoApproved, manualApproved };
  }, [requests, dateRange]);

  const processMutation = useMutation({
    mutationFn: async ({ id, action, userId, amount }: { id: string; action: ActionType; userId: string; amount: number }) => {
      const requestRow = requests?.find((r: any) => r.id === id);
      const isTenantPayment = requestRow?._source === "tenant";

      if (isTenantPayment) {
        // --- Tenant payment approval logic ---
        if (action === "approved") {
          // Use atomic RPC: marks pending->approved, increases limit once, writes ledger.
          const { error: rpcErr } = await (supabase as any).rpc("approve_tenant_limit_payment", {
            p_payment_id: id,
            p_admin: user!.id,
          });
          if (rpcErr) throw rpcErr;

          // For subscription payments we still need to extend paid_until.
          if (requestRow._payment_type === "subscription") {
            const tenant = requestRow._tenant;
            const tenantId = requestRow._tenant_id;
            const months = requestRow._duration_months || 1;
            const baseDate = tenant?.subscription_paid_until && new Date(tenant.subscription_paid_until) > new Date()
              ? new Date(tenant.subscription_paid_until) : new Date();
            baseDate.setMonth(baseDate.getMonth() + months);
            await (supabase as any).from("tenants").update({
              subscription_paid_until: baseDate.toISOString(),
              status: "active",
            }).eq("id", tenantId);
          }
        } else {
          // reject / hold — just update status with admin note (atomic guard)
          const updateData: any = { status: action, reviewed_by: user!.id };
          if (adminNote) updateData.admin_note = adminNote;
          const { data: updatedRows, error: updateError } = await (supabase as any)
            .from("tenant_payments")
            .update(updateData)
            .eq("id", id)
            .in("status", ["pending", "hold"])
            .select("id");
          if (updateError) throw updateError;
          if (!updatedRows?.length) {
            throw new Error("This payment was already processed (auto-verified or by another admin). Please refresh.");
          }
        }

        if (action === "approved") {
          const tenant = requestRow._tenant;
          const tenantId = requestRow._tenant_id;

          // Auto-sync to seller ledger if the receiving bank has a seller assigned.
          // Mirrors client top-up flow so tenant payments show up in the seller's
          // sheet/Telegram running total.
          const bankAccountId = requestRow.bank_account_id || requestRow._bank_account_id || null;
          const tenantBdtAmount = Number(requestRow._original_amount || requestRow.bdt_amount || 0);
          const tenantProofUrl = requestRow.proof_url || requestRow._proof_url || null;
          const tenantPaymentRef = requestRow.payment_reference || requestRow._payment_reference || null;
          if (bankAccountId && tenantBdtAmount > 0) {
            try {
              const { data: bankRow } = await (supabase as any)
                .from("bank_accounts")
                .select("seller_id, bank_name, account_number, telegram_group_id")
                .eq("id", bankAccountId)
                .single();
              if (bankRow?.seller_id) {
                // Insert ledger entry (idempotent: unique index on tenant_payment_id)
                const { data: insertedRow, error: ledgerErr } = await (supabase as any)
                  .from("seller_transactions")
                  .insert({
                    seller_id: bankRow.seller_id,
                    type: "tenant_payment",
                    bdt_amount: tenantBdtAmount,
                    usdt_amount: 0,
                    rate: 0,
                    description: `Tenant payment approved — ${tenant?.name || "Tenant"} (${requestRow._payment_type || "payment"})`,
                    bank_account_id: bankAccountId,
                    tenant_payment_id: id,
                    proof_url: tenantProofUrl,
                    status: "approved",
                    reviewed_by: user?.id,
                    reviewed_at: new Date().toISOString(),
                    entry_by_name: `Tenant: ${tenant?.name || "Unknown"}`,
                  })
                  .select("id")
                  .maybeSingle();
                if (ledgerErr && !String(ledgerErr.message || "").toLowerCase().includes("duplicate")) {
                  console.error("Tenant → seller ledger insert failed:", ledgerErr);
                }
                // If duplicate, look up the existing row so we can still pass its id
                let sellerTxnId = insertedRow?.id || null;
                if (!sellerTxnId) {
                  const { data: existingRow } = await (supabase as any)
                    .from("seller_transactions")
                    .select("id")
                    .eq("tenant_payment_id", id)
                    .maybeSingle();
                  sellerTxnId = existingRow?.id || null;
                }

                // Forward to Telegram with running Total line (uses computeDueAdvance
                // which now recognises 'tenant_payment')
                if (tenantProofUrl) {
                  try {
                    await supabase.functions.invoke("forward-seller-proof", {
                      body: {
                        seller_transaction_id: sellerTxnId,
                        payment_kind: "bdt_payment",
                        proof_url: tenantProofUrl,
                        seller_name: `Tenant: ${tenant?.name || "Unknown"}`,
                        seller_id: bankRow.seller_id,
                        bdt_amount: tenantBdtAmount,
                        bank_account_id: bankAccountId,
                        reference: tenantPaymentRef || `tenant:${id.slice(0, 8)}`,
                      },
                    });
                  } catch (fwdErr) {
                    console.error("Tenant → Telegram forward failed:", fwdErr);
                  }
                }
              } else {
                console.warn(
                  `Tenant payment ${id} approved but bank ${bankAccountId} has no seller_id — skipping ledger sync`,
                );
              }
            } catch (e) {
              console.error("Tenant → seller ledger sync threw:", e);
            }
          }
        }

        const tenantName = requestRow._tenant?.name || "Tenant";
        const actionLabel = action === "approved" ? "Tenant Payment Approved" : action === "rejected" ? "Tenant Payment Rejected" : "Tenant Payment On Hold";
        await logSystemAction(actionLabel, `৳${Number(requestRow._original_amount).toLocaleString()} for ${tenantName}${adminNote ? ` — ${adminNote}` : ""}`, user!.id, user!.email);
        return;
      }

      // --- Client top-up approval logic (existing) ---
      // System limit check for tenant mode
      if (action === "approved") {
        const { data: tenantSettings } = await supabase.from("site_settings").select("key, value").in("key", ["is_tenant", "license_system_limit", "license_total_used"]);
        const sMap: Record<string, string> = {};
        (tenantSettings || []).forEach((s: any) => { sMap[s.key] = s.value; });
        if (sMap.is_tenant === "true" && sMap.license_system_limit) {
          const remaining = (Number(sMap.license_system_limit) || 0) - (Number(sMap.license_total_used) || 0);
          if (amount > remaining) {
            throw new Error(`System limit exceeded! Remaining: $${remaining.toFixed(2)}, Requested: $${amount.toFixed(2)}`);
          }
        }
      }

      let autoApprovedByVerify = false;
      if (action === "approved") {
        const { data: reqData } = await supabase.from("top_up_requests").select("payment_reference").eq("id", id).single();
        const ref = reqData?.payment_reference;
        if (ref) {
          const { data: existing } = await supabase.from("top_up_requests").select("id").eq("payment_reference", ref).eq("status", "approved").neq("id", id);
          if (existing && existing.length > 0) throw new Error("This payment reference has already been used in an approved request!");
        }
        // Run verify-topup once to populate admin_note (Match Details).
        // Auto-approval still requires strict matching (ref + amount + account + SMS).
        // Manual admin approve is allowed even with mismatches — admin override.
        try {
          // Hard timeout: verify-topup can stall up to ~70s when the OCR provider
          // rate-limits and retries. Manual approve must never wait on that.
          const verifyPromise = supabase.functions
            .invoke('verify-topup', { body: { request_id: id } })
            .then((r: any) => r?.data);
          const vData: any = await Promise.race([
            verifyPromise,
            new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
          ]);
          if (vData?.auto_approved) autoApprovedByVerify = true;
        } catch (e) {
          // Don't block manual approve on verify-topup errors — just log
          console.warn('verify-topup call failed (non-blocking for manual approve):', e);
        }
      }
      const updateData: any = { status: action, reviewed_by: user!.id };
      if ((action === "rejected" || action === "hold") && adminNote) updateData.admin_note = adminNote;
      // Atomic guard: only update if still pending (prevents double-credit race with verify-topup auto-approval)
      const { data: updatedRows, error: updateError } = await supabase
        .from("top_up_requests")
        .update(updateData)
        .eq("id", id)
        .in("status", ["pending", "hold"])
        .select("id");
      if (updateError) throw updateError;
      if (!updatedRows?.length) {
        if (autoApprovedByVerify) return; // verify-topup already approved + credited; nothing more to do
        throw new Error("This request was already processed (auto-verified or by another admin). Please refresh the page.");
      }

      // Fix B: Consume any matching Telegram SMS so it can never trigger a
      // duplicate auto-approval on a different pending request later.
      // Match by amount + bank last4 within ±2h of the request creation time.
      if (action === "approved") {
        try {
          const reqRow = requests?.find((r: any) => r.id === id);
          const bdtAmt = Number(reqRow?.bdt_amount || 0);
          const last4 = reqRow?.bankAccount?.account_number?.replace(/\s+/g, "").slice(-4) || "";
          const ref = (reqRow?.payment_reference || "").trim();
          const createdAt = new Date(reqRow?.created_at || Date.now());
          const fromIso = new Date(createdAt.getTime() - 2 * 60 * 60 * 1000).toISOString();
          const toIso = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000).toISOString();
          if (bdtAmt > 0 || ref) {
            const { data: candidates } = await (supabase as any)
              .from("telegram_messages")
              .select("update_id, text, raw_update")
              .is("matched_request_id", null)
              .gte("created_at", fromIso)
              .lte("created_at", toIso)
              .order("created_at", { ascending: false })
              .limit(100);
            const getText = (m: any) => {
              const raw = m?.raw_update || {};
              const p = raw.message || raw.edited_message || raw.channel_post || raw.edited_channel_post || {};
              return (m?.text || p?.text || p?.caption || "") as string;
            };
            const target = (candidates || []).find((m: any) => {
              const text = getText(m);
              if (!text) return false;
              if (ref && text.toLowerCase().includes(ref.toLowerCase())) return true;
              if (bdtAmt > 0 && last4) {
                const digits = text.replace(/[^\d]/g, "");
                if (!digits.includes(last4)) return false;
                const nums = text.match(/[\d,]+/g) || [];
                return nums.some((n: string) => Math.abs(Number(n.replace(/,/g, "")) - bdtAmt) <= 15);
              }
              return false;
            });
            if (target) {
              await (supabase as any)
                .from("telegram_messages")
                .update({ matched_request_id: id })
                .eq("update_id", target.update_id)
                .is("matched_request_id", null);
            }
          }
        } catch (e) {
          console.error("SMS consume on manual approval failed (non-blocking):", e);
        }
      }

      if (action === "approved") {
        let finalAmount = amount;
        
        // Idempotency guard (Fix A): never double-credit.
        // If a top_up transaction already exists for this request_id, abort.
        const { data: existingTx } = await supabase
          .from("transactions")
          .select("id")
          .eq("reference_id", id)
          .eq("type", "top_up")
          .limit(1);
        if (existingTx && existingTx.length > 0) {
          throw new Error("This request was already credited to the wallet (duplicate prevention). Refresh the page.");
        }

        const reqRowForWallet = requests?.find((r: any) => r.id === id);
        const targetWalletKind: "primary" | "secondary" =
          (reqRowForWallet as any)?.target_wallet === "secondary" ? "secondary" : "primary";

        if (targetWalletKind === "secondary") {
          // Secondary (sheet-rate) wallet deposit — credited atomically by the
          // RPC (ledger row first, then balance) so no phantom balance.
          const { data: creditRes, error: creditErr } = await (supabase as any).rpc("credit_wallet_for_payment", {
            p_user_id: userId,
            p_amount: finalAmount,
            p_wallet_kind: "secondary",
            p_reference_id: id,
            p_description: `Wallet top-up approved (Secondary wallet @ ৳${actionDialog?.usdRate ?? ""}/USD)`,
            p_processed_by: `admin:${user!.id}`,
          });
          if (creditErr) {
            await supabase.from("top_up_requests").update({ status: "pending" }).eq("id", id).eq("status", "approved");
            throw creditErr;
          }
          if (creditRes && creditRes.success === false) {
            await supabase.from("top_up_requests").update({ status: "pending" }).eq("id", id).eq("status", "approved");
            throw new Error(creditRes.error || "Credit failed");
          }

          const { data: invNumData2 } = await supabase.rpc("generate_invoice_number" as any);
          await (supabase as any).from("invoices").insert({
            top_up_request_id: id,
            invoice_number: invNumData2 || `INV-${Date.now()}`,
            user_id: userId,
            amount: finalAmount,
            bdt_amount: actionDialog?.bdtAmount,
            usd_rate: actionDialog?.usdRate,
          });
        } else {


        // Wallet-due first → Sheet/card bill → remainder to wallet (mirror of verify-topup logic).
        // Kafela / Holy Gift style: if wallet balance is negative (CRM due), clear that BEFORE deducting sheet bill.
        try {
          const { data: cardBill } = await (supabase as any).from("card_bills").select("*").eq("user_id", userId).eq("status", "pending").limit(1);
          const hasBill = cardBill && cardBill.length > 0 && Number(cardBill[0].due_amount_bdt) > 0;
          const totalBdt = Number(actionDialog?.bdtAmount || 0);
          const rate = Number(actionDialog?.usdRate || 1);
          if (hasBill && totalBdt > 0) {
            // Step 1: clear wallet due (negative balance) first
            const { data: walletRow } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
            const curBal = Number(walletRow?.balance ?? 0);
            let remainingBdt = totalBdt;
            let walletDuePaidBdt = 0;
            if (curBal < 0) {
              const dueBdtFull = Math.abs(curBal) * rate;
              walletDuePaidBdt = Math.min(dueBdtFull, remainingBdt);
              remainingBdt -= walletDuePaidBdt;
            }

            // Step 2: sheet/card bill from whatever BDT remains
            const dueBdt = Number(cardBill[0].due_amount_bdt);
            const deductBdt = Math.min(dueBdt, remainingBdt);
            remainingBdt -= deductBdt;

            // Step 3: wallet credit USD = (wallet-due portion + remainder) / rate
            finalAmount = (remainingBdt + walletDuePaidBdt) / rate;

            const newDue = dueBdt - deductBdt;
            await (supabase as any).from("card_bills").update({
              status: newDue <= 0 ? "paid" : "pending",
              due_amount_bdt: newDue,
              updated_at: new Date().toISOString(),
            }).eq("id", cardBill[0].id);

            // Persist BDT split on the top-up request for the invoice
            try {
              await (supabase as any).from("top_up_requests").update({
                sheet_bill_bdt: deductBdt,
                wallet_due_paid_bdt: walletDuePaidBdt,
              }).eq("id", id);
            } catch (persistErr) {
              console.error("persist sheet_bill_bdt failed (non-blocking):", persistErr);
            }

            if (deductBdt > 0) {
              try {
                let clientName = "";
                try {
                  const { data: cp } = await supabase.from("profiles").select("full_name, email").eq("user_id", userId).single();
                  clientName = cp?.full_name || cp?.email || "";
                } catch {}
                await supabase.functions.invoke("sync-card-bills", {
                  body: { action: "write_payment", user_id: userId, amount_bdt: deductBdt, client_name: clientName },
                });
              } catch (e) { console.error("Sheet write failed:", e); }
            }
          }
        } catch (e) { console.error("Card bill check failed:", e); }

        // Does this client run a secondary (sheet-rate) wallet? If so the
        // payment is split: main due → secondary due (at the secondary rate) →
        // remainder deposited into the main wallet.
        let secondaryEnabled = false;
        try {
          const { data: prof } = await (supabase as any)
            .from("profiles").select("secondary_wallet_enabled").eq("user_id", userId).maybeSingle();
          secondaryEnabled = !!prof?.secondary_wallet_enabled;
        } catch {}

        if (secondaryEnabled && finalAmount > 0) {
          const rateForSplit = Number(actionDialog?.usdRate || 0);
          const bdtForSplit = rateForSplit > 0 ? finalAmount * rateForSplit : Number(actionDialog?.bdtAmount || 0);
          const { data: splitRes, error: splitErr } = await (supabase as any).rpc("distribute_deposit_bdt", {
            p_user_id: userId,
            p_bdt_amount: bdtForSplit,
            p_reference_id: id,
            p_processed_by: `admin:${user!.id}`,
          });
          if (splitErr) {
            await supabase.from("top_up_requests").update({ status: "pending" }).eq("id", id).eq("status", "approved");
            throw splitErr;
          }
          if (splitRes && splitRes.ok === false) {
            await supabase.from("top_up_requests").update({ status: "pending" }).eq("id", id).eq("status", "approved");
            throw new Error(splitRes.error || "Deposit split failed");
          }
        } else if (finalAmount > 0) {
          // Atomic credit: the RPC writes the ledger row and the wallet balance in
          // ONE transaction, so an approval can never end up with the money
          // missing (and a duplicate is rejected by the DB trigger).
          const { data: creditRes, error: creditErr } = await (supabase as any).rpc("credit_wallet_for_payment", {
            p_user_id: userId,
            p_amount: finalAmount,
            p_wallet_kind: "primary",
            p_reference_id: id,
            p_description: "Wallet top-up approved",
            p_processed_by: `admin:${user!.id}`,
          });
          if (creditErr) {
            // Roll the request back to pending so it is never left "approved but
            // not credited" — admin can safely retry.
            await supabase.from("top_up_requests").update({ status: "pending" }).eq("id", id).eq("status", "approved");
            throw creditErr;
          }
          if (creditRes && creditRes.success === false) {
            await supabase.from("top_up_requests").update({ status: "pending" }).eq("id", id).eq("status", "approved");
            throw new Error(creditRes.error || "Wallet credit failed");
          }
        }

        const { data: invNumData } = await supabase.rpc("generate_invoice_number" as any);
        await (supabase as any).from("invoices").insert({ top_up_request_id: id, invoice_number: invNumData || `INV-${Date.now()}`, user_id: userId, amount: finalAmount, bdt_amount: actionDialog?.bdtAmount, usd_rate: actionDialog?.usdRate });
        }
      }

      await supabase.from("notifications").insert({
        user_id: userId, type: "top_up_update",
        title: action === "approved" ? "Top-Up Approved" : action === "rejected" ? "Top-Up Rejected" : "Top-Up On Hold",
        message: action === "approved" ? `Your top-up of $${amount} has been approved.` : action === "rejected" ? `Your top-up of $${amount} was rejected.${adminNote ? " Reason: " + adminNote : ""}` : `Your top-up of $${amount} is on hold.${adminNote ? " Note: " + adminNote : ""}`,
        reference_id: id,
      } as any);

      // System log
      const actionLabel = action === "approved" ? "Top-Up Approved" : action === "rejected" ? "Top-Up Rejected" : "Top-Up On Hold";
      const clientProfile = requests?.find((r: any) => r.id === id)?.profile;
      const clientName = clientProfile?.full_name || clientProfile?.email || userId.slice(0, 8);
      await logSystemAction(actionLabel, `$${amount} for ${clientName}${adminNote ? ` — ${adminNote}` : ""}`, user!.id, user!.email);

      // Seller ledger sync + Telegram forward are now handled atomically by the
      // database trigger `sync_seller_transaction_for_approved_topup_trigger` on
      // `top_up_requests`. We mark telegram_forwarded=false up-front when the
      // bank has a Telegram group — the forward-proof edge function flips it to
      // true ONLY when Telegram actually accepts the message. This gives a
      // truthful Forwarded / Not-Forwarded / "—" signal in the UI.
      if (action === "approved") {
        try {
          const reqForSeller = requests?.find((r: any) => r.id === id);
          if (reqForSeller?.bank_account_id) {
            const { data: bankRow } = await (supabase as any)
              .from("bank_accounts")
              .select("telegram_group_id")
              .eq("id", reqForSeller.bank_account_id)
              .single();
            if (bankRow?.telegram_group_id) {
              // Only initialize to false if it's still null — never overwrite a
              // true that forward-proof may already have set (race-safe).
              await (supabase as any)
                .from("top_up_requests")
                .update({ telegram_forwarded: false })
                .eq("id", id)
                .is("telegram_forwarded", null);
            }
          }
        } catch (e) {
          console.error("Init telegram_forwarded=false failed (non-blocking):", e);
        }
      }
    },
    onSuccess: (_, { action }) => {
      toast.success(`Request ${action === "hold" ? "put on hold" : action}`);
      queryClient.invalidateQueries({ queryKey: ["admin-topup-requests"] });
      queryClient.invalidateQueries({ queryKey: ["admin-wallets"] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      queryClient.invalidateQueries({ queryKey: ["tenant-payments"] });
      setActionDialog(null); setAdminNote("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Manual resend for top-up rows where forward-proof never landed in Telegram.
  // Server-side claim_forward_slot guarantees idempotency — clicking twice
  // does NOT produce duplicate Telegram messages.
  const resendTopupForwardMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.functions.invoke("forward-proof", { body: { request_id: requestId, force_resend: true } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.skipped) toast.info(`Skipped: ${data.reason || "already forwarded"}`);
      else toast.success("Resent to Telegram!");
      queryClient.invalidateQueries({ queryKey: ["admin-topup-requests"] });
    },
    onError: (e: any) => toast.error(`Resend failed: ${e.message}`),
  });

  const openAction = (r: any, action: ActionType) => {
    setAdminNote("");
    setActionDialog({ id: r.id, action, userId: r.user_id, amount: r.amount, bdtAmount: r.bdt_amount, usdRate: r.usd_rate });
  };

  const getBankDisplay = (bank: any) => {
    if (!bank) return "—";
    const last4 = (bank.account_number || "").slice(-4);
    return `${bank.bank_name} ****${last4}`;
  };

  const getProcessedByLabel = (r: any) => {
    if (r.status === "pending") return "Pending";

    if (r.status === "approved" && !r.reviewed_by) {
      return "Auto Approved";
    }

    if (r.reviewerProfile) {
      return r.reviewerProfile.full_name || r.reviewerProfile.email || "Admin";
    }

    if (r.status === "approved") return "Approved by Admin";
    if (r.status === "rejected") return "Rejected by Admin";
    if (r.status === "hold") return "On Hold by Admin";
    return "—";
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className={cn("flex gap-2", isMobile ? "flex-col" : "items-center justify-between")}>
        <h1 className="text-xl md:text-2xl font-bold">Top-Up Requests</h1>
        <div className="flex items-center gap-2 self-start">
          <Button size="sm" variant="outline" onClick={fetchTelegram} disabled={isFetchingTelegram} className="gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            {isFetchingTelegram ? "Fetching..." : "Fetch Telegram"}
          </Button>
        </div>
      </div>

      {/* Date Picker & Summary Metrics */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={datePreset === "today" ? "default" : "outline"} onClick={() => handlePreset("today")}>Today</Button>
          <Button size="sm" variant={datePreset === "yesterday" ? "default" : "outline"} onClick={() => handlePreset("yesterday")}>Yesterday</Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant={datePreset === "custom" ? "default" : "outline"} className="gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" />
                {datePreset === "custom" && dateRange?.from
                  ? `${format(dateRange.from, "MMM d")}${dateRange.to && dateRange.to.getTime() !== dateRange.from.getTime() ? ` – ${format(dateRange.to, "MMM d")}` : ""}`
                  : "Date Range"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={(range) => { setDateRange(range); setDatePreset("custom"); }}
                numberOfMonths={isMobile ? 1 : 2}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {missingForwards.length > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setForwardMissingOpen(true)} className="gap-1.5">
              <Send className="h-3.5 w-3.5" />
              Forward Missing ({missingForwards.length})
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
          <MetricCard
            title="Total Top Up"
            value={`$${summaryMetrics.totalUsd.toLocaleString()}`}
            icon={DollarSign}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title="Payment Received"
            value={`৳${summaryMetrics.totalBdt.toLocaleString()}`}
            icon={Banknote}
            iconBg="bg-accent/20"
            iconColor="text-accent-foreground"
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title="Auto Approved"
            value={summaryMetrics.autoApproved}
            icon={Bot}
            iconBg="bg-secondary/50"
            iconColor="text-secondary-foreground"
            size={isMobile ? "xs" : "sm"}
          />
          <MetricCard
            title="Manual Approved"
            value={summaryMetrics.manualApproved}
            icon={UserCheck}
            iconBg="bg-muted"
            iconColor="text-muted-foreground"
            size={isMobile ? "xs" : "sm"}
          />
      </div>
      </div>

      <MissingCreditsCard />

      <div className="flex justify-end">
        <TelegramPollStatus />
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className={cn(isMobile ? "w-full grid grid-cols-4 gap-1 h-auto p-1" : "")}>
          <TabsTrigger value="all" className={cn(isMobile && "text-xs px-1")}>All</TabsTrigger>
          <TabsTrigger value="pending" className={cn(isMobile && "text-xs px-1")}>Pending</TabsTrigger>
          <TabsTrigger value="approved" className={cn(isMobile && "text-xs px-1")}>Approved</TabsTrigger>
          <TabsTrigger value="rejected" className={cn(isMobile && "text-xs px-1")}>Rejected</TabsTrigger>
          <TabsTrigger value="hold" className={cn(isMobile && "text-xs px-1")}>Hold</TabsTrigger>
          <TabsTrigger value="tenant" className={cn(isMobile && "text-xs px-1")}>🏢 Tenant</TabsTrigger>
          <TabsTrigger value="bank_sms" className={cn("gap-1", isMobile && "text-xs px-1")}>
            <MessageSquareText className="h-3.5 w-3.5" />
            SMS
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by bank last 4 digits, bank name, client, or reference..."
          className="pl-9 h-9 text-sm"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {statusFilter === "bank_sms" ? (
        <BankSmsTab />
      ) : isMobile ? (
        /* Mobile Card Layout */
        <div className="space-y-2.5">
          {filtered?.map((r: any) => (
            <Card key={r.id} className="border border-border/60 shadow-sm">
              <CardContent className="p-3 space-y-2">
                {/* Header: client + status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <Link to={r._source === "tenant" ? `/tenants/${r._tenant_id}` : `/clients/${r.user_id}`} className="text-sm font-semibold text-primary hover:underline truncate" onClick={(e) => e.stopPropagation()}>
                      {r.profile?.full_name || r.profile?.email || "Unknown"}
                    </Link>
                    {r._source === "tenant" && r._payment_type && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{r._payment_type}</span>
                    )}
                  </div>
                  <StatusBadge status={r.status} />
                </div>

                {/* Amount + Bank */}
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-semibold">{r.bdt_amount ? `৳${Number(r.bdt_amount).toLocaleString()}` : "—"}</span>
                    <span className="text-xs text-muted-foreground ml-1">(${Number(r.amount).toLocaleString()})</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{getBankDisplay(r.bankAccount)}</span>
                </div>

                {/* Ref + Proof */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-mono">{r.payment_reference || "—"}</span>
                  <div className="flex items-center gap-2">
                    {r.proof_url && (
                      <button onClick={() => setProofDialog(r.proof_url)} className="inline-flex items-center gap-1 text-primary text-xs">
                        <ImageIcon className="h-3.5 w-3.5" />
                        Proof
                      </button>
                    )}
                    <span className="text-muted-foreground">{format(new Date(r.created_at), "MMM d, hh:mm a")}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Processed By</span>
                  <span className="font-medium text-foreground">{getProcessedByLabel(r)}</span>
                </div>
                {r.status === "approved" && r._source !== "tenant" && r.bankAccount?.telegram_group_id && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Telegram</span>
                    <span className={cn("font-medium flex items-center gap-1", r.telegram_forwarded === true ? "text-green-600 dark:text-green-400" : r.telegram_forwarded === false ? "text-destructive" : "text-muted-foreground")}>
                      <Send className="h-3 w-3" />
                      {r.telegram_forwarded === true ? "Forwarded" : r.telegram_forwarded === false ? "Not Forwarded" : "—"}
                      {r.telegram_forwarded !== true && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 px-1.5 text-[10px] ml-1"
                          disabled={resendTopupForwardMutation.isPending}
                          onClick={() => resendTopupForwardMutation.mutate(r.id)}
                        >
                          Resend
                        </Button>
                      )}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t">
                  {(r.status === "pending" || r.status === "hold") && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-primary" onClick={() => openAction(r, "approved")}>
                        <Check className="h-3.5 w-3.5 mr-0.5" />Approve
                      </Button>
                      {r.status !== "hold" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-orange-500" onClick={() => openAction(r, "hold")}>
                          <Pause className="h-3.5 w-3.5 mr-0.5" />Hold
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 text-xs hover:text-destructive" onClick={() => openAction(r, "rejected")}>
                        <X className="h-3.5 w-3.5 mr-0.5" />Reject
                      </Button>
                    </>
                  )}
                  {r.status === "pending" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => reVerify(r.id)} disabled={verifyingIds[r.id]}>
                      <RotateCcw className={cn("h-3.5 w-3.5", verifyingIds[r.id] && "animate-spin")} />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className={cn("h-7 text-xs", expandedSms[r.id] && "text-primary")} onClick={() => toggleSms(r.id)}>
                    <MessageSquareText className="h-3.5 w-3.5 mr-0.5" />
                    SMS
                  </Button>
                  {r.status === "approved" && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                      <Link to={`/invoice/${r.id}`} target="_blank"><FileText className="h-3.5 w-3.5" /></Link>
                    </Button>
                  )}
                </div>

                {/* Expanded SMS */}
                {expandedSms[r.id] && (
                  <div className="pt-2 space-y-2">
                    {r.admin_note && (
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-semibold">Match Details</span>
                        </div>
                        <div className="space-y-1">
                          {r.admin_note.split(' | ').map((entry: string, i: number) => {
                            const cleaned = entry.replace(/^Auto-verification:\s*/, '').trim();
                            if (!cleaned) return null;
                            const isPass = cleaned.startsWith('✅');
                            const isFail = cleaned.startsWith('❌');
                            const isWarn = cleaned.startsWith('⚠️');
                            return (
                              <div key={i} className={cn("px-2 py-1.5 rounded-md border text-xs",
                                isPass ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400' :
                                isFail ? 'bg-destructive/10 border-destructive/30 text-destructive' :
                                isWarn ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400' :
                                'bg-muted/40 border-border text-muted-foreground'
                              )}>
                                {cleaned}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <BankSmsPanel request={r} />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {(!filtered || filtered.length === 0) && (
            <p className="text-center text-muted-foreground py-8 text-sm">No requests</p>
          )}
        </div>
      ) : (
        /* Desktop Table */
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {statusFilter === "all" ? "All" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Requests
              {filtered && ` (${filtered.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Bank</TableHead>
                  <TableHead className="text-xs">Client</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Ref</TableHead>
                  <TableHead className="text-xs">Proof</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Processed By</TableHead>
                  <TableHead className="text-xs">Fwd</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered?.map((r: any, idx: number) => (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap py-2 px-2">
                        <div>{format(new Date(r.created_at), "MMM d")}</div>
                        <div>{format(new Date(r.created_at), "hh:mm a")}</div>
                      </TableCell>
                      <TableCell className="text-xs py-2 px-2">{getBankDisplay(r.bankAccount)}</TableCell>
                      <TableCell className="py-2 px-2">
                        <Link to={r._source === "tenant" ? `/tenants/${r._tenant_id}` : `/clients/${r.user_id}`} className="text-xs font-medium text-primary hover:underline">
                          {r.profile?.full_name || r.profile?.email || "Unknown"}
                        </Link>
                        {r._source === "tenant" && r._payment_type && (
                          <span className="text-[9px] text-muted-foreground block">{r._payment_type}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2 px-2">
                        <div>
                          <span className="text-xs font-semibold">{r.bdt_amount ? `৳${Number(r.bdt_amount).toLocaleString()}` : "—"}</span>
                          <span className="text-[10px] text-muted-foreground block">${Number(r.amount).toLocaleString()}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono py-2 px-2 max-w-[120px] truncate">{r.payment_reference || "—"}</TableCell>
                      <TableCell className="py-2 px-2">
                        {r.proof_url ? (
                          <button onClick={() => setProofDialog(r.proof_url)} className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                            <ImageIcon className="h-3.5 w-3.5" />View
                          </button>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="py-2 px-2"><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2 px-2 max-w-[100px] truncate">
                        {getProcessedByLabel(r)}
                      </TableCell>
                      <TableCell className="py-2 px-2">
                        {r.status === "approved" && r._source !== "tenant" && r.bankAccount?.telegram_group_id ? (
                          <div className="flex items-center gap-1">
                            <span className={cn("text-[10px] font-medium flex items-center gap-0.5", r.telegram_forwarded === true ? "text-green-600 dark:text-green-400" : r.telegram_forwarded === false ? "text-destructive" : "text-muted-foreground")}>
                              <Send className="h-2.5 w-2.5" />
                              {r.telegram_forwarded === true ? "Yes" : r.telegram_forwarded === false ? "No" : "—"}
                            </span>
                            {r.telegram_forwarded === false && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 px-1 text-[9px]"
                                title="Resend to Telegram"
                                disabled={resendTopupForwardMutation.isPending}
                                onClick={() => resendTopupForwardMutation.mutate(r.id)}
                              >
                                ↻
                              </Button>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground text-[10px]">—</span>}
                      </TableCell>
                      <TableCell className="py-2 px-2">
                        <div className="flex gap-0.5">
                          {(r.status === "pending" || r.status === "hold") && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-primary" title="Approve" onClick={() => openAction(r, "approved")}><Check className="h-3.5 w-3.5" /></Button>
                              {r.status !== "hold" && <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-orange-500" title="Hold" onClick={() => openAction(r, "hold")}><Pause className="h-3.5 w-3.5" /></Button>}
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-destructive" title="Reject" onClick={() => openAction(r, "rejected")}><X className="h-3.5 w-3.5" /></Button>
                            </>
                          )}
                          {r.status === "pending" && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-primary" title="Re-verify" onClick={() => reVerify(r.id)} disabled={verifyingIds[r.id]}>
                              <RotateCcw className={`h-3.5 w-3.5 ${verifyingIds[r.id] ? 'animate-spin' : ''}`} />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className={cn("h-7 w-7 p-0", expandedSms[r.id] && "text-primary")} title="Bank SMS" onClick={() => toggleSms(r.id)}>
                            <MessageSquareText className="h-3.5 w-3.5" />
                          </Button>
                          {r.status === "approved" && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-primary" title="Invoice" asChild>
                              <Link to={`/invoice/${r.id}`} target="_blank"><FileText className="h-3.5 w-3.5" /></Link>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedSms[r.id] && (
                      <TableRow>
                        <TableCell colSpan={10} className="bg-muted/20 p-3 space-y-4">
                          {r.admin_note && (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <ClipboardCheck className="h-4 w-4 text-primary" />
                                <span className="text-sm font-semibold">Match Details</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                {r.admin_note.split(' | ').map((entry: string, i: number) => {
                                  const cleaned = entry.replace(/^Auto-verification:\s*/, '').trim();
                                  if (!cleaned) return null;
                                  const isPass = cleaned.startsWith('✅');
                                  const isFail = cleaned.startsWith('❌');
                                  const isWarn = cleaned.startsWith('⚠️');
                                  const parts = cleaned.match(/^(✅|❌|⚠️)\s*(.+?)(?:\s*\((.+)\))?$/);
                                  const icon = parts?.[1] || '';
                                  const label = parts?.[2] || cleaned;
                                  const detail = parts?.[3] || '';
                                  return (
                                    <div key={i} className={`px-3 py-2 rounded-lg border ${isPass ? 'bg-green-500/10 border-green-500/30' : isFail ? 'bg-destructive/10 border-destructive/30' : isWarn ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-muted/40 border-border'}`}>
                                      <div className={`text-xs font-medium ${isPass ? 'text-green-700 dark:text-green-400' : isFail ? 'text-destructive' : isWarn ? 'text-yellow-700 dark:text-yellow-400' : 'text-muted-foreground'}`}>
                                        {icon} {label}
                                      </div>
                                      {detail && <div className="text-[11px] text-muted-foreground mt-0.5 break-all">{detail}</div>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <MessageSquareText className="h-4 w-4 text-primary" />
                              <span className="text-sm font-semibold">Bank SMS Messages</span>
                            </div>
                            <BankSmsPanel request={r} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
                {(!filtered || filtered.length === 0) && (
                  <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">No requests</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Payment Proof Image Dialog */}
      <Dialog open={!!proofDialog} onOpenChange={() => setProofDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
          <DialogHeader><DialogTitle>Payment Proof</DialogTitle></DialogHeader>
          {proofDialog && (
            <a href={proofDialog} target="_blank" rel="noopener noreferrer">
              <img src={proofDialog} alt="Payment proof" className="max-h-[75vh] w-auto mx-auto rounded-md object-contain cursor-pointer hover:opacity-90 transition-opacity" />
            </a>
          )}
        </DialogContent>
      </Dialog>

      {/* Action Confirmation Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => { setActionDialog(null); setAdminNote(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.action === "approved" ? "Approve" : actionDialog?.action === "rejected" ? "Reject" : "Hold"} {(requests?.find((r: any) => r.id === actionDialog?.id)?._source === "tenant") ? "Tenant Payment" : "Top-Up Request"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {(() => {
              const row = requests?.find((r: any) => r.id === actionDialog?.id);
              const isTenant = row?._source === "tenant";
              if (actionDialog?.action === "approved") {
                if (isTenant) {
                  return row?._payment_type === "subscription"
                    ? `এটি ৳${Number(row?._original_amount || 0).toLocaleString()} subscription payment। Approve করলে ${row?._duration_months || 1} মাস subscription extend হবে।`
                    : `এটি ৳${Number(row?._original_amount || 0).toLocaleString()} limit purchase। Approve করলে system limit বাড়বে।`;
                }
                const wk = (row as any)?.target_wallet === "secondary" ? "Secondary (Sheet rate)" : "Main";
                return `This will add $${actionDialog?.amount?.toLocaleString()} USD to the client's ${wk} wallet${actionDialog?.bdtAmount ? ` (৳${Number(actionDialog.bdtAmount).toLocaleString()} BDT @ ৳${actionDialog.usdRate}/USD)` : ""}.`;

              }
              return actionDialog?.action === "rejected" ? "The client will be notified of the rejection." : "The request will be put on hold.";
            })()}
          </p>
          {(actionDialog?.action === "rejected" || actionDialog?.action === "hold") && (
            <div className="space-y-2">
              <Label>{actionDialog.action === "rejected" ? "Rejection Reason" : "Note"}</Label>
              <Textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder={actionDialog.action === "rejected" ? "Explain why..." : "Add a note..."} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionDialog(null); setAdminNote(""); }}>Cancel</Button>
            <Button
              variant={actionDialog?.action === "approved" ? "default" : actionDialog?.action === "rejected" ? "destructive" : "outline"}
              onClick={() => actionDialog && processMutation.mutate(actionDialog)}
              disabled={processMutation.isPending || (actionDialog?.action === "rejected" && !adminNote)}
            >
              {processMutation.isPending ? "Processing..." : actionDialog?.action === "approved" ? "Approve" : actionDialog?.action === "rejected" ? "Reject" : "Hold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={forwardMissingOpen} onOpenChange={(o) => { if (!forwardingMissing) setForwardMissingOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-3 md:p-6">
          <DialogHeader>
            <DialogTitle className="text-base md:text-lg">Forward Missing Top-Ups</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-hidden flex flex-col flex-1">
            <p className="text-xs md:text-sm text-muted-foreground">
              <b>{missingForwards.length}</b> approved top-up(s) Telegram-এ forward হয়নি · এর মধ্যে <b>{willCreateSheetCount}</b>-টি sheet-এও যোগ হবে, বাকি <b>{missingForwards.length - willCreateSheetCount}</b>-টি শুধু forward হবে।
            </p>

            {/* Mobile: card list */}
            <div className="md:hidden flex-1 overflow-auto space-y-2 -mx-1 px-1">
              {missingForwards.map((r: any) => {
                const res = forwardResults.find((x) => x.id === r.id);
                const name = r.profile?.full_name || r.profile?.email || r.user_id?.slice(0, 8) || "—";
                const tg = r.bankAccount?.telegram_group_id || "";
                const dismissing = dismissingIds.has(r.id);
                return (
                  <div key={r.id} className="rounded-md border bg-card p-2.5 text-xs space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{name}</div>
                        <div className="text-[11px] text-muted-foreground">{format(new Date(r.created_at), "MMM d, HH:mm")} · {r.bankAccount?.bank_name || "—"}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold">${Number(r.amount || 0).toLocaleString()}</div>
                        <div className="text-[11px] text-muted-foreground">৳{Number(r.bdt_amount || 0).toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        {r.mirror_present ? <span className="text-emerald-600">✅ In sheet</span> : <span className="text-amber-600">+ Sheet</span>}
                        {tg && <span className="font-mono text-muted-foreground truncate max-w-[100px]" title={tg}>📨 {tg.slice(-8)}</span>}
                        {res && (res.status === "ok" ? <span className="text-emerald-600">Sent ✅</span> : res.status === "skipped" ? <span className="text-yellow-600" title={res.reason}>Skipped</span> : <span className="text-destructive" title={res.reason}>Error</span>)}
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 px-2 text-rose-600"
                        disabled={dismissing || forwardingMissing}
                        onClick={() => dismissMissing([r.id])}
                        title="Manually handled — remove from list"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block max-h-80 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Client</TableHead>
                    <TableHead className="text-xs">Bank</TableHead>
                    <TableHead className="text-xs">USD</TableHead>
                    <TableHead className="text-xs">BDT</TableHead>
                    <TableHead className="text-xs">TG</TableHead>
                    <TableHead className="text-xs">Sheet</TableHead>
                    <TableHead className="text-xs">Result</TableHead>
                    <TableHead className="text-xs"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {missingForwards.map((r: any) => {
                    const res = forwardResults.find((x) => x.id === r.id);
                    const name = r.profile?.full_name || r.profile?.email || r.user_id?.slice(0, 8) || "—";
                    const tg = r.bankAccount?.telegram_group_id || "";
                    const dismissing = dismissingIds.has(r.id);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs whitespace-nowrap">{format(new Date(r.created_at), "MMM d, HH:mm")}</TableCell>
                        <TableCell className="text-xs">{name}</TableCell>
                        <TableCell className="text-xs">{r.bankAccount?.bank_name || "—"}</TableCell>
                        <TableCell className="text-xs font-medium">${Number(r.amount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">৳{Number(r.bdt_amount || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-[10px] font-mono" title={tg}>{tg ? tg.slice(-8) : "—"}</TableCell>
                        <TableCell className="text-xs">
                          {r.mirror_present ? <span className="text-emerald-600">✅</span> : <span className="text-amber-600">+sheet</span>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {!res ? <span className="text-muted-foreground">—</span> :
                            res.status === "ok" ? <span className="text-emerald-600">✅</span> :
                            res.status === "skipped" ? <span className="text-yellow-600" title={res.reason}>⚠️</span> :
                            <span className="text-destructive" title={res.reason}>❌</span>}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-600"
                            disabled={dismissing || forwardingMissing}
                            onClick={() => dismissMissing([r.id])}
                            title="Manually handled — remove from list">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setForwardMissingOpen(false)} disabled={forwardingMissing} className="w-full sm:w-auto">Close</Button>
            <Button onClick={runForwardMissing} disabled={forwardingMissing || missingForwards.length === 0} className="w-full sm:w-auto">
              {forwardingMissing ? `Forwarding... (${forwardResults.length}/${missingForwards.length})` : `Forward All (${missingForwards.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
