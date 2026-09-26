type SupabaseAdmin = any;

export type ExternalTopupRetryResult =
  | { status: "updated"; before: number; after: number }
  | { status: "queued" }
  | { status: "blocked"; reason: string };

export async function retryExternalTopupServer(
  admin: SupabaseAdmin,
  requestId: string,
  callerUserId: string,
  privileged: boolean,
): Promise<ExternalTopupRetryResult> {
  const { data: req, error: requestError } = await admin
    .from("external_topup_requests")
    .select("id, user_id, status, ad_account_id, spend_cap_before, spend_cap_after, retry_count, retry_requested_at")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError) throw new Error(requestError.message);
  if (!req) throw new Error("Request not found");
  if (!privileged && req.user_id !== callerUserId) throw new Error("Forbidden");

  if (req.status !== "completed") return { status: "blocked", reason: "Request এখনো শেষ হয়নি" };
  if (req.spend_cap_after != null) {
    return { status: "updated", before: Number(req.spend_cap_before ?? 0), after: Number(req.spend_cap_after) };
  }
  if (req.retry_requested_at) return { status: "blocked", reason: "Retry আগেই queue-তে আছে" };

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (url && key) {
    await fetch(`${url}/functions/v1/get-account-insights`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ ad_account_ids: [req.ad_account_id], source: "meta" }),
    }).catch(() => null);
  }

  const { data: fresh } = await admin
    .from("external_topup_requests")
    .select("spend_cap_before, spend_cap_after")
    .eq("id", req.id)
    .maybeSingle();
  if (fresh?.spend_cap_after != null) {
    return { status: "updated", before: Number(fresh.spend_cap_before ?? 0), after: Number(fresh.spend_cap_after) };
  }

  const { data: acct } = await admin.from("ad_accounts").select("spend_cap").eq("id", req.ad_account_id).maybeSingle();
  const cap = Number(acct?.spend_cap ?? 0);
  const before = Number(req.spend_cap_before ?? 0);
  if (cap > before + 0.01) {
    const { error } = await admin
      .from("external_topup_requests")
      .update({ spend_cap_after: cap, limit_status: "updated", limit_reason: null, automation_started_at: null, updated_at: new Date().toISOString() })
      .eq("id", req.id)
      .is("spend_cap_after", null);
    if (error) throw new Error(error.message);
    return { status: "updated", before, after: cap };
  }

  if (!privileged && Number(req.retry_count ?? 0) >= 1) {
    return { status: "blocked", reason: "একবার retry হয়ে গেছে — admin-এর সাথে যোগাযোগ করুন" };
  }

  const now = new Date().toISOString();
  const { data: queued, error: queueError } = await admin
    .from("external_topup_requests")
    .update({
      retry_requested_at: now,
      retry_count: Number(req.retry_count ?? 0) + 1,
      automation_started_at: null,
      last_error: null,
      limit_status: "pending",
      limit_reason: "Retry queue-তে — helper আবার CRM-এ top-up দেবে",
      updated_at: now,
    })
    .eq("id", req.id)
    .is("retry_requested_at", null)
    .is("spend_cap_after", null)
    .select("id")
    .maybeSingle();
  if (queueError) throw new Error(queueError.message);
  if (!queued) return { status: "blocked", reason: "Retry আগেই queue-তে আছে" };

  await admin.from("autopilot_pings").insert({}).then(() => null, () => null);
  return { status: "queued" };
}