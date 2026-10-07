import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Facebook Login for clients: returns the Meta App ID, and exchanges an OAuth
 * code for the list of Pages the signed-in client manages. The user token is
 * never stored or returned to the browser.
 */
const GRAPH = "https://graph.facebook.com/v25.0";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("config") }),
  z.object({ action: z.literal("pages"), code: z.string().min(10).max(2000), redirectUri: z.string().url() }),
]);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/fb-pages")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try { return await handle(request); } catch (e: any) {
          console.error("fb-pages error", e);
          return json({ error: `সার্ভার সমস্যা: ${e?.message || "unknown"}` }, 500);
        }
      },
    },
  },
});

async function handle(request: Request): Promise<Response> {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid request" }, 400);
        const appId = process.env.META_APP_ID;
        const secret = process.env.META_APP_SECRET;
        if (!appId || !secret) return json({ error: "Meta App সেট করা নেই (META_APP_ID / META_APP_SECRET)" }, 500);

        // App ID is public — no login check needed to open the Facebook dialog.
        if (parsed.data.action === "config") return json({ appId });

        // No CRM login check here: this step only turns a one-time Facebook code
        // (bound to our redirect URI + app secret) into that Facebook user's own
        // page list. Saving pages happens in the browser under the user's login (RLS).
        // A strict token check broke on deployments using different auth env.

        const { code, redirectUri } = parsed.data;
        const origin = new URL(redirectUri).origin;
        if (new URL(redirectUri).pathname !== "/fb-pages-callback") return json({ error: "Invalid redirect" }, 400);
        void origin;

        const tokRes = await fetch(`${GRAPH}/oauth/access_token?${new URLSearchParams({
          client_id: appId, client_secret: secret, redirect_uri: redirectUri, code,
        })}`);
        const tok: any = await tokRes.json().catch(() => ({}));
        if (!tok.access_token) return json({ error: tok?.error?.message || "Facebook login ব্যর্থ" }, 400);

        // Long-lived user token → page tokens that don't expire.
        let userToken = tok.access_token as string;
        try {
          const ll: any = await (await fetch(`${GRAPH}/oauth/access_token?${new URLSearchParams({
            grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: userToken,
          })}`)).json();
          if (ll?.access_token) userToken = ll.access_token;
        } catch { /* keep short token */ }

        const pages: any[] = [];
        let url: string | null = `${GRAPH}/me/accounts?${new URLSearchParams({
          fields: "id,name,link,picture{url},access_token", limit: "100", access_token: userToken,
        })}`;
        for (let i = 0; url && i < 5; i++) {
          const r: any = await (await fetch(url)).json().catch(() => ({}));
          if (r.error) return json({ error: r.error.message }, 400);
          pages.push(...(r.data ?? []));
          url = r.paging?.next ?? null;
        }

        // Save page keys (encrypted, server-only) for the signed-in CRM user.
        let saved = false;
        const userId = await verifyUser(request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "");
        if (userId && pages.some((p) => p.access_token)) {
          try {
            const { encryptToken } = await import("@/lib/metaGraph.server");
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const sec = process.env.BM_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
            const rows = await Promise.all(pages.filter((p) => p.access_token).map(async (p) => ({
              user_id: userId, page_id: String(p.id), access_token: await encryptToken(p.access_token, sec), updated_at: new Date().toISOString(),
            })));
            const { error } = await (supabaseAdmin as any).from("client_page_tokens").upsert(rows, { onConflict: "user_id,page_id" });
            saved = !error;
            if (error) console.error("page token save", error);
          } catch (e) { console.error("page token save", e); }
        }

        // Auto-add the pages to the client's list (no separate My Pages / approval step),
        // then share each page with the Business Managers of the client's ad accounts.
        let added = 0; let bmShared = 0;
        if (userId && pages.length) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const db = supabaseAdmin as any;
            const { data: existing } = await db.from("client_facebook_pages").select("id, page_id, user_id, status").in("page_id", pages.map((p) => String(p.id)));
            const mine = new Set((existing ?? []).map((e: any) => String(e.page_id)));
            const rows = pages.filter((p) => !mine.has(String(p.id))).map((p) => ({
              user_id: userId, page_id: String(p.id), page_name: String(p.name ?? ""), page_url: p.link ?? `https://facebook.com/${p.id}`,
              page_avatar_url: p.picture?.data?.url ?? null, status: "approved", connect_method: "oauth", approved_at: new Date().toISOString(),
            }));
            if (rows.length) { const { error } = await db.from("client_facebook_pages").insert(rows); if (!error) added = rows.length; else console.error("page insert", error); }
            // Re-activate this user's earlier rejected/pending copies of the same pages.
            const own = (existing ?? []).filter((e: any) => e.user_id === userId && e.status !== "approved").map((e: any) => e.id);
            if (own.length) await db.from("client_facebook_pages").update({ status: "approved", approved_at: new Date().toISOString() }).in("id", own);

            // BMs behind the client's shared + own ad accounts.
            const { sharedAccountIds } = await import("@/lib/managedAds.server");
            const shared = await sharedAccountIds(db, userId);
            const { data: links } = await db.from("user_ad_accounts").select("ad_account_id").eq("user_id", userId);
            const accIds = [...new Set([...shared, ...(links ?? []).map((l: any) => String(l.ad_account_id))])];
            const { data: accs } = accIds.length ? await db.from("ad_accounts").select("business_managers(bm_id)").in("id", accIds) : { data: [] };
            const bmIds = [...new Set((accs ?? []).map((a: any) => (Array.isArray(a.business_managers) ? a.business_managers[0] : a.business_managers)?.bm_id).filter(Boolean).map(String))];
            for (const p of pages) {
              if (!p.access_token) continue;
              for (const bm of bmIds) {
                try {
                  const r: any = await (await fetch(`${GRAPH}/${p.id}/agencies`, {
                    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({ business: bm, permitted_tasks: JSON.stringify(["ADVERTISE", "ANALYZE", "CREATE_CONTENT"]), access_token: p.access_token }),
                  })).json().catch(() => ({}));
                  if (r?.success || !r?.error) bmShared++; else console.warn("page share", p.id, bm, r.error?.message);
                } catch (e) { console.warn("page share", e); }
              }
            }
          } catch (e) { console.error("auto page add", e); }
        }

        return json({
          added, bmShared, signedIn: !!userId,
          saved,
          pages: pages.map((p) => ({
            id: String(p.id), name: String(p.name ?? ""),
            link: p.link ?? `https://facebook.com/${p.id}`, picture: p.picture?.data?.url ?? null,
          })),
        });
}

async function verifyUser(token: string): Promise<string | null> {
  if (!token) return null;
  const keys = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoc3dyZnpkcWNhdmdteW1sbGF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MTkyODksImV4cCI6MjA4OTA5NTI4OX0.nv-DXiR4Eu4b0IEIXp2GVO9Q3MHUawjxuujGCySUD4s",
    process.env.SUPABASE_PUBLISHABLE_KEY,
  ].filter(Boolean) as string[];
  for (const key of keys) {
    try {
      const r = await fetch("https://dhswrfzdqcavgmymllat.supabase.co/auth/v1/user", { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      if (r.ok) { const u: any = await r.json().catch(() => null); if (u?.id) return String(u.id); }
    } catch { /* next */ }
  }
  return null;
}
