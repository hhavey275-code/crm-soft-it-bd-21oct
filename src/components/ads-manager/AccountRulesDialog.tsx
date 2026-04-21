import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldCheck, Trash2, Clock } from "lucide-react";
import type { CampaignRule } from "./types";
import { formatDistanceToNow } from "date-fns";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accountId: string;
  accountName?: string;
  existingRule?: CampaignRule;
}

const INTERVAL_OPTIONS = [
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every 1 hour" },
  { value: "120", label: "Every 2 hours" },
  { value: "240", label: "Every 4 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Every 24 hours" },
];

export function AccountRulesDialog({ open, onOpenChange, accountId, accountName, existingRule }: Props) {
  const qc = useQueryClient();
  const [maxSpend, setMaxSpend] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [interval, setInterval] = useState("60");

  useEffect(() => {
    if (existingRule) {
      setMaxSpend(String(existingRule.max_spend));
      setEnabled(existingRule.enabled);
      setInterval(String(existingRule.check_interval_minutes || 60));
    } else {
      setMaxSpend("");
      setEnabled(true);
      setInterval("60");
    }
  }, [existingRule, open]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: {
          action: "save_rule",
          account_id: accountId,
          scope: "account",
          max_spend: parseFloat(maxSpend),
          enabled,
          check_interval_minutes: parseInt(interval),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Account rule saved");
      qc.invalidateQueries({ queryKey: ["ads-manager-rules", accountId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("ads-manager", {
        body: { action: "delete_rule", account_id: accountId, scope: "account" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Account rule removed");
      qc.invalidateQueries({ queryKey: ["ads-manager-rules", accountId] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Account-Wide Auto-Pause Rule
          </DialogTitle>
          <DialogDescription className="truncate">
            {accountName || "This ad account"} — applies to ALL active campaigns
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="max-spend">Auto-pause each campaign when its spend exceeds (USD)</Label>
            <Input
              id="max-spend"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 50"
              value={maxSpend}
              onChange={(e) => setMaxSpend(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              এই account-এর প্রতিটি active campaign-এর spend আলাদাভাবে check হবে। যেটার lifetime spend এই amount-এর সমান বা বেশি হবে, সেটাই pause হয়ে যাবে।
            </p>
          </div>

          <div>
            <Label htmlFor="interval" className="flex items-center gap-1">
              <Clock className="h-4 w-4" /> Check frequency
            </Label>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger id="interval"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              কত সময় পরপর system সব campaign check করবে। কম interval = দ্রুত react, কিন্তু বেশি API calls।
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="enabled-switch">Rule Enabled</Label>
              <p className="text-xs text-muted-foreground">Disable to keep settings but stop enforcement.</p>
            </div>
            <Switch id="enabled-switch" checked={enabled} onCheckedChange={setEnabled} />
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
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive mr-auto"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Remove
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !maxSpend || parseFloat(maxSpend) <= 0}
          >
            {save.isPending ? "Saving..." : "Save Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
