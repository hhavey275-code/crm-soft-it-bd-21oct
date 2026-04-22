// Admin/Superadmin impersonates a client by generating a magic link.
// Returns a URL that opens a fresh client session in a new tab.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      return jsonResp({ error: "Server not configured" }, 500);
    }

    // 1. Verify caller is admin/superadmin
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return jsonResp({ error: "Missing auth token" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResp({ error: "Unauthorized" }, 401);
    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    const roleSet = new Set((roles || []).map((r: any) => r.role));
    const isAdmin = roleSet.has("admin") || roleSet.has("superadmin") || roleSet.has("agency");
    if (!isAdmin) return jsonResp({ error: "Forbidden — admins only" }, 403);

    // 2. Read body
    const body = await req.json().catch(() => ({}));
    const targetUserId: string | undefined = body?.target_user_id;
    if (!targetUserId) return jsonResp({ error: "target_user_id required" }, 400);

    // 3. Look up target email
    const { data: targetUser, error: getUserErr } = await admin.auth.admin.getUserById(targetUserId);
    if (getUserErr || !targetUser?.user?.email) {
      return jsonResp({ error: "Target user not found" }, 404);
    }
    const targetEmail = targetUser.user.email;

    // 4. Determine redirect origin from caller's request
    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    let redirectBase = "";
    try {
      if (origin) {
        const u = new URL(origin);
        redirectBase = `${u.protocol}//${u.host}`;
      }
    } catch {}
    if (!redirectBase) redirectBase = "https://app.softitbd.com";
    const redirectTo = `${redirectBase}/dashboard`;

    // 5. Generate magic link
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
      options: { redirectTo },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      return jsonResp({ error: linkErr?.message || "Failed to generate magic link" }, 500);
    }

    return jsonResp({ url: linkData.properties.action_link, email: targetEmail });
  } catch (e: any) {
    return jsonResp({ error: e?.message || "Unknown error" }, 500);
  }
});

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
