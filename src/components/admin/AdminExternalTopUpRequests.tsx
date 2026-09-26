import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { ExternalLink, Copy, X, Zap, GraduationCap, Download, Check, Bot } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { logSystemAction } from "@/lib/systemLog";


interface Req {
  id: string;
  ad_account_id: string;
  user_id: string;
  amount: number;
  status: string;
  wallet_kind: string | null;
  external_crm_name: string | null;
  external_topup_url: string | null;
  notes: string | null;
  admin_note: string | null;
  created_at: string;
  completed_at: string | null;
  rejected_at: string | null;
  last_error?: string | null;
  spend_cap_before?: number | null;
  spend_cap_after?: number | null;
  limit_status?: string | null;
}

export function AdminExternalTopUpRequests() {
  const { user, session } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [rejectReq, setRejectReq] = useState<Req | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autopilotToken, setAutopilotToken] = useState<string | null>(null);
  const [autopilotBusy, setAutopilotBusy] = useState(false);


  const { data: requests = [] } = useQuery({
    queryKey: ["admin-external-topup-requests"],
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("external_topup_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("admin-external-topup-requests-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "external_topup_requests" },
        () => {
          void qc.invalidateQueries({ queryKey: ["admin-external-topup-requests"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  const accountIds = [...new Set(requests.map((r) => r.ad_account_id).filter(Boolean))];
  const userIds = [...new Set(requests.map((r) => r.user_id).filter(Boolean))];

  const { data: accounts = [] } = useQuery({
    queryKey: ["ext-req-accounts", accountIds.join(",")],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_accounts")
        .select("id, account_id, account_name, external_topup_url, external_topup_url_secondary, external_topup_url_credit_line, external_crm_name")
        .in("id", accountIds);
      return data ?? [];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["ext-req-profiles", userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", userIds);
      return data ?? [];
    },
  });

  const acc = (id: string) => (accounts as any[]).find((a) => a.id === id);
  const prof = (id: string) => (profiles as any[]).find((p) => p.user_id === id);

  const pending = requests.filter((r) => r.status === "pending");
  const history = requests.filter((r) => r.status !== "pending");

  const walletName = (k?: string | null) =>
    k === "credit_line" ? "Credit Line" : k === "secondary" ? "Secondary" : "Main";

  const cleanId = (r: Req) => (acc(r.ad_account_id)?.account_id ?? "").replace(/^act_/, "");

  const resolveUrl = (r: Req) => {
    const a = acc(r.ad_account_id);
    if (r.wallet_kind === "credit_line") return a?.external_topup_url_credit_line || a?.external_topup_url || r.external_topup_url || "";
    if (r.wallet_kind === "secondary") return a?.external_topup_url_secondary || a?.external_topup_url || r.external_topup_url || "";
    return a?.external_topup_url || r.external_topup_url || "";
  };

  // Keep token signing and callback verification on this project's deployment.
  const apiBase = () => "https://crm-korbo-plan.lovable.app/api/public/crm-topup";

  const createRemoteJob = async (action: "create_job" | "create_learn" | "create_autopilot", data: Record<string, string>) => {
    const accessToken = session?.access_token;
    if (!accessToken) throw new Error("Please sign in again");
    const response = await fetch(apiBase(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action, ...data }),
    });
    const result = await response.json();
    if (!response.ok || !result?.ok) throw new Error(result?.error || "Failed to create helper link");
    return result;
  };

  const openWithHash = (url: string, hash: string) => {
    const a = document.createElement("a");
    a.href = `${url}${url.includes("#") ? "" : "#"}${hash}`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Approve & Top-Up: opens the CRM with a short-lived signed job so the
  // browser helper can search the account, fill the amount and submit.
  const handleAutoTopUp = async (r: Req) => {
    const url = resolveUrl(r);
    if (!url) {
      toast.error("No external CRM link configured for this account");
      return;
    }
    setBusyId(r.id);
    try {
      const res = await createRemoteJob("create_job", { requestId: r.id, url });
      // Approve the request right away — the helper does the CRM top-up, and if
      // it ever fails the admin handles that request manually.
      const { data: done, error: doneErr } = await (supabase as any).rpc("complete_external_topup", { p_id: r.id });
      if (doneErr) throw new Error(doneErr.message);
      if (!done?.ok) throw new Error(done?.error || "Failed to approve request");
      openWithHash(url, `crmtopup=${encodeURIComponent(res.token)}&api=${encodeURIComponent(apiBase())}`);
      toast.success("Request approved — CRM opened, helper is filling the top-up form");
      await logSystemAction(
        "External Top-up Automation Started",
        `Account ${cleanId(r)} — $${Number(r.amount)} (${walletName(r.wallet_kind).toLowerCase()} wallet)`,
        user?.id,
        user?.email
      );
      qc.invalidateQueries({ queryKey: ["admin-external-topup-requests"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to start automation");
    } finally {
      setBusyId(null);
    }
  };

  // One-time Learn mode for a CRM site.
  const handleTeach = async (r: Req) => {
    const url = resolveUrl(r);
    if (!url) {
      toast.error("No external CRM link configured for this account");
      return;
    }
    setBusyId(r.id);
    try {
      const res = await createRemoteJob("create_learn", { url });
      openWithHash(url, `crmlearn=${encodeURIComponent(res.token)}&api=${encodeURIComponent(apiBase())}`);
      toast.success("Setup mode opened — follow the helper's instructions");
    } catch (e: any) {
      toast.error(e?.message || "Failed to open setup");
    } finally {
      setBusyId(null);
    }
  };

  // Auto-pilot: mint a 30-day token for the browser helper. The extension
  // then processes new pending requests by itself the moment they arrive.
  const handleAutopilot = async () => {
    setAutopilotBusy(true);
    try {
      const res = await createRemoteJob("create_autopilot", {});
      setAutopilotToken(res.token);
    } catch (e: any) {
      toast.error(e?.message || "Failed to create Auto-pilot token");
    } finally {
      setAutopilotBusy(false);
    }
  };

  const downloadHelper = () => {
    fetch("/crm-topup-extension.zip?v=1.7.0", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "crm-topup-helper-v1.7.0.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => toast.error(err.message));
  };



  const handleOpenAndComplete = async (r: Req) => {
    const url = resolveUrl(r);
    if (!url) {
      toast.error("No external CRM link configured for this account");
      return;
    }
    setBusyId(r.id);
    try {
      try {
        await navigator.clipboard.writeText(`${cleanId(r)}\t${Number(r.amount)}`);
      } catch {}
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      const { data, error } = await (supabase as any).rpc("complete_external_topup", { p_id: r.id });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Failed to complete");

      await logSystemAction(
        "External Top-up Completed",
        `Account ${cleanId(r)} — $${Number(r.amount)} (${walletName(r.wallet_kind).toLowerCase()} wallet)`,
        user?.id,
        user?.email
      );
      toast.success("Account ID & amount copied. Request marked completed.");
      qc.invalidateQueries({ queryKey: ["admin-external-topup-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-external-topup-pending-count"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to complete request");
    } finally {
      setBusyId(null);
    }
  };

  // Manual fallback: the CRM top-up already went through, so credit the request
  // without reopening the CRM.
  const handleMarkCompleted = async (r: Req) => {
    // Always record the new spend cap so the client sees "old → new" + Completed.
    return markManual(r);
    setBusyId(r.id);
    try {
      const { data, error } = await (supabase as any).rpc("complete_external_topup", { p_id: r.id });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Failed to complete");
      await logSystemAction(
        "External Top-up Marked Completed",
        `Account ${cleanId(r)} — $${Number(r.amount)} (${walletName(r.wallet_kind).toLowerCase()} wallet)`,
        user?.id,
        user?.email
      );
      toast.success("Request marked completed");
      qc.invalidateQueries({ queryKey: ["admin-external-topup-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-external-topup-pending-count"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to complete request");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {

    if (!rejectReq) return;
    setBusyId(rejectReq.id);
    try {
      const { data, error } = await (supabase as any).rpc("reject_external_topup", {
        p_id: rejectReq.id,
        p_note: rejectNote || null,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || "Failed to reject");
      toast.success("Request rejected & amount refunded");
      setRejectReq(null);
      setRejectNote("");
      qc.invalidateQueries({ queryKey: ["admin-external-topup-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-external-topup-pending-count"] });
      qc.invalidateQueries({ queryKey: ["admin-wallets"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to reject");
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const statusBadge = (s: string) => {
    if (s === "pending") return <Badge variant="outline" className="text-amber-600 border-amber-400">Pending</Badge>;
    if (s === "completed") return <Badge className="bg-emerald-600 text-white">Completed</Badge>;
    if (s === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    return <Badge variant="secondary">{s}</Badge>;
  };

  const markManual = async (r: Req) => {
    setBusyId(r.id);
    try {
      // Pull this account fresh from Meta, then verify the limit actually increased.
      await supabase.functions.invoke("get-account-insights", {
        body: { ad_account_ids: [r.ad_account_id], source: "meta" },
      }).catch(() => null);
      const { data: accRow } = await (supabase as any)
        .from("ad_accounts").select("spend_cap").eq("id", r.ad_account_id).maybeSingle();
      const cap = Number(accRow?.spend_cap ?? 0);
      const before = Number(r.spend_cap_before ?? 0);
      if (!(cap > before + 0.01)) {
        toast.error(`Meta-তে limit এখনো বাড়েনি (এখন $${cap.toLocaleString()}, আগে $${before.toLocaleString()})। একটু পরে আবার চেষ্টা করুন।`);
        return;
      }
      const { data, error } = await (supabase as any).rpc("admin_mark_external_topup_manual", {
        p_id: r.id, p_new_cap: cap, p_note: null,
      });
      if (error || !data?.ok) { toast.error(error?.message || data?.error || "Failed"); return; }
      toast.success(`Completed — $${before.toLocaleString()} → $${cap.toLocaleString()}`);
      qc.invalidateQueries({ queryKey: ["admin-external-topup-requests"] });
    } finally {
      setBusyId(null);
    }
  };

  const limitInfo = (r: Req) => {
    if (r.status === "rejected") return null;
    const stale = r.limit_status === "pending" && Date.now() - new Date(r.created_at).getTime() > 30 * 60 * 1000;
    const bad = r.limit_status === "not_updated" || stale;
    return (
      <div className="flex flex-wrap items-center justify-end gap-1 text-xs">
        {r.spend_cap_before != null && (
          <span className="whitespace-nowrap">
            ${Number(r.spend_cap_before).toLocaleString()} →{" "}
            {r.spend_cap_after != null ? (
              <b>${Number(r.spend_cap_after).toLocaleString()}</b>
            ) : bad ? (
              <span className="text-destructive">Limit বাড়েনি</span>
            ) : (
              <span className="text-amber-600">Updating…</span>
            )}
          </span>
        )}
        {r.limit_status === "manual" && <Badge variant="secondary" className="text-[10px]">Manual</Badge>}
        {r.spend_cap_after == null && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={busyId === r.id} onClick={() => markManual(r)}>
            Manually done
          </Button>
        )}
      </div>
    );
  };

  const renderRow = (r: Req, isPending: boolean) => {
    const a = acc(r.ad_account_id);
    const p = prof(r.user_id);
    return (
      <TableRow key={r.id}>
        <TableCell>
          <div className="font-medium text-sm">{a?.account_name ?? "—"}</div>
          <button
            className="font-mono text-xs text-muted-foreground hover:text-primary"
            onClick={() => copy(cleanId(r), "Account ID")}
          >
            {cleanId(r) || "—"} <Copy className="inline h-3 w-3" />
          </button>
        </TableCell>
        <TableCell>
          <div className="text-sm">{p?.full_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{p?.email ?? ""}</div>
        </TableCell>
        <TableCell>
          <button className="font-semibold hover:text-primary" onClick={() => copy(String(Number(r.amount)), "Amount")}>
            ${Number(r.amount).toLocaleString()} <Copy className="inline h-3 w-3" />
          </button>
        </TableCell>
        <TableCell>
          <Badge variant={r.wallet_kind && r.wallet_kind !== "primary" ? "secondary" : "outline"}>
            {walletName(r.wallet_kind)}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {a?.external_crm_name || r.external_crm_name || "External CRM"}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {format(new Date(r.created_at), "dd MMM yyyy HH:mm")}
        </TableCell>
        <TableCell>
          {statusBadge(r.status)}
          {r.last_error && (
            <div className="text-[10px] text-destructive max-w-[180px] truncate" title={r.last_error}>
              {r.last_error}
            </div>
          )}
        </TableCell>
        <TableCell className="text-right">
          {isPending ? (
            <div className="flex gap-1 justify-end">
              <Button
                size="sm"
                className="bg-violet-600 hover:bg-violet-700 text-white"
                disabled={busyId === r.id}
                onClick={() => handleAutoTopUp(r)}
                title="Opens the CRM and lets the helper fill the top-up form"
              >
                <Zap className="h-3.5 w-3.5 mr-1" />
                Approve & Top-Up
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-amber-600"
                disabled={busyId === r.id}
                onClick={() => handleOpenAndComplete(r)}
                title="Open CRM manually and mark completed"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-600"
                disabled={busyId === r.id}
                onClick={() => handleMarkCompleted(r)}
                title="Top-up already done in CRM — mark completed"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busyId === r.id}
                onClick={() => handleTeach(r)}
                title="Teach the helper this CRM (one time)"
              >
                <GraduationCap className="h-3.5 w-3.5" />
              </Button>

              <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => setRejectReq(r)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              {limitInfo(r)}
              <span className="block text-xs text-muted-foreground">
                {r.admin_note || (r.completed_at ? format(new Date(r.completed_at), "dd MMM HH:mm") : "")}
              </span>
            </div>
          )}
        </TableCell>
      </TableRow>
    );
  };

  const renderCard = (r: Req, isPending: boolean) => {
    const a = acc(r.ad_account_id);
    const p = prof(r.user_id);
    return (
      <Card key={r.id}>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium text-sm">{a?.account_name ?? "—"}</div>
              <button className="font-mono text-xs text-muted-foreground" onClick={() => copy(cleanId(r), "Account ID")}>
                {cleanId(r) || "—"} <Copy className="inline h-3 w-3" />
              </button>
            </div>
            {statusBadge(r.status)}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">${Number(r.amount).toLocaleString()}</span>
            <Badge variant={r.wallet_kind && r.wallet_kind !== "primary" ? "secondary" : "outline"}>
              {walletName(r.wallet_kind)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {p?.full_name ?? "—"} · {format(new Date(r.created_at), "dd MMM HH:mm")}
          </div>
          {!isPending && limitInfo(r)}
          {isPending && (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                disabled={busyId === r.id}
                onClick={() => handleAutoTopUp(r)}
              >
                <Zap className="h-3.5 w-3.5 mr-1" />
                Approve & Top-Up
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-amber-600"
                disabled={busyId === r.id}
                onClick={() => handleOpenAndComplete(r)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-emerald-600"
                disabled={busyId === r.id}
                onClick={() => handleMarkCompleted(r)}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>


              <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => setRejectReq(r)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const list = (rows: Req[], isPending: boolean) => {
    if (rows.length === 0)
      return <Card><CardContent className="text-center text-muted-foreground py-8 text-sm">No requests</CardContent></Card>;
    if (isMobile) return <div className="space-y-3">{rows.map((r) => renderCard(r, isPending))}</div>;
    return (
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad Account</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>CRM</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{rows.map((r) => renderRow(r, isPending))}</TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="border-violet-500/30 bg-violet-500/5">
        <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            <b className="text-foreground">Approve &amp; Top-Up</b> opens the CRM in your logged-in browser and the helper
            fills the account &amp; amount for you. New CRM? Run <b>Teach</b> (cap icon) once.
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleAutopilot} disabled={autopilotBusy}>
              <Bot className="h-3.5 w-3.5 mr-1" />
              {autopilotBusy ? "Creating…" : "Auto-pilot"}
            </Button>
            <Button size="sm" variant="outline" onClick={downloadHelper}>
              <Download className="h-3.5 w-3.5 mr-1" />
                Download helper (v1.7.0)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending
            {pending.length > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-3">{list(pending, true)}</TabsContent>
        <TabsContent value="history" className="mt-3">{list(history, false)}</TabsContent>
      </Tabs>

      <Dialog open={!!autopilotToken} onOpenChange={(o) => !o && setAutopilotToken(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Auto-pilot চালু করুন</DialogTitle>
            <DialogDescription>
              এই token-টা helper extension-এ একবার বসালেই নতুন external top-up request আসামাত্র টপ-আপ নিজে নিজে হয়ে যাবে — এই ব্রাউজারে Chrome চালু ও CRM-এ লগইন থাকা লাগবে। Token ৩০ দিন কাজ করবে।
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <textarea
              readOnly
              className="w-full h-24 rounded-md border bg-muted p-2 font-mono text-[11px]"
              value={autopilotToken ?? ""}
              onFocus={(e) => e.target.select()}
            />
            <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-1">
              <li>উপরের token কপি করুন।</li>
              <li>Chrome-এ helper extension-এর আইকনে ক্লিক করুন।</li>
              <li>Auto-pilot ঘরে token বসিয়ে <b>Auto-pilot চালু করুন</b> চাপুন।</li>
            </ol>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (autopilotToken) navigator.clipboard.writeText(autopilotToken).then(() => toast.success("Token copied"));
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copy token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectReq} onOpenChange={(o) => !o && setRejectReq(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject top-up request</DialogTitle>
            <DialogDescription>
              ${Number(rejectReq?.amount ?? 0).toLocaleString()} will be refunded to the client's{" "}
              {walletName(rejectReq?.wallet_kind).toLowerCase()} wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Reason (optional)"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectReq(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject} disabled={busyId === rejectReq?.id}>
              Reject & Refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
