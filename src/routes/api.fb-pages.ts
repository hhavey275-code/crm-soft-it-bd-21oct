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

async function verifyUser(token: string): Promise<boolean> {
  if (!token) return false;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dhswrfzdqcavgmymllat.supabase.co";
  const keys = [
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ].filter(Boolean) as string[];
  for (const key of keys) {
    try {
      const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      if (r.ok) { const u: any = await r.json().catch(() => null); if (u?.id) return true; }
    } catch { /* try next */ }
  }
  return false;
}

async function handle(request: Request): Promise<Response> {
        const parsed = schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "Invalid request" }, 400);
        const appId = process.env.META_APP_ID;
        const secret = process.env.META_APP_SECRET;
        if (!appId || !secret) return json({ error: "Meta App সেট করা নেই (META_APP_ID / META_APP_SECRET)" }, 500);

        // App ID is public — no login check needed to open the Facebook dialog.
        if (parsed.data.action === "config") return json({ appId });

        const auth = request.headers.get("authorization") || "";
        const ok = auth.startsWith("Bearer ") && (await verifyUser(auth.slice(7).trim()));
        if (!ok) return json({ error: "Unauthorized" }, 401);

        const { code, redirectUri } = parsed.data;
        const origin = new URL(redirectUri).origin;
        if (new URL(redirectUri).pathname !== "/fb-pages-callback") return json({ error: "Invalid redirect" }, 400);
        void origin;

        const tokRes = await fetch(`${GRAPH}/oauth/access_token?${new URLSearchParams({
          client_id: appId, client_secret: secret, redirect_uri: redirectUri, code,
        })}`);
        const tok: any = await tokRes.json().catch(() => ({}));
        if (!tok.access_token) return json({ error: tok?.error?.message || "Facebook login ব্যর্থ" }, 400);

        const pages: any[] = [];
        let url: string | null = `${GRAPH}/me/accounts?${new URLSearchParams({
          fields: "id,name,link,picture{url}", limit: "100", access_token: tok.access_token,
        })}`;
        for (let i = 0; url && i < 5; i++) {
          const r: any = await (await fetch(url)).json().catch(() => ({}));
          if (r.error) return json({ error: r.error.message }, 400);
          pages.push(...(r.data ?? []));
          url = r.paging?.next ?? null;
        }
        return json({
          pages: pages.map((p) => ({
            id: String(p.id), name: String(p.name ?? ""),
            link: p.link ?? `https://facebook.com/${p.id}`, picture: p.picture?.data?.url ?? null,
          })),
        });
}
