import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TrendingDown, Trash2, Clock, Info } from "lucide-react";
import {
  CHECK_INTERVAL_OPTIONS, RESULT_EVENT_OPTIONS,
  type CampaignRule, type TargetLevel, type ResultEvent,
} from "./types";
import { formatDistanceToNow } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accountId: string;
  accountName?: string;
  // If opened from a specific campaign row, prefill scope to that campaign
  campaignId?: string;
  campaignName?: string;
  existingRule?: CampaignRule;
}

export function CostPerResultRuleDialog({
  open, onOpenChange, accountId, accountName,
  campaignId, campaignName, existingRule,
}: Props) {
  const qc = useQueryClient();

  const [targetLevel, setTargetLevel] = useState<TargetLevel>("adset");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>(campaignId);
  const [selectedAdsetId, setSelectedAdsetId] = useState<string | undefined>();
  const [selectedAdId, setSelectedAdId] = useState<string | undefined>();
  const [resultEvent, setResultEvent] = useState<ResultEvent>("purchase");
  const [maxCpr, setMaxCpr] = useState("");
  const [minResults, setMinResults] = useState("3");
  const [minSpend, setMinSpend] = useState("5");
  const [interval, setInterval] = useState("60");
  const [enabled, setEnabled] = useState(true);
  const [customInterval, setCustomInterval] = useState("");

  // Reset on open
  useEffect(() => {
    if (!open) return;
    if (existingRule) {
      setTargetLevel(existingRule.target_level);
      setSelectedCampaignId(existingRule.campaign_id || campaignId);
      setSelectedAdsetId(existingRule.target_level === "adset" ? existingRule.target_id || undefined : undefined);
      setSelectedAdId(existingRule.target_level === "ad" ? existingRule.target_id || undefined : undefined);
      setResultEvent((existingRule.result_event as ResultEvent) || "purchase");
      setMaxCpr(existingRule.max_cost_per_result ? String(existingRule.max_cost_per_result) : "");
      setMinResults(String(existingRule.min_results_required ?? 3));
      setMinSpend(String(existingRule.min_spend_required ?? 5));
      setInterval(String(existingRule.check_interval_minutes ?? 60));
      setEnabled(existingRule.enabled);
    } else {
      setTargetLevel(campaignId ? "adset" : "account");
      setSelectedCampaignId(campaignId);
      setSelectedAdsetId(undefined);
      setSelectedAdId(undefined);
      setResultEvent("purchase");
      setMaxCpr("");
      setMinResults("3");
      setMinSpend("5");
      setInterval("60");
      setEnabled(true);
      setCustomInterval("");
    }
  }, [open, existingRule, campaignId]);

  // Fetch ad sets for the selected campaign (only when relevant)
  const { data: adsetsData } = useQuery({
    queryKey: ["rule-adsets", selectedCampaignId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "list_adsets_for_rule", account_id: accountId, campaign_id: selectedCampaignId },
      });
      if (error) throw error;
      return data as { adsets: { id: string; name: string }[] };
    },
    enabled: open && !!selectedCampaignId && (targetLevel === "adset" || targetLevel === "ad"),
    staleTime: 60_000,
  });

  // Fetch ads under selected adset (or campaign if no adset chosen but level=ad)
  const { data: adsData } = useQuery({
    queryKey: ["rule-ads", selectedCampaignId, selectedAdsetId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: {
          action: "list_ads_for_rule",
          account_id: accountId,
          campaign_id: selectedCampaignId,
          adset_id: selectedAdsetId,
        },
      });
      if (error) throw error;
      return data as { ads: { id: string; name: string }[] };
    },
    enabled: open && targetLevel === "ad" && (!!selectedAdsetId || !!selectedCampaignId),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: async () => {
      let target_id: string | undefined;
      let target_name: string | undefined;
      if (targetLevel === "adset") {
        target_id = selectedAdsetId;
        target_name = adsetsData?.adsets.find(a => a.id === selectedAdsetId)?.name;
      } else if (targetLevel === "ad") {
        target_id = selectedAdId;
        target_name = adsData?.ads.find(a => a.id === selectedAdId)?.name;
      }

      const finalInterval = customInterval ? String(Math.max(15, Math.min(1440, Math.round(parseFloat(customInterval) * 60)))) : interval;

      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: {
          action: "save_rule",
          account_id: accountId,
          rule_type: "cost_per_result",
          target_level: targetLevel,
          campaign_id: targetLevel === "account" ? null : selectedCampaignId,
          campaign_name: targetLevel === "account" ? null : campaignName,
          target_id: target_id || null,
          target_name: target_name || null,
          result_event: resultEvent,
          max_cost_per_result: parseFloat(maxCpr),
          min_results_required: parseInt(minResults),
          min_spend_required: parseFloat(minSpend),
          check_interval_minutes: parseInt(finalInterval),
          enabled,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Cost-per-result rule saved");
      qc.invalidateQueries({ queryKey: ["ads-manager-rules", accountId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!existingRule) return;
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "delete_rule", account_id: accountId, rule_id: existingRule.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Rule removed");
      qc.invalidateQueries({ queryKey: ["ads-manager-rules", accountId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const canSave = !!maxCpr && parseFloat(maxCpr) > 0
    && (targetLevel === "account" || targetLevel === "campaign" || (targetLevel === "adset" && !!selectedAdsetId) || (targetLevel === "ad" && !!selectedAdId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-primary" /> Cost Per Result Auto-Pause
          </DialogTitle>
          <DialogDescription className="truncate">
            {accountName || "This ad account"} {campaignName ? `· ${campaignName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Scope */}
          <div className="space-y-2">
            <Label>Pause Scope (কোন level-এ pause হবে?)</Label>
            <RadioGroup value={targetLevel} onValueChange={(v) => setTargetLevel(v as TargetLevel)} className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer text-sm ${targetLevel === "account" ? "border-primary bg-primary/5" : ""}`}>
                <RadioGroupItem value="account" /> Account-wide
              </label>
              <label className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer text-sm ${targetLevel === "campaign" ? "border-primary bg-primary/5" : ""} ${!selectedCampaignId ? "opacity-50 pointer-events-none" : ""}`}>
                <RadioGroupItem value="campaign" disabled={!selectedCampaignId} /> Campaign
              </label>
              <label className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer text-sm ${targetLevel === "adset" ? "border-primary bg-primary/5" : ""} ${!selectedCampaignId ? "opacity-50 pointer-events-none" : ""}`}>
                <RadioGroupItem value="adset" disabled={!selectedCampaignId} /> Ad Set ⭐
              </label>
              <label className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer text-sm ${targetLevel === "ad" ? "border-primary bg-primary/5" : ""} ${!selectedCampaignId ? "opacity-50 pointer-events-none" : ""}`}>
                <RadioGroupItem value="ad" disabled={!selectedCampaignId} /> Ad
              </label>
            </RadioGroup>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              Ad Set level সবচেয়ে safe — শুধু খারাপ audience pause হবে, ভালোগুলো চলবে।
            </p>
          </div>

          {/* Ad set selector */}
          {targetLevel === "adset" && selectedCampaignId && (
            <div>
              <Label>Select Ad Set</Label>
              <Select value={selectedAdsetId} onValueChange={setSelectedAdsetId}>
                <SelectTrigger><SelectValue placeholder="Choose ad set..." /></SelectTrigger>
                <SelectContent>
                  {(adsetsData?.adsets || []).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                  {!adsetsData?.adsets?.length && <SelectItem value="__none" disabled>No ad sets found</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Ad selector */}
          {targetLevel === "ad" && selectedCampaignId && (
            <>
              <div>
                <Label>Filter by Ad Set (optional)</Label>
                <Select value={selectedAdsetId} onValueChange={(v) => { setSelectedAdsetId(v); setSelectedAdId(undefined); }}>
                  <SelectTrigger><SelectValue placeholder="All ad sets in campaign" /></SelectTrigger>
                  <SelectContent>
                    {(adsetsData?.adsets || []).map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Select Ad</Label>
                <Select value={selectedAdId} onValueChange={setSelectedAdId}>
                  <SelectTrigger><SelectValue placeholder="Choose ad..." /></SelectTrigger>
                  <SelectContent>
                    {(adsData?.ads || []).map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                    {!adsData?.ads?.length && <SelectItem value="__none" disabled>No ads found</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Result event */}
          <div>
            <Label>Result Event</Label>
            <Select value={resultEvent} onValueChange={(v) => setResultEvent(v as ResultEvent)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESULT_EVENT_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {RESULT_EVENT_OPTIONS.find(o => o.value === resultEvent)?.bangla}
            </p>
          </div>

          {/* Max CPR */}
          <div>
            <Label htmlFor="max-cpr">Pause when Cost Per Result exceeds (USD)</Label>
            <Input id="max-cpr" type="number" step="0.01" min="0" placeholder="e.g. 5.00" value={maxCpr} onChange={(e) => setMaxCpr(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">
              যেমন $5 = প্রতি purchase $5-এর বেশি হলেই সেই ad set / ad pause হবে।
            </p>
          </div>

          {/* Safety thresholds */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="min-results">Min results before check</Label>
              <Input id="min-results" type="number" min="1" value={minResults} onChange={(e) => setMinResults(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">কমপক্ষে এত result না হলে rule trigger হবে না।</p>
            </div>
            <div>
              <Label htmlFor="min-spend">Min spend before check ($)</Label>
              <Input id="min-spend" type="number" min="0" step="0.01" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Cold-start protection।</p>
            </div>
          </div>

          {/* Interval */}
          <div>
            <Label htmlFor="interval" className="flex items-center gap-1"><Clock className="h-4 w-4" /> Check frequency</Label>
            <Select value={interval} onValueChange={(v) => { setInterval(v); setCustomInterval(""); }}>
              <SelectTrigger id="interval"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHECK_INTERVAL_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-2">
              <Label className="text-xs text-muted-foreground">Or custom (hours)</Label>
              <Input
                type="number"
                step="0.25"
                min="0.25"
                max="24"
                placeholder="e.g. 1.5 for 90 minutes"
                value={customInterval}
                onChange={(e) => setCustomInterval(e.target.value)}
              />
            </div>
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="enabled-cpr">Rule Enabled</Label>
              <p className="text-xs text-muted-foreground">Once paused, manual resume দরকার হবে।</p>
            </div>
            <Switch id="enabled-cpr" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {existingRule?.last_checked_at && (
            <div className="text-xs text-muted-foreground">
              Last checked {formatDistanceToNow(new Date(existingRule.last_checked_at), { addSuffix: true })}
            </div>
          )}
          {existingRule?.last_action && (
            <div className="rounded-md bg-muted/50 p-3 text-xs">
              <p className="font-medium">Last action:</p>
              <p className="text-muted-foreground">{existingRule.last_action}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {existingRule && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive mr-auto"
              onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 className="h-4 w-4 mr-1" /> Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !canSave}>
            {save.isPending ? "Saving..." : "Save Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
