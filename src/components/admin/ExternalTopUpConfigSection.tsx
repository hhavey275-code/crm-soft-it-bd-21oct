import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { ConfirmActionDialog } from "@/components/admin/ConfirmActionDialog";

interface Props {
  account: {
    id: string;
    external_topup_required?: boolean | null;
    external_topup_url?: string | null;
    external_crm_name?: string | null;
  };
}

export function ExternalTopUpConfigSection({ account }: Props) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(!!account.external_topup_required);
  const [crmName, setCrmName] = useState(account.external_crm_name || "");
  const [url, setUrl] = useState(account.external_topup_url || "");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setEnabled(!!account.external_topup_required);
    setCrmName(account.external_crm_name || "");
    setUrl(account.external_topup_url || "");
  }, [account.id, account.external_topup_required, account.external_crm_name, account.external_topup_url]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (enabled && !url.trim()) throw new Error("External CRM URL is required when enabled");
      const { error } = await (supabase as any)
        .from("ad_accounts")
        .update({
          external_topup_required: enabled,
          external_topup_url: enabled ? url.trim() : null,
          external_crm_name: enabled ? (crmName.trim() || "External CRM") : null,
        })
        .eq("id", account.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("External CRM settings saved");
      qc.invalidateQueries({ queryKey: ["ad-account-detail", account.id] });
      qc.invalidateQueries({ queryKey: ["admin-ad-accounts"] });
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const dirty =
    enabled !== !!account.external_topup_required ||
    crmName !== (account.external_crm_name || "") ||
    url !== (account.external_topup_url || "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ExternalLink className="h-4 w-4 text-amber-600" />
          External CRM Top-Up
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm">Requires external CRM for top-up?</Label>
            <p className="text-xs text-muted-foreground">
              Use this when the ad account's spend cap can only be updated through a partner's CRM.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <div className="space-y-3 border-t pt-3">
            <div>
              <Label className="text-xs">External CRM Name</Label>
              <Input
                placeholder="e.g. Partner CRM"
                value={crmName}
                onChange={(e) => setCrmName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">External CRM Top-Up URL</Label>
              <Input
                type="url"
                placeholder="https://partner-crm.example.com/topup"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Direct link to the top-up page in the partner CRM.
              </p>
            </div>
          </div>
        )}

        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={!dirty || saveMutation.isPending}
          size="sm"
          className="w-full"
        >
          {saveMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </CardContent>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm external CRM settings"
        description={
          <>Save these external CRM settings for this ad account? This will affect how top-ups are processed.</>
        }
        actionLabel="Save"
        onConfirm={() => saveMutation.mutate()}
      />
    </Card>
  );
}
