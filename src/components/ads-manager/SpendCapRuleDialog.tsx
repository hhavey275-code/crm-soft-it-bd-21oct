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
import { ShieldCheck, Trash2, Clock, Info } from "lucide-react";
import {
  CHECK_INTERVAL_OPTIONS,
  type CampaignRule, type TargetLevel,
} from "./types";
import { formatDistanceToNow } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accountId: string;
  accountName?: string;
  // If opened from a specific campaign row, scope defaults to that campaign
  campaignId?: string;
  campaignName?: string;
  existingRule?: CampaignRule;
}

export function SpendCapRuleDialog({
  open, onOpenChange, accountId, accountName,
  campaignId, campaignName, existingRule,
}: Props) {
  const qc = useQueryClient();

  const [targetLevel, setTargetLevel] = useState<TargetLevel>("campaign");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>(campaignId);
  const [selectedAdsetId, setSelectedAdsetId] = useState<string | undefined>();
  const [selectedAdId, setSelectedAdId] = useState<string | undefined>();
  const [maxSpend, setMaxSpend] = useState("");
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
      setMaxSpend(existingRule.max_spend ? String(existingRule.max_spend) : "");
      setInterval(String(existingRule.check_interval_minutes ?? 60));
      setEnabled(existingRule.enabled);
    } else {
      setTargetLevel(campaignId ? "campaign" : "account");
      setSelectedCampaignId(campaignId);
      setSelectedAdsetId(undefined);
      setSelectedAdId(undefined);
      setMaxSpend("");
      setInterval("60");
      setEnabled(true);
      setCustomInterval("");
    }
  }, [open, existingRule, campaignId]);

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

      const finalInterval = customInterval
        ? String(Math.max(15, Math.min(1440, Math.round(parseFloat(customInterval) * 60))))
        : interval;

      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: {
          action: "save_rule",
          account_id: accountId,
          rule_type: "spend_cap",
          target_level: targetLevel,
          campaign_id: targetLevel === "account" ? null : selectedCampaignId,
          campaign_name: targetLevel === "account" ? null : campaignName,
          target_id: target_id || null,
          target_name: target_name || null,
          max_spend: parseFloat(maxSpend),
          check_interval_minutes: parseInt(finalInterval),
          enabled,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Spend cap rule saved");
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

  const canSave = !!maxSpend && parseFloat(maxSpend) > 0
    && (targetLevel === "account" || targetLevel === "campaign"
        || (targetLevel === "adset" && !!selectedAdsetId)
        || (targetLevel === "ad" && !!selectedAdId));

  const scopeLabel: Record<TargetLevel, string> = {
    account: "every active campaign in this account",
    campaign: "this whole campaign",
    adset: "this specific ad set",
    ad: "this specific ad",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Spend Cap Auto-Pause
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
                <RadioGroupItem value="adset" disabled={!selectedCampaignId} /> Ad Set
              </label>
              <label className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer text-sm ${targetLevel === "ad" ? "border-primary bg-primary/5" : ""} ${!selectedCampaignId ? "opacity-50 pointer-events-none" : ""}`}>
                <RadioGroupItem value="ad" disabled={!selectedCampaignId} /> Ad
              </label>
            </RadioGroup>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              Spend reach করলে শুধু {scopeLabel[targetLevel]} pause হবে।
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

          {/* Max Spend */}
          <div>
            <Label htmlFor="max-spend-cap">Pause when spend exceeds (USD)</Label>
            <Input
              id="max-spend-cap"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 50"
              value={maxSpend}
              onChange={(e) => setMaxSpend(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {targetLevel === "account"
                ? "প্রতিটা active campaign-এর spend আলাদা check হবে — limit cross করলে সেটাই pause।"
                : `${scopeLabel[targetLevel]}-এর lifetime spend এই amount cross করলেই pause হবে।`}
            </p>
          </div>

          {/* Interval */}
          <div>
            <Label htmlFor="interval-cap" className="flex items-center gap-1"><Clock className="h-4 w-4" /> Check frequency</Label>
            <Select value={interval} onValueChange={(v) => { setInterval(v); setCustomInterval(""); }}>
              <SelectTrigger id="interval-cap"><SelectValue /></SelectTrigger>
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
              <Label htmlFor="enabled-cap">Rule Enabled</Label>
              <p className="text-xs text-muted-foreground">Disable to keep settings but stop enforcement.</p>
            </div>
            <Switch id="enabled-cap" checked={enabled} onCheckedChange={setEnabled} />
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
