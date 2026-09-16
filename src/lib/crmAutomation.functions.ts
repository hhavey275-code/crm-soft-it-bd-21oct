// Admin-only server functions that mint short-lived tokens for the
// "CRM Top-Up Helper" browser extension and expose learned CRM layouts.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (isAdmin) return;
  const { data: isSuper } = await supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" });
  if (!isSuper) throw new Error("Forbidden");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    throw new Error("Invalid CRM URL");
  }
}

/** Mint a job token for one pending external top-up request. */
export const createCrmTopUpJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { requestId: string; url: string }) => {
    if (!data?.requestId) throw new Error("requestId is required");
    if (!data?.url) throw new Error("CRM url is required");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: req, error } = await context.supabase
      .from("external_topup_requests")
      .select("id, amount, status, wallet_kind, ad_account_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!req) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("Request is not pending");

    const { data: acct } = await context.supabase
      .from("ad_accounts")
      .select("account_id, account_name")
      .eq("id", req.ad_account_id)
      .maybeSingle();

    const accountId = String(acct?.account_id ?? "").replace(/^act_/, "");
    if (!accountId) throw new Error("Ad account id missing");

    const host = hostOf(data.url);
    const { signCrmToken } = await import("./crmToken.server");
    const token = signCrmToken({
      scope: "topup",
      host,
      requestId: req.id,
      accountId,
      amount: Number(req.amount),
      walletKind: req.wallet_kind ?? "primary",
      actorId: context.userId,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });

    await context.supabase
      .from("external_topup_requests")
      .update({ crm_provider: host, automation_started_at: new Date().toISOString() })
      .eq("id", req.id);

    return { token, accountId, amount: Number(req.amount), host };
  });

/** Mint a learn-mode token so the admin can teach the helper a CRM layout. */
export const createCrmLearnJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string }) => {
    if (!data?.url) throw new Error("CRM url is required");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const host = hostOf(data.url);
    const { signCrmToken } = await import("./crmToken.server");
    const token = signCrmToken({
      scope: "learn",
      host,
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });
    return { token, host };
  });

/** List CRM sites the helper already knows. */
export const listCrmConfigs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("crm_automation_configs")
      .select("id, host, name, auto_confirm, selectors, updated_at")
      .order("host");
    if (error) throw new Error(error.message);
    return (data ?? []).map((c: any) => ({
      id: c.id,
      host: c.host,
      name: c.name,
      auto_confirm: c.auto_confirm,
      updated_at: c.updated_at,
      learned: Object.keys(c.selectors ?? {}).length > 0,
    }));
  });

/** Toggle whether the helper may press the CRM submit button by itself. */
export const setCrmAutoConfirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { host: string; autoConfirm: boolean }) => {
    if (!data?.host) throw new Error("host is required");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("crm_automation_configs" as any)
      .update({ auto_confirm: data.autoConfirm, updated_by: context.userId })
      .eq("host", data.host.toLowerCase());
    if (error) throw new Error(error.message);
    return { ok: true };
  });
