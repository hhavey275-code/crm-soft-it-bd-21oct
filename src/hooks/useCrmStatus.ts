import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CrmStatus = { crm_name: string; enabled: boolean; message: string | null };

/** Live on/off state of every external CRM. Missing row = enabled. */
export function useCrmStatus() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["external-crm-status"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("external_crm_status").select("crm_name, enabled, message");
      return (data ?? []) as CrmStatus[];
    },
  });
  useEffect(() => {
    const ch = supabase
      .channel("external-crm-status-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "external_crm_status" }, () => {
        void qc.invalidateQueries({ queryKey: ["external-crm-status"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [qc]);
  const list = q.data ?? [];
  const pausedFor = (crmName?: string | null): CrmStatus | null => {
    if (!crmName) return null;
    const s = list.find((x) => x.crm_name === crmName);
    return s && !s.enabled ? s : null;
  };
  return { list, pausedFor };
}
