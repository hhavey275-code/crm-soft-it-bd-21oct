// Server-only: give a Business Manager advertising access to a client's Page.
// 1) Page already shared → just make sure our System User is assigned.
// 2) Client is the Page admin (Page token) → grant directly, no approval needed.
// 3) Otherwise → send the BM's Page access request so the Page owner can approve.

const V = "https://graph.facebook.com/v25.0";
const PAGE_TASKS = ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", "MODERATE", "MESSAGING"];
const REQUEST_TASKS = ["ADVERTISE", "ANALYZE", "CREATE_CONTENT"];

export type PageShareOutcome =
  | { status: "already" | "granted" | "requested" }
  | { status: "failed"; message: string };

async function fbGet(path: string, params: Record<string, string>) {
  const r = await fetch(`${V}/${path}?${new URLSearchParams(params)}`).catch(() => null);
  return r ? r.json().catch(() => ({})) : {};
}
async function fbPost(path: string, params: Record<string, string>) {
  const r = await fetch(`${V}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  }).catch(() => null);
  return r ? r.json().catch(() => ({})) : {};
}

/** Assign the BM token's own user (the CRM System User) to the Page so ads can be created with it. */
async function assignSystemUser(pageId: string, bmId: string, bmToken: string, systemUserId?: string | null) {
  const uid = systemUserId ?? (await fbGet("me", { fields: "id", access_token: bmToken }))?.id;
  if (!uid) return;
  await fbPost(`${pageId}/assigned_users`, { user: String(uid), tasks: JSON.stringify(PAGE_TASKS), business: bmId, access_token: bmToken });
}

export async function sharePageWithBm(opts: {
  pageId: string;
  pageToken?: string | null;
  bmId: string;
  bmToken?: string | null;
  systemUserId?: string | null;
}): Promise<PageShareOutcome> {
  const { pageId, pageToken, bmId, bmToken, systemUserId } = opts;

  if (pageToken) {
    const ag = await fbGet(`${pageId}/agencies`, { fields: "id", limit: "100", access_token: pageToken });
    if ((ag?.data ?? []).some((a: any) => String(a.id) === bmId)) {
      if (bmToken) await assignSystemUser(pageId, bmId, bmToken, systemUserId);
      return { status: "already" };
    }
    const r = await fbPost(`${pageId}/agencies`, { business: bmId, permitted_tasks: JSON.stringify(PAGE_TASKS), access_token: pageToken });
    if (r && !r.error && (r.success === true || r.success === undefined)) {
      if (bmToken) await assignSystemUser(pageId, bmId, bmToken, systemUserId);
      return { status: "granted" };
    }
  }

  if (!bmToken) return { status: "failed", message: "Business Manager token পাওয়া যায়নি" };
  const req = await fbPost(`${bmId}/client_pages`, { page_id: pageId, permitted_tasks: JSON.stringify(REQUEST_TASKS), access_token: bmToken });
  if (req && !req.error) return { status: "requested" };
  const msg = String(req?.error?.error_user_msg || req?.error?.message || "Facebook রাজি হয়নি");
  if (/already/i.test(msg)) return { status: "already" };
  return { status: "failed", message: msg };
}
