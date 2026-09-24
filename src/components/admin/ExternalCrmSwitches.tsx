import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCrmStatus } from "@/hooks/useCrmStatus";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Power } from "lucide-react";

/** One on/off switch per external CRM. Off hides client top-up buttons for every account on that CRM. */
export function ExternalCrmSwitches() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { list } = useCrmStatus();
  const [msgs, setMsgs] = useState<Record<string, string>>({});

  const { data: crmNames = [] } = useQuery({
    queryKey: ["external-crm-names"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("ad_accounts")
        .select("external_crm_name")
        .eq("external_topup_required", true)
        .not("external_crm_name", "is", null);
      return [...new Set(((data ?? []) as any[]).map((r) => r.external_crm_name).filter(Boolean))] as string[];
    },
  });

  const save = async (crm: string, enabled: boolean) => {
    const cur = list.find((x) => x.crm_name === crm);
    const message = msgs[crm] ?? cur?.message ?? null;
    const { error } = await (supabase as any)
      .from("external_crm_status")
      .upsert({ crm_name: crm, enabled, message, updated_by: user?.id, updated_at: new Date().toISOString() });
    if (error) return toast.error(error.message);
    toast.success(enabled ? `${crm}: top-up চালু হয়েছে` : `${crm}: সব client-এর top-up বন্ধ হয়েছে`);
    void qc.invalidateQueries({ queryKey: ["external-crm-status"] });
  };

  if (!crmNames.length) return null;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Power className="h-4 w-4" /> CRM top-up চালু / বন্ধ
        </div>
        {crmNames.map((crm) => {
          const cur = list.find((x) => x.crm_name === crm);
          const enabled = cur ? cur.enabled : true;
          return (
            <div key={crm} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-[160px] items-center gap-2">
                <Switch checked={enabled} onCheckedChange={(v) => save(crm, v)} />
                <span className="font-medium">{crm}</span>
                <span className={enabled ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
                  {enabled ? "চালু" : "বন্ধ"}
                </span>
              </div>
              <Input
                className="flex-1"
                placeholder="Client-দের বার্তা (ঐচ্ছিক) — যেমন: CRM-এ balance load হচ্ছে"
                value={msgs[crm] ?? cur?.message ?? ""}
                onChange={(e) => setMsgs((m) => ({ ...m, [crm]: e.target.value }))}
                onBlur={() => cur && msgs[crm] !== undefined && save(crm, enabled)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
