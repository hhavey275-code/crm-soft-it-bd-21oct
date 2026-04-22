import { supabase } from "@/integrations/supabase/client";

let cached: { masterUrl: string; tenantApiKey: string; isTenant: boolean } | null = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function getTenantConfig() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["master_url", "tenant_api_key", "is_tenant"]);
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.key] = r.value; });
  cached = {
    masterUrl: (map.master_url || "").replace(/\/+$/, ""),
    tenantApiKey: map.tenant_api_key || "",
    isTenant: map.is_tenant === "true",
  };
  cachedAt = Date.now();
  return cached;
}

export interface ForwardResult {
  ok: boolean;
  id?: string;
  conversation_id?: string;
  messages?: any[];
  error?: string;
  skipped?: boolean;
}

/**
 * Forwards an action+payload to the master project's tenant-webhook function.
 * Silently skips (returns { ok: true, skipped: true }) if this instance is not
 * configured as a tenant — that way callers can fire-and-forget without checks.
 */
export async function tenantForward(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<ForwardResult> {
  try {
    const cfg = await getTenantConfig();
    if (!cfg.isTenant || !cfg.masterUrl || !cfg.tenantApiKey) {
      return { ok: true, skipped: true };
    }
    const res = await fetch(`${cfg.masterUrl}/functions/v1/tenant-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Key": cfg.tenantApiKey,
      },
      body: JSON.stringify({ action, payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(`tenantForward(${action}) failed:`, json?.error || res.status);
      return { ok: false, error: json?.error || `HTTP ${res.status}` };
    }
    return { ok: true, ...json };
  } catch (e: any) {
    console.warn(`tenantForward(${action}) threw:`, e?.message);
    return { ok: false, error: e?.message || "network error" };
  }
}

export async function isTenantInstance(): Promise<boolean> {
  const cfg = await getTenantConfig();
  return cfg.isTenant && !!cfg.masterUrl && !!cfg.tenantApiKey;
}
