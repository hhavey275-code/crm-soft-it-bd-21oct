// Admin-only server functions that create ad accounts inside a Meta
// Business Manager through the Graph API (POST /{business_id}/adaccount)
// and store the results in our `ad_accounts` table.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRAPH = "https://graph.facebook.com/v23.0";

async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (isAdmin) return;
  const { data: isSuper } = await supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" });
  if (!isSuper) throw new Error("Forbidden");
}

async function decryptToken(stored: string, secret: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode("bm-token-enc-v1"), iterations: 100000, hash: "SHA-256" },
      km,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const combined = Uint8Array.from(atob(stored.slice(4)), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(dec);
  } catch {
    return stored;
  }
}

async function loadBm(bmId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: bm, error } = await supabaseAdmin
    .from("business_managers")
    .select("id, name, bm_id, access_token")
    .eq("id", bmId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!bm) throw new Error("Business Manager not found");
  const token = await decryptToken(bm.access_token, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");
  return { bm, token, supabaseAdmin };
}

function isLimitError(err: any): boolean {
  const msg = `${err?.error_user_title ?? ""} ${err?.error_user_msg ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return msg.includes("limit") || msg.includes("maximum number of ad accounts") || err?.error_subcode === 1487742;
}

/** Read BM status: verification + how many ad accounts it already owns. */
export const checkBmAdAccountCapacity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bmId: string }) => {
    if (!data?.bmId) throw new Error("bmId is required");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { bm, token } = await loadBm(data.bmId);

    const url =
      `${GRAPH}/${bm.bm_id}?fields=name,verification_status,` +
      `owned_ad_accounts.limit(1).summary(true),client_ad_accounts.limit(1).summary(true)` +
      `&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const out: any = await res.json().catch(() => ({}));
    if (!res.ok || out?.error) {
      throw new Error(out?.error?.error_user_msg || out?.error?.message || `Meta returned ${res.status}`);
    }
    return {
      name: out?.name ?? bm.name,
      verificationStatus: out?.verification_status ?? null,
      ownedCount: out?.owned_ad_accounts?.summary?.total_count ?? null,
      clientCount: out?.client_ad_accounts?.summary?.total_count ?? null,
    };
  });

/** Bulk-create ad accounts in a BM; stops when Meta reports the creation limit. */
export const createBmAdAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      bmId: string;
      count: number;
      namePrefix: string;
      startIndex?: number;
      currency?: string;
      timezoneId?: number;
      forceNumbered?: boolean;
    }) => {
      if (!data?.bmId) throw new Error("bmId is required");
      if (!data?.namePrefix?.trim()) throw new Error("namePrefix is required");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { bm, token, supabaseAdmin } = await loadBm(data.bmId);

    // Per-call batch (client loops for bigger totals to stay within server time limits).
    const count = Math.min(Math.max(Number(data.count ?? 1), 1), 10);
    const prefix = data.namePrefix.trim().slice(0, 60);
    const startIndex = Math.max(Number(data.startIndex ?? 1), 1);
    const currency = (data.currency ?? "USD").toUpperCase();
    const timezoneId = Number(data.timezoneId ?? 1);

    const created: { accountId: string; name: string }[] = [];
    const failed: { name: string; error: string }[] = [];
    let stoppedByLimit = false;

    for (let i = 0; i < count; i++) {
      const name = count === 1 && !data.forceNumbered ? prefix : `${prefix} ${startIndex + i}`;
      const form = new URLSearchParams({
        name,
        currency,
        timezone_id: String(timezoneId),
        end_advertiser: bm.bm_id,
        media_agency: "NONE",
        partner: "NONE",
        access_token: token,
      });

      const res = await fetch(`${GRAPH}/${bm.bm_id}/adaccount`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      const out: any = await res.json().catch(() => ({}));

      if (!res.ok || out?.error) {
        const err = out?.error ?? {};
        failed.push({ name, error: err.error_user_msg || err.message || `Meta returned ${res.status}` });
        if (isLimitError(err)) {
          stoppedByLimit = true;
          break;
        }
        continue;
      }

      const rawId = String(out?.id ?? out?.account_id ?? "").replace(/^act_/, "");
      if (!rawId) {
        failed.push({ name, error: "Meta did not return an account id" });
        continue;
      }

      const { error: upErr } = await supabaseAdmin.from("ad_accounts").upsert(
        {
          account_id: `act_${rawId}`,
          account_name: name,
          business_manager_id: bm.id,
          business_name: bm.name,
          status: "active",
          spend_cap: 0,
          amount_spent: 0,
        } as any,
        { onConflict: "account_id" },
      );
      if (upErr) failed.push({ name, error: `Created on Meta but DB save failed: ${upErr.message}` });
      created.push({ accountId: `act_${rawId}`, name });
    }

    return { created, failed, stoppedByLimit, createdCount: created.length };
  });
