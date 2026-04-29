// Sends a Business Manager email invite via Meta Graph API.
// User receives an email from Meta. Once they accept, a separate sync (or the
// next BM sync) will resolve their business-scoped user ID and apply the
// per-ad-account permissions stored in `bm_invitations.ad_account_permissions`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  metaFetch,
  resetMetaCounters,
} from "../_shared/meta-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function decryptToken(stored: string, secret: string): Promise<string> {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("bm-token-enc-v1"),
        iterations: 100000,
        hash: "SHA-256",
      },
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

interface AdAccountPermission {
  ad_account_id: string; // uuid in our DB
  tasks: string[]; // e.g. ['MANAGE','ADVERTISE','ANALYZE']
}

const VALID_TASKS = new Set([
  "MANAGE",
  "ADVERTISE",
  "ANALYZE",
  "DRAFT",
  "AUDIENCE_RESEARCH",
  "ADS_PERFORMANCE",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  resetMetaCounters();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return json({ error: "Unauthorized - invalid token" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Admin check
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "superadmin"])
      .limit(1);
    if (!roleRow || roleRow.length === 0) {
      return json({ error: "Forbidden - admin only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const {
      bm_id, // uuid of business_managers row
      email,
      bm_role, // 'ADMIN' | 'EMPLOYEE'
      ad_account_permissions, // AdAccountPermission[]
    } = body ?? {};

    if (!bm_id || !email || !bm_role) {
      return json({ error: "bm_id, email, bm_role required" }, 400);
    }
    if (!["ADMIN", "EMPLOYEE"].includes(bm_role)) {
      return json({ error: "bm_role must be ADMIN or EMPLOYEE" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return json({ error: "Invalid email" }, 400);
    }

    const perms: AdAccountPermission[] = Array.isArray(ad_account_permissions)
      ? ad_account_permissions.filter(
          (p) =>
            p &&
            typeof p.ad_account_id === "string" &&
            Array.isArray(p.tasks) &&
            p.tasks.every((t: string) => VALID_TASKS.has(t)),
        )
      : [];

    // Fetch BM record + decrypt token
    const { data: bm, error: bmErr } = await supabase
      .from("business_managers")
      .select("id, name, bm_id, access_token")
      .eq("id", bm_id)
      .single();
    if (bmErr || !bm) {
      return json({ error: "Business Manager not found" }, 404);
    }

    const accessToken = await decryptToken(
      bm.access_token,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Send invite via Meta
    const inviteUrl = `https://graph.facebook.com/v23.0/${bm.bm_id}/business_users`;
    const formBody = new URLSearchParams({
      email: String(email),
      role: bm_role,
      access_token: accessToken,
    });

    const res = await metaFetch(inviteUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
    const respJson = await res.json().catch(() => ({}));

    if (!res.ok || respJson?.error) {
      const metaErr = respJson?.error || {};
      const subcode = metaErr.error_subcode;
      const code = metaErr.code;
      let errMsg =
        metaErr.error_user_msg ||
        metaErr.message ||
        `Meta returned ${res.status}`;
      let hint: string | null = null;

      // Subcode 1752006 = "User cannot be added to business"
      if (subcode === 1752006 || /cannot be added to the business/i.test(errMsg)) {
        hint =
          "এই email-টি Meta-তে invite করা যাচ্ছে না। সম্ভাব্য কারণ: " +
          "(১) এই email already এই BM-এ আছে বা pending invite রয়েছে, " +
          "(২) email-টি Facebook account-এর সাথে যুক্ত নয়, " +
          "(৩) user অন্য একটি BM-এর সাথে এমনভাবে যুক্ত যা conflict করছে, " +
          "অথবা (৪) BM access token-এ business_management permission নেই। " +
          "Business Settings → People থেকে manually try করে দেখুন।";
      } else if (code === 190) {
        hint = "BM access token expired/invalid। নতুন token দিয়ে BM update করুন।";
      } else if (code === 200) {
        hint = "Token-এ যথেষ্ট permission নেই (business_management দরকার)।";
      }

      // Save failed record for audit
      await supabase.from("bm_invitations").insert({
        business_manager_id: bm.id,
        invited_email: String(email).toLowerCase(),
        bm_role,
        ad_account_permissions: perms,
        status: "failed",
        invited_by: userId,
        invite_response: respJson,
        error_message: errMsg,
      });
      return json({ error: errMsg, hint, meta: respJson }, 200);
    }

    // Save pending invite
    const pendingId =
      respJson?.id || respJson?.invitation_id || respJson?.user?.id || null;

    const { data: inviteRow, error: insertErr } = await supabase
      .from("bm_invitations")
      .insert({
        business_manager_id: bm.id,
        invited_email: String(email).toLowerCase(),
        bm_role,
        ad_account_permissions: perms,
        status: "pending",
        meta_pending_user_id: pendingId,
        invited_by: userId,
        invite_response: respJson,
      })
      .select("id")
      .single();

    if (insertErr) {
      return json({
        ok: true,
        warning: "Invite sent but failed to save record: " + insertErr.message,
        meta: respJson,
      });
    }

    return json({
      ok: true,
      invitation_id: inviteRow?.id,
      bm_name: bm.name,
      message: `Invite email sent to ${email}. They will receive a Meta invitation email shortly.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
