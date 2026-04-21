import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook that auto-runs heartbeat on tenant mode and provides license status.
 * Runs on app load and every 5 minutes.
 */
export function useTenantLicense() {
  const queryClient = useQueryClient();

  // Check if this instance is a tenant
  const { data: tenantConfig } = useQuery({
    queryKey: ["tenant-config-check"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["master_url", "tenant_api_key", "is_tenant"]);
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  const isTenant = tenantConfig?.is_tenant === "true";
  const masterUrl = tenantConfig?.master_url;
  const tenantApiKey = tenantConfig?.tenant_api_key;
  const isConfigured = isTenant && !!masterUrl && !!tenantApiKey;

  // Auto heartbeat
  const { data: licenseStatus } = useQuery({
    queryKey: ["tenant-heartbeat"],
    queryFn: async () => {
      if (!masterUrl || !tenantApiKey) return null;
      try {
        const res = await fetch(`${masterUrl}/functions/v1/tenant-webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tenant-Key": tenantApiKey,
          },
          body: JSON.stringify({ action: "heartbeat" }),
        });
        const data = await res.json();
        if (!res.ok) return { status: "error", error: data.error };

        // Cache in site_settings
        const upserts = [
          { key: "license_status", value: data.status || "unknown" },
          { key: "license_system_limit", value: String(data.system_limit ?? "") },
          { key: "license_total_used", value: String(data.total_used ?? "0") },
          { key: "license_subscription_type", value: data.subscription_type || "" },
          { key: "license_subscription_paid_until", value: data.subscription_paid_until || "" },
          { key: "license_subscription_fee", value: String(data.subscription_fee ?? "0") },
          { key: "license_usd_rate", value: String(data.usd_rate ?? "0") },
        ];

        for (const u of upserts) {
          const { data: existing } = await supabase
            .from("site_settings")
            .select("id")
            .eq("key", u.key)
            .single();
          if (existing) {
            await supabase.from("site_settings").update({ value: u.value }).eq("key", u.key);
          } else {
            await supabase.from("site_settings").insert({ key: u.key, value: u.value });
          }
        }

        return data;
      } catch (err) {
        console.error("Heartbeat failed:", err);
        return null;
      }
    },
    enabled: isConfigured,
    refetchInterval: 5 * 60 * 1000, // Every 5 minutes
    staleTime: 2 * 60 * 1000,
  });

  const isFrozen = isConfigured && licenseStatus?.status === "frozen";

  return {
    isTenant: isConfigured,
    isFrozen,
    licenseStatus,
    refreshLicense: () => queryClient.invalidateQueries({ queryKey: ["tenant-heartbeat"] }),
  };
}
