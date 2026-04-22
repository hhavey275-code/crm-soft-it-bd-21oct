import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Play, Pause, DollarSign, RefreshCw, Search, Eye, MousePointer, AlertTriangle,
  Trash2, CheckCircle2, Clock, XCircle, Archive, Shield, ShieldCheck, MoreVertical,
  Megaphone, Inbox, TrendingDown, ChevronDown, Edit,
} from "lucide-react";
import { format, subDays, formatDistanceToNow } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCampaignStatusConfig, type CampaignRule } from "./types";
import { SpendCapRuleDialog } from "./SpendCapRuleDialog";
import { CostPerResultRuleDialog } from "./CostPerResultRuleDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAdsManagerCampaigns } from "@/hooks/useAdsManagerCampaigns";

interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time: string;
  insights?: {
    spend?: string;
    impressions?: string;
    clicks?: string;
    cpc?: string;
    ctr?: string;
    cpm?: string;
    actions?: Array<{ action_type: string; value: string }>;
  };
}

interface CampaignListProps {
  accountId: string;
}

function StatusIcon({ name, className }: { name?: string; className?: string }) {
  if (name === "check") return <CheckCircle2 className={className} />;
  if (name === "pause") return <Pause className={className} />;
  if (name === "clock") return <Clock className={className} />;
  if (name === "x") return <XCircle className={className} />;
  if (name === "alert") return <AlertTriangle className={className} />;
  if (name === "archive") return <Archive className={className} />;
  return null;
}

function CampaignStatusBadge({ status }: { status: string }) {
  const cfg = getCampaignStatusConfig(status);
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", cfg.className)}>
      {cfg.pulse && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" /></span>}
      {!cfg.pulse && cfg.icon && <StatusIcon name={cfg.icon} className="h-3 w-3" />}
      {cfg.label}
    </Badge>
  );
}

export function CampaignList({ accountId }: CampaignListProps) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFrom] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [dateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [budgetDialog, setBudgetDialog] = useState<Campaign | null>(null);
  const [newBudget, setNewBudget] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [spendDialog, setSpendDialog] = useState<{ open: boolean; campaignId?: string; campaignName?: string; existing?: CampaignRule }>({ open: false });
  const [cprDialog, setCprDialog] = useState<{ open: boolean; campaignId?: string; campaignName?: string; existing?: CampaignRule }>({ open: false });

  const {
    campaigns: fetchedCampaigns,
    isLoading,
    isError,
    error,
    fetchCampaigns,
    dataUpdatedAt,
    via,
    proxyIp,
    hasFetched,
  } = useAdsManagerCampaigns({
    accountId,
    statusFilter,
    dateFrom,
    dateTo,
  });

  const { data: rulesData } = useQuery({
    queryKey: ["ads-manager-rules", accountId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "list_rules", account_id: accountId },
      });
      if (error) throw error;
      return data as { rules: CampaignRule[] };
    },
    staleTime: 1000 * 60 * 5,
  });

  const accountRule = useMemo<CampaignRule | undefined>(() => {
    return (rulesData?.rules || []).find((r) => !r.campaign_id);
  }, [rulesData]);

  const perCampaignRules = useMemo(() => {
    const map: Record<string, CampaignRule> = {};
    for (const r of rulesData?.rules || []) {
      if (r.campaign_id) map[r.campaign_id] = r;
    }
    return map;
  }, [rulesData]);

  const toggleStatus = useMutation({
    mutationFn: async ({ campaignId, newStatus }: { campaignId: string; newStatus: string }) => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "update_status", account_id: accountId, campaign_id: campaignId, new_status: newStatus },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => toast.success("Campaign status updated"),
    onError: (err: any) => toast.error(err.message),
  });

  const updateBudget = useMutation({
    mutationFn: async ({ campaignId, budget }: { campaignId: string; budget: number }) => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "update_budget", account_id: accountId, campaign_id: campaignId, daily_budget: budget },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Budget updated");
      setBudgetDialog(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteCampaigns = useMutation({
    mutationFn: async (campaign_ids: string[]) => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "delete_campaigns", account_id: accountId, campaign_ids },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: string[]; failed: Array<{ id: string; error: string }> };
    },
    onSuccess: (res) => {
      if (res.success.length) toast.success(`Deleted ${res.success.length} campaign(s)`);
      if (res.failed.length) toast.error(`Failed: ${res.failed.length} (${res.failed[0].error})`);
      setSelectedIds(new Set());
      setConfirmDelete(null);
    },
    onError: (err: any) => {
      toast.error(err.message);
      setConfirmDelete(null);
    },
  });

  const campaigns = useMemo(() => {
    let list = fetchedCampaigns || [];
    if (statusFilter !== "all") {
      list = list.filter((c) => c.effective_status?.toLowerCase().includes(statusFilter.toLowerCase()));
    }
    if (searchTerm) list = list.filter((c) => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
    return list;
  }, [fetchedCampaigns, searchTerm, statusFilter]);

  const allSelected = campaigns.length > 0 && campaigns.every((c) => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(campaigns.map((c) => c.id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleUpdate = async () => {
    await fetchCampaigns();
    queryClient.invalidateQueries({ queryKey: ["ads-manager-rules", accountId] });
    toast.success("Campaigns updated");
  };

  const formatBudget = (val?: string) => (!val ? "—" : `$${(parseInt(val) / 100).toFixed(2)}`);

  const getResults = (actions?: Array<{ action_type: string; value: string }>) => {
    if (!actions?.length) return "—";
    const purchase = actions.find((a) => a.action_type === "purchase" || a.action_type === "omni_purchase");
    const lead = actions.find((a) => a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped");
    const link = actions.find((a) => a.action_type === "link_click");
    const result = purchase || lead || link || actions[0];
    return `${result.value} ${result.action_type.replace(/_/g, " ")}`;
  };

  const openBudgetDialog = (camp: Campaign) => {
    setBudgetDialog(camp);
    setNewBudget(camp.daily_budget ? (parseInt(camp.daily_budget) / 100).toString() : "");
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search campaigns..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="in_process">In Review</SelectItem>
            <SelectItem value="disapproved">Disapproved</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={selectionMode ? "secondary" : "outline"}
          size="icon"
          onClick={() => { setSelectionMode(!selectionMode); if (selectionMode) setSelectedIds(new Set()); }}
          title="Toggle selection"
        >
          <Checkbox checked={selectionMode} className="pointer-events-none" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={accountRule ? "default" : "outline"} className="gap-2" title="Auto-pause rules">
              {accountRule ? <ShieldCheck className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
              <span className="hidden sm:inline">Auto-Pause</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Account-wide rules</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setSpendDialog({ open: true, existing: accountRule })}>
              <DollarSign className="h-4 w-4 mr-2" /> Spend Cap Rule {accountRule ? `($${accountRule.max_spend})` : ""}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCprDialog({ open: true })}>
              <TrendingDown className="h-4 w-4 mr-2" /> Cost Per Result Rule
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={handleUpdate} disabled={isLoading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          {hasFetched ? "Fetch Again" : "Fetch Campaigns"}
        </Button>
      </div>

      {/* Active Rules Panel */}
      {(rulesData?.rules || []).length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> Active Auto-Pause Rules ({(rulesData?.rules || []).length})
          </p>
          <div className="space-y-1.5">
            {(rulesData?.rules || []).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md bg-background border p-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] py-0 h-4">
                      {r.rule_type === "cost_per_result" ? "CPR" : "SPEND"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] py-0 h-4 capitalize">{r.target_level}</Badge>
                    {!r.enabled && <Badge variant="outline" className="text-[10px] py-0 h-4 text-muted-foreground">disabled</Badge>}
                    <span className="font-medium truncate">
                      {r.rule_type === "cost_per_result"
                        ? `Pause if CPR > $${r.max_cost_per_result} (${r.result_event})`
                        : `Pause if spend ≥ $${r.max_spend}`}
                    </span>
                  </div>
                  <p className="text-muted-foreground truncate mt-0.5">
                    {r.target_name || r.campaign_name || "All campaigns"}
                    {r.last_action ? ` · ${r.last_action}` : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => {
                    if (r.rule_type === "cost_per_result") {
                      setCprDialog({ open: true, campaignId: r.campaign_id || undefined, campaignName: r.campaign_name || undefined, existing: r });
                    } else {
                      setSpendDialog({ open: true, campaignId: r.campaign_id || undefined, campaignName: r.campaign_name || undefined, existing: r });
                    }
                  }}
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {dataUpdatedAt > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <p>Last updated {formatDistanceToNow(dataUpdatedAt, { addSuffix: true })}</p>
          {via && <Badge variant="outline" className="h-5 px-2 text-[10px] capitalize">via {via}</Badge>}
          {proxyIp && <Badge variant="outline" className="h-5 px-2 text-[10px] font-mono">IP: {proxyIp}</Badge>}
        </div>
      )}

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-primary/5 p-3 sticky top-0 z-10 shadow-sm">
          <p className="text-sm font-medium">{selectedIds.size} selected</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            <Button variant="destructive" size="sm" className="gap-2" onClick={() => setConfirmDelete({ ids: Array.from(selectedIds), label: `${selectedIds.size} campaign(s)` })}>
              <Trash2 className="h-4 w-4" /> Delete ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : isError ? (
        <div className="text-center py-12 space-y-3 rounded-lg border border-destructive/20 bg-destructive/5">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-destructive font-medium">Failed to load campaigns</p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{(error as Error)?.message || "Unknown error"}</p>
          <Button variant="outline" size="sm" onClick={() => fetchCampaigns()}><RefreshCw className="h-4 w-4 mr-2" /> Retry</Button>
        </div>
      ) : !hasFetched ? (
        <div className="text-center py-16 rounded-lg border-2 border-dashed bg-muted/20">
          <Megaphone className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">Campaign fetch ready</p>
          <p className="text-sm text-muted-foreground mt-1">Button চাপলে proxy IP দিয়ে campaigns load হবে, আর system log-এ save হবে।</p>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16 rounded-lg border-2 border-dashed bg-muted/20">
          <Inbox className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">No campaigns found</p>
          <p className="text-sm text-muted-foreground mt-1">এই অ্যাড অ্যাকাউন্টে এখনো কোনো ক্যাম্পেইন নেই।</p>
        </div>
      ) : isMobile ? (
        <div className="space-y-3">
          {selectionMode && (
            <div className="flex items-center gap-2 px-1 py-1">
              <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} />
              <span className="text-xs text-muted-foreground">Select all ({campaigns.length})</span>
            </div>
          )}
          {campaigns.map((camp) => {
            const isActive = camp.effective_status === "ACTIVE";
            const ins = camp.insights;
            const checked = selectedIds.has(camp.id);
            const rule = perCampaignRules[camp.id] || accountRule;
            const spend = ins?.spend ? parseFloat(ins.spend) : 0;
            const ratio = rule ? Math.min(spend / Number(rule.max_spend), 1) : 0;
            return (
              <Card key={camp.id} className={cn("p-3 space-y-3 transition-all hover:shadow-md", checked && "ring-2 ring-primary bg-primary/5")}>
                <div className="flex items-start gap-2">
                  {selectionMode && <Checkbox checked={checked} onCheckedChange={() => toggleOne(camp.id)} className="mt-1" />}
                  <Megaphone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{camp.name}</p>
                    <p className="text-xs text-muted-foreground capitalize truncate">{camp.objective?.toLowerCase().replace(/_/g, " ") || "—"}</p>
                  </div>
                  <CampaignStatusBadge status={camp.effective_status} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-green-500/10 p-2">
                    <p className="text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3 text-green-600" /> Spend</p>
                    <p className="font-mono font-semibold text-green-700 dark:text-green-400">{ins?.spend ? `$${parseFloat(ins.spend).toFixed(2)}` : "—"}</p>
                  </div>
                  <div className="rounded-md bg-blue-500/10 p-2">
                    <p className="text-muted-foreground flex items-center gap-1"><Eye className="h-3 w-3 text-blue-600" /> Impr.</p>
                    <p className="font-mono font-semibold">{ins?.impressions ? parseInt(ins.impressions).toLocaleString() : "—"}</p>
                  </div>
                  <div className="rounded-md bg-purple-500/10 p-2">
                    <p className="text-muted-foreground flex items-center gap-1"><MousePointer className="h-3 w-3 text-purple-600" /> Clicks</p>
                    <p className="font-mono font-semibold">{ins?.clicks ? parseInt(ins.clicks).toLocaleString() : "—"}</p>
                  </div>
                  <div className="rounded-md bg-amber-500/10 p-2">
                    <p className="text-muted-foreground">CTR</p>
                    <p className="font-mono font-semibold">{ins?.ctr ? `${parseFloat(ins.ctr).toFixed(2)}%` : "—"}</p>
                  </div>
                </div>

                {rule && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground"><ShieldCheck className="h-3 w-3 text-primary" /> Rule: ${rule.max_spend} cap</span>
                      <span className="font-mono">{(ratio * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={cn("h-full transition-all", ratio >= 0.9 ? "bg-destructive" : ratio >= 0.7 ? "bg-amber-500" : "bg-primary")} style={{ width: `${ratio * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs pt-1 border-t">
                  <button className="font-medium hover:underline" onClick={() => openBudgetDialog(camp)}>
                    {formatBudget(camp.daily_budget || camp.lifetime_budget)}
                  </button>
                  <span className="text-muted-foreground truncate max-w-[140px]">{getResults(ins?.actions)}</span>
                </div>

                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="flex-1 gap-1" onClick={() => toggleStatus.mutate({ campaignId: camp.id, newStatus: isActive ? "PAUSED" : "ACTIVE" })} disabled={toggleStatus.isPending}>
                    {isActive ? <><Pause className="h-4 w-4 text-yellow-600" /> Pause</> : <><Play className="h-4 w-4 text-green-600" /> Resume</>}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openBudgetDialog(camp)}><DollarSign className="h-4 w-4" /></Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" title="Rules">
                        {perCampaignRules[camp.id] ? <ShieldCheck className="h-4 w-4 text-primary" /> : <Shield className="h-4 w-4" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="truncate text-xs">Rule for "{camp.name}"</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setSpendDialog({ open: true, campaignId: camp.id, campaignName: camp.name, existing: perCampaignRules[camp.id]?.rule_type === "spend_cap" ? perCampaignRules[camp.id] : undefined })}>
                        <DollarSign className="h-4 w-4 mr-2" /> Spend Cap (Campaign / Ad Set / Ad)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setCprDialog({ open: true, campaignId: camp.id, campaignName: camp.name, existing: perCampaignRules[camp.id]?.rule_type === "cost_per_result" ? perCampaignRules[camp.id] : undefined })}>
                        <TrendingDown className="h-4 w-4 mr-2" /> Cost Per Result (Ad Set / Ad)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete({ ids: [camp.id], label: camp.name })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                {selectionMode && (
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} />
                  </TableHead>
                )}
                <TableHead className="min-w-[200px]">Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right"><div className="flex items-center justify-end gap-1"><Eye className="h-3 w-3" /> Impr.</div></TableHead>
                <TableHead className="text-right"><div className="flex items-center justify-end gap-1"><MousePointer className="h-3 w-3" /> Clicks</div></TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((camp) => {
                const isActive = camp.effective_status === "ACTIVE";
                const ins = camp.insights;
                const checked = selectedIds.has(camp.id);
                const rule = perCampaignRules[camp.id] || accountRule;
                return (
                  <TableRow key={camp.id} data-state={checked ? "selected" : undefined} className={cn("transition-colors", checked && "bg-primary/5")}>
                    {selectionMode && (
                      <TableCell><Checkbox checked={checked} onCheckedChange={() => toggleOne(camp.id)} /></TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <Megaphone className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="font-medium text-sm truncate max-w-[220px]">{camp.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{camp.objective?.toLowerCase().replace(/_/g, " ") || "—"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><CampaignStatusBadge status={camp.effective_status} /></TableCell>
                    <TableCell>
                      <button className="text-sm hover:underline cursor-pointer" onClick={() => openBudgetDialog(camp)}>
                        {formatBudget(camp.daily_budget || camp.lifetime_budget)}
                      </button>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-green-700 dark:text-green-400">
                      {ins?.spend ? `$${parseFloat(ins.spend).toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{ins?.impressions ? parseInt(ins.impressions).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{ins?.clicks ? parseInt(ins.clicks).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{ins?.ctr ? `${parseFloat(ins.ctr).toFixed(2)}%` : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleStatus.mutate({ campaignId: camp.id, newStatus: isActive ? "PAUSED" : "ACTIVE" })} disabled={toggleStatus.isPending}>
                          {isActive ? <Pause className="h-4 w-4 text-yellow-600" /> : <Play className="h-4 w-4 text-green-600" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openBudgetDialog(camp)}><DollarSign className="h-4 w-4" /></Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Auto-pause rules">
                              {perCampaignRules[camp.id] ? <ShieldCheck className="h-4 w-4 text-primary" /> : <Shield className="h-4 w-4" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel className="truncate text-xs">Rule for "{camp.name}"</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => setSpendDialog({ open: true, campaignId: camp.id, campaignName: camp.name, existing: perCampaignRules[camp.id]?.rule_type === "spend_cap" ? perCampaignRules[camp.id] : undefined })}>
                              <DollarSign className="h-4 w-4 mr-2" /> Spend Cap (Campaign / Ad Set / Ad)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setCprDialog({ open: true, campaignId: camp.id, campaignName: camp.name, existing: perCampaignRules[camp.id]?.rule_type === "cost_per_result" ? perCampaignRules[camp.id] : undefined })}>
                              <TrendingDown className="h-4 w-4 mr-2" /> Cost Per Result (Ad Set / Ad)
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete({ ids: [camp.id], label: camp.name })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Budget Dialog */}
      <Dialog open={!!budgetDialog} onOpenChange={() => setBudgetDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Daily Budget</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground truncate">{budgetDialog?.name}</p>
            <div>
              <Label>Daily Budget (USD)</Label>
              <Input type="number" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="e.g. 50" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBudgetDialog(null)}>Cancel</Button>
            <Button onClick={() => { if (!budgetDialog || !newBudget) return; updateBudget.mutate({ campaignId: budgetDialog.id, budget: parseFloat(newBudget) }); }} disabled={updateBudget.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign{confirmDelete && confirmDelete.ids.length > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">{confirmDelete?.label}</span> from Meta. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCampaigns.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); if (confirmDelete) deleteCampaigns.mutate(confirmDelete.ids); }} disabled={deleteCampaigns.isPending}>
              {deleteCampaigns.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Spend Cap Rule Dialog (handles account / campaign / adset / ad scopes) */}
      <SpendCapRuleDialog
        open={spendDialog.open}
        onOpenChange={(o) => setSpendDialog((s) => ({ ...s, open: o }))}
        accountId={accountId}
        campaignId={spendDialog.campaignId}
        campaignName={spendDialog.campaignName}
        existingRule={spendDialog.existing}
      />

      {/* Cost Per Result Rule Dialog */}
      <CostPerResultRuleDialog
        open={cprDialog.open}
        onOpenChange={(o) => setCprDialog((s) => ({ ...s, open: o }))}
        accountId={accountId}
        campaignId={cprDialog.campaignId}
        campaignName={cprDialog.campaignName}
        existingRule={cprDialog.existing}
      />
    </div>
  );
}
