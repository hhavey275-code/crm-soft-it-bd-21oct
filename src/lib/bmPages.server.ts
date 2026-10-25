import { decryptToken, graphClient } from "./metaGraph.server";

export async function listApprovedBmPages(g: { get: (path: string, params?: Record<string, string>) => Promise<any> }, bmId: string) {
  const pages = new Map<string, { id: string; name: string; link: string }>();
  for (const edge of ["client_pages", "owned_pages"]) {
    let after: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await g.get(`${bmId}/${edge}`, { fields: "id,name,link", limit: "100", ...(after ? { after } : {}) });
      if (r?.error) throw new Error(r.error.message || "Meta Page তালিকা দিতে পারেনি");
      for (const p of r.data ?? []) if (/^\d+$/.test(String(p.id))) pages.set(String(p.id), { id: String(p.id), name: String(p.name || p.id), link: p.link || `https://facebook.com/${p.id}` });
      after = r.paging?.next ? r.paging?.cursors?.after : undefined;
      if (!after) break;
      if (i === 19) throw new Error("BM-এ অনেক Page রয়েছে — পুরো তালিকা আনা যায়নি");
    }
  }
  return [...pages.values()];
}

export function requireBmPageAdmin(isAdmin: boolean) {
  if (!isAdmin) throw new Error("শুধু Admin BM থেকে Page আনতে পারবেন");
}

async function bmReader(db: any, id: string) {
  const { data: bm, error } = await db.from("business_managers").select("bm_id,name,access_token").eq("id", id).maybeSingle();
  if (error || !bm?.access_token || !bm?.bm_id) throw new Error("Business Manager বা তার access token পাওয়া যায়নি");
  for (const secret of [process.env.BM_TOKEN_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean) as string[]) {
    try { return { bm, g: graphClient(await decryptToken(bm.access_token, secret)) }; } catch { /* next key */ }
  }
  throw new Error("Business Manager-এর token খোলা যায়নি — token আবার সেভ করুন");
}

export async function readBmPages(db: any, bmDbId: string) {
  const { bm, g } = await bmReader(db, bmDbId);
  return listApprovedBmPages(g, String(bm.bm_id));
}

export async function importBmPage(db: any, actor: string, input: { bmDbId: string; pageId: string; clientId: string; accountId: string }) {
  const { data: account, error: accountError } = await db.from("ad_accounts").select("id,business_manager_id").eq("id", input.accountId).maybeSingle();
  if (accountError || account?.business_manager_id !== input.bmDbId) throw new Error("এই ad account নির্বাচিত BM-এর নয়");
  const { data: link, error: linkError } = await db.from("user_ad_accounts").select("id").eq("user_id", input.clientId).eq("ad_account_id", input.accountId).maybeSingle();
  if (linkError || !link) throw new Error("এই ad account নির্বাচিত ক্লায়েন্টের নয়");
  const { bm, g } = await bmReader(db, input.bmDbId);
  const page = (await listApprovedBmPages(g, String(bm.bm_id))).find(p => p.id === input.pageId);
  if (!page) throw new Error("এই Page-এ BM-এর অনুমোদিত access পাওয়া যায়নি");
  const { data: existing, error: readError } = await db.from("client_facebook_pages").select("id,user_id").eq("page_id", page.id).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing && existing.user_id !== input.clientId) throw new Error("এই Page অন্য ক্লায়েন্টের সঙ্গে যুক্ত আছে — আগে সেই সংযোগ সরান");
  const values = { page_name: page.name, page_url: page.link, ad_account_id: input.accountId, status: "approved", approved_at: new Date().toISOString(), approved_by: actor };
  const { data, error } = existing
    ? await db.from("client_facebook_pages").update(values).eq("id", existing.id).select("id,page_id,page_name,user_id,status").single()
    : await db.from("client_facebook_pages").insert({ ...values, user_id: input.clientId, page_id: page.id }).select("id,page_id,page_name,user_id,status").single();
  if (error || !data) throw new Error(error?.message || "CRM-এ Page সেভ হয়নি");
  return data;
}