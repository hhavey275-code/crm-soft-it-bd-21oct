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
export async function resolveFacebookPage(input: string, bm: GraphReader, client?: GraphReader) {
  const ref = facebookPageReference(input);
  if (!ref) throw new Error("Page-এর পুরো লিংক বা Page ID দিন");
  if (client) {
    let after: string | undefined;
    for (let i = 0; i < 5; i++) {
      const result = await client.get("me/accounts", { fields: "id,name,link", limit: "100", ...(after ? { after } : {}) }).catch(() => null);
      if (!result) break;
      const page = (result.data ?? []).find((p: any) => {
        if (String(p.id) === ref) return true;
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
  throw new Error("এই লিংক থেকে Facebook Page নিশ্চিত করা যায়নি। ‘Facebook থেকে Page ও ID আনুন’ চেপে ওই Page-এর admin Facebook দিয়ে connect করুন ও Page-এর অনুমতি দিন, তারপর তালিকা থেকে Page বাছুন। শুধু লিংকের সংখ্যা দিয়ে request পাঠানো হয়নি।");
}