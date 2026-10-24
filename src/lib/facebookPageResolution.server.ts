type GraphReader = { get: (path: string, params?: Record<string, string>) => Promise<any> };

export function facebookPageReference(input: string): string {
  const raw = input.trim();
  if (/^\d+$/.test(raw)) return raw;
  const u = new URL(raw.startsWith("http") ? raw : `https://facebook.com/${raw}`);
  if (!/(^|\.)facebook\.com$/i.test(u.hostname)) throw new Error("Facebook Page-এর লিংক দিন");
  const id = u.searchParams.get("id");
  if (id) return id;
  const segments = u.pathname.split("/").filter(Boolean);
  const tail = segments.at(-1) || "";
  return tail.match(/-(\d{8,})$/)?.[1] || tail;
}

/** A profile.php URL can use an ID different from /me/accounts' canonical Page ID. */
/** Username Page link → numeric Page ID via Meta app read, then public page HTML. Unverified. */
export async function lookupPageIdByUsername(username: string, appToken?: string): Promise<{ id: string; name?: string } | null> {
  if (!/^[A-Za-z0-9.\-_]{2,100}$/.test(username)) return null;
  if (appToken) {
    const r: any = await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(username)}?fields=id,name&access_token=${encodeURIComponent(appToken)}`).then((x) => x.json()).catch(() => null);
    if (r?.id && /^\d+$/.test(String(r.id))) return { id: String(r.id), name: r.name };
  }
  for (const host of ["https://www.facebook.com", "https://m.facebook.com"]) {
    const html = await fetch(`${host}/${encodeURIComponent(username)}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "en-US" } }).then((x) => x.text()).catch(() => "");
    const m = html.match(/"pageID":"(\d{8,25})"/) || html.match(/fb:\/\/(?:page|profile)\/(?:\?id=)?(\d{8,25})/) || html.match(/"delegate_page":\{[^}]*"id":"(\d{8,25})"/) || html.match(/"userID":"(\d{8,25})"/);
    if (m) {
      const name = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
      return { id: m[1], name };
    }
  }
  return null;
}

export async function resolveFacebookPage(input: string, bm: GraphReader, client?: GraphReader, lookup?: (username: string) => Promise<{ id: string; name?: string } | null>) {
  const ref = facebookPageReference(input);
  if (!ref) throw new Error("Page-এর পুরো লিংক বা Page ID দিন");
  if (client) {
    let after: string | undefined;
    for (let i = 0; i < 5; i++) {
      const result = await client.get("me/accounts", { fields: "id,name,link,username", limit: "100", ...(after ? { after } : {}) }).catch(() => null);
      if (!result) break;
      const page = (result.data ?? []).find((p: any) => {
        if (String(p.id) === ref) return true;
        if (p.username && String(p.username).toLowerCase() === ref.toLowerCase()) return true;
        try { return p.link && facebookPageReference(p.link).toLowerCase() === ref.toLowerCase(); } catch { return false; }
      });
      if (page) return { id: String(page.id), name: page.name, link: page.link };
      after = result.paging?.next ? result.paging?.cursors?.after : undefined;
      if (!after) break;
    }
  }
  // category is Page-specific; id/name alone also accepts non-Page objects.
  const info = await bm.get(ref, { fields: "id,name,link,category" }).catch(() => null);
  if (info?.id && info?.category) return { id: String(info.id), name: info.name, link: info.link };
  // A typed Page ID (e.g. from Page transparency) that our BM can't read yet: let Facebook's
  // access request itself validate it. Not verified identity, and never for readable non-Pages.
  if (!info && /^\d{8,25}$/.test(input.trim())) return { id: ref, name: undefined, link: undefined, unverified: true };
  // Username link (facebook.com/scaleup): find its numeric ID, then let Facebook's request validate it.
  if (!/^\d+$/.test(ref)) {
    const viaClient = client ? await client.get(ref, { fields: "id,name" }).catch(() => null) : null;
    const found = viaClient?.id ? { id: String(viaClient.id), name: viaClient.name } : lookup ? await lookup(ref).catch(() => null) : null;
    if (found?.id) {
      const again = await bm.get(found.id, { fields: "id,name,link,category" }).catch(() => null);
      if (again?.id && again?.category) return { id: String(again.id), name: again.name, link: again.link };
      if (!again) return { id: found.id, name: found.name, link: input.trim(), unverified: true };
    }
    throw new Error("Facebook এই লিংক থেকে Page ID দিচ্ছে না। ‘Facebook থেকে Page ও ID আনুন’ চেপে Page-এর admin Facebook দিয়ে connect করুন ও Page-এ টিক দিন — তাহলে Page নিজে থেকেই যুক্ত হবে।");
  }
  throw new Error("এই লিংক থেকে Facebook Page নিশ্চিত করা যায়নি। ‘Facebook থেকে Page ও ID আনুন’ চেপে ওই Page-এর admin Facebook দিয়ে connect করুন ও Page-এর অনুমতি দিন, তারপর তালিকা থেকে Page বাছুন। শুধু লিংকের সংখ্যা দিয়ে request পাঠানো হয়নি।");
}