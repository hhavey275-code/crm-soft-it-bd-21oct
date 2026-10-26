// Server-only: AI Ads Agent (chat + voice) for My Ads, powered by the Claude API (tool use).
// Claude can READ the client's accounts, campaigns, Pages, posts and video library, and can PROPOSE
// a plan of changes. Nothing that spends money runs until the client presses Confirm; confirmed
// plans become rows in ads_agent_tasks and every step goes through /api/managed-ads as that client
// (server-to-server, non-admin), so the normal ownership, Page and wallet checks always apply.

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_ACTIONS = 60;

export type Caller = { origin: string; userId: string; asUserId?: string };

// ---------------- managed-ads bridge ----------------
let cachedSecret: { v: string; at: number } | null = null;
async function agentSecret(admin: any): Promise<string> {
  if (cachedSecret && Date.now() - cachedSecret.at < 5 * 60_000) return cachedSecret.v;
  const { data } = await admin.from("internal_job_secrets").select("secret").eq("job_name", "ads-agent-tasks").maybeSingle();
  const v = String(data?.secret ?? "");
  if (!v) throw new Error("AI Agent সেটআপ শেষ হয়নি — database migration (ads_agent_tasks) চালাতে হবে");
  cachedSecret = { v, at: Date.now() };
  return v;
}

export async function callManagedAds(admin: any, c: Caller, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${c.origin}/api/managed-ads`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-secret": await agentSecret(admin), "x-agent-user": c.userId },
    // asUserId = admin "view as client"; /api/managed-ads only honours it for admins.
    body: JSON.stringify(c.asUserId && body.asUserId === undefined ? { ...body, asUserId: c.asUserId } : body),
  });
  const j: any = await res.json().catch(() => ({ error: `সার্ভার উত্তর দেয়নি (HTTP ${res.status})` }));
  if (!res.ok || j?.error) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
}

// ---------------- helpers ----------------
const DHAKA_OFFSET = 6 * 3600_000;
function dhakaDate(d = new Date()) { return new Date(d.getTime() + DHAKA_OFFSET).toISOString().slice(0, 10); }
function rangeFor(preset: string) {
  const today = dhakaDate();
  const minus = (n: number) => dhakaDate(new Date(Date.now() - n * 86400_000));
  switch (preset) {
    case "yesterday": return { dateFrom: minus(1), dateTo: minus(1) };
    case "last_7d": return { dateFrom: minus(6), dateTo: today };
    case "last_30d": return { dateFrom: minus(29), dateTo: today };
    default: return { dateFrom: today, dateTo: today };
  }
}
const num = (v: any) => (v == null || v === "" ? 0 : Number(v) || 0);
function act(insights: any, type: string) { return num((insights?.actions ?? []).find((a: any) => a.action_type === type)?.value); }
function metrics(ins: any) {
  return {
    spend: num(ins?.spend), impressions: num(ins?.impressions), reach: num(ins?.reach), clicks: num(ins?.clicks),
    messages_started: act(ins, "onsite_conversion.messaging_conversation_started_7d"),
    link_clicks: act(ins, "link_click"), post_engagement: act(ins, "post_engagement"),
    purchases: act(ins, "offsite_conversion.fb_pixel_purchase") || act(ins, "purchase"), leads: act(ins, "lead"),
  };
}
const cut = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n)}…` : t; };

// ---------------- tools ----------------
const ACTION_ITEM = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["create_campaign", "set_status", "set_budget", "delete"], description: "What to do." },
    account_id: { type: "string", description: "Ad account id (the `id` from list_accounts)." },
    // create_campaign
    page_id: { type: "string", description: "create_campaign: Page id (the `id` from list_pages)." },
    objective: { type: "string", enum: ["MESSAGES", "ENGAGEMENT", "TRAFFIC", "AWARENESS"], description: "create_campaign: MESSAGES = Messenger conversations, ENGAGEMENT = post engagement (needs post_id), TRAFFIC = website visits (needs link), AWARENESS = reach." },
    campaign_name: { type: "string" },
    daily_budget: { type: "number", description: "create_campaign: daily budget in USD (min 1)." },
    video_id: { type: "string", description: "create_campaign: a video id from list_videos (the ad uses this video)." },
    post_id: { type: "string", description: "create_campaign: an existing Page post id from list_posts (instead of a video)." },
    message: { type: "string", description: "create_campaign: primary text of the ad (for video ads)." },
    headline: { type: "string" },
    link: { type: "string", description: "create_campaign: website URL for TRAFFIC (https://…)." },
    countries: { type: "array", items: { type: "string" }, description: "2-letter country codes, default [\"BD\"]." },
    age_min: { type: "integer" }, age_max: { type: "integer" },
    gender: { type: "string", enum: ["all", "men", "women"] },
    duration_days: { type: "integer", description: "create_campaign: stop after this many days (omit = runs until paused)." },
    publish: { type: "boolean", description: "create_campaign: true = start delivering right away, false = create paused." },
    // set_status / set_budget / delete
    level: { type: "string", enum: ["campaign", "adset", "ad"] },
    object_id: { type: "string", description: "Meta id of the campaign / ad set / ad (from list_campaigns)." },
    status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
    amount: { type: "number", description: "set_budget: new budget in USD (applies to an AD SET id)." },
    budget_type: { type: "string", enum: ["daily", "lifetime"] },
    label: { type: "string", description: "Short Bengali description of this step for the confirm list." },
  },
  required: ["type", "account_id", "label"],
};

export const TOOLS = [
  { name: "list_accounts", description: "The client's Meta ad accounts with Facebook status (1 = active), spend cap and amount spent.", input_schema: { type: "object", properties: {} } },
  {
    name: "list_campaigns",
    description: "Campaigns and ad sets of one ad account with metrics (spend in USD, messages_started, link_clicks, etc.) for a date range. Also returns the account's usable Pages.",
    input_schema: { type: "object", properties: { account_id: { type: "string" }, date_preset: { type: "string", enum: ["today", "yesterday", "last_7d", "last_30d"] } }, required: ["account_id"] },
  },
  { name: "list_pages", description: "Facebook Pages the client can run ads for on this ad account.", input_schema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"] } },
  { name: "list_videos", description: "Videos in this ad account's Video library (what the client uploaded).", input_schema: { type: "object", properties: { account_id: { type: "string" } }, required: ["account_id"] } },
  { name: "list_posts", description: "Recent posts of a Page (for ENGAGEMENT or post-based ads).", input_schema: { type: "object", properties: { account_id: { type: "string" }, page_id: { type: "string" } }, required: ["account_id", "page_id"] } },
  {
    name: "propose_plan",
    description: "Show the client a plan of changes (create campaigns, pause/start, change budget, delete) to CONFIRM. Nothing runs until they press Confirm. Use run_at for a scheduled time and repeat='daily' for a daily repeat. One create_campaign action = one campaign.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One or two Bengali sentences describing the plan." },
        run_at: { type: ["string", "null"], description: "ISO 8601 time with +06:00 offset for a scheduled run, or null to run right after Confirm." },
        repeat: { type: "string", enum: ["none", "daily"] },
        actions: { type: "array", items: ACTION_ITEM, minItems: 1, maxItems: MAX_ACTIONS },
      },
      required: ["summary", "actions"],
    },
  },
];

// ---------------- plan → managed-ads bodies ----------------
export type PlanAction = Record<string, any>;
export type Plan = { summary: string; run_at: string | null; repeat: "none" | "daily"; actions: PlanAction[] };

/** Validates one proposed action and turns it into the exact /api/managed-ads body. */
export function expandAction(a: PlanAction): { label: string; body: Record<string, unknown> } {
  const acc = String(a.account_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(acc)) throw new Error("ad account id ঠিক নেই");
  const label = cut(a.label || a.campaign_name || a.type, 160);
  if (a.type === "set_status") {
    if (!/^\d+$/.test(String(a.object_id ?? ""))) throw new Error("object id ঠিক নেই");
    return { label, body: { action: "set_status", level: a.level ?? "campaign", objectId: String(a.object_id), status: a.status === "ACTIVE" ? "ACTIVE" : "PAUSED", adAccountDbId: acc } };
  }
  if (a.type === "set_budget") {
    if (!/^\d+$/.test(String(a.object_id ?? ""))) throw new Error("ad set id ঠিক নেই");
    const amount = Number(a.amount);
    if (!(amount >= 1 && amount <= 100000)) throw new Error("budget ঠিক নেই");
    return { label, body: { action: "set_budget", objectId: String(a.object_id), budgetType: a.budget_type === "lifetime" ? "lifetime" : "daily", amount, adAccountDbId: acc } };
  }
  if (a.type === "delete") {
    if (!/^\d+$/.test(String(a.object_id ?? ""))) throw new Error("object id ঠিক নেই");
    return { label, body: { action: "delete", level: a.level ?? "campaign", objectId: String(a.object_id), adAccountDbId: acc } };
  }
  if (a.type !== "create_campaign") throw new Error("অজানা কাজ");
  const page = String(a.page_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(page)) throw new Error("Page id ঠিক নেই");
  const objective = String(a.objective ?? "MESSAGES");
  if (!["MESSAGES", "ENGAGEMENT", "TRAFFIC", "AWARENESS"].includes(objective)) throw new Error("objective ঠিক নেই");
  const amount = Number(a.daily_budget);
  if (!(amount >= 1 && amount <= 100000)) throw new Error("daily budget ঠিক নেই (কমপক্ষে $1)");
  const videoId = a.video_id && /^\d+$/.test(String(a.video_id)) ? String(a.video_id) : undefined;
  const postId = a.post_id && /^\d+(_\d+)?$/.test(String(a.post_id)) ? String(a.post_id) : undefined;
  if (!videoId && !postId) throw new Error("প্রতিটি campaign-এ একটি video বা post লাগবে");
  if (objective === "ENGAGEMENT" && !postId) throw new Error("Engagement campaign-এ post লাগবে");
  const link = typeof a.link === "string" && /^https?:\/\//.test(a.link) ? a.link : undefined;
  if (objective === "TRAFFIC" && !link && !postId) throw new Error("Traffic campaign-এ website link লাগবে");
  const countries = (Array.isArray(a.countries) && a.countries.length ? a.countries : ["BD"]).map((c: any) => String(c).toUpperCase()).filter((c: string) => /^[A-Z]{2}$/.test(c)).slice(0, 25);
  const ageMin = Math.min(Math.max(Number(a.age_min) || 18, 18), 65), ageMax = Math.min(Math.max(Number(a.age_max) || 65, 18), 65);
  const genders = a.gender === "men" ? [1] : a.gender === "women" ? [2] : [];
  const isMsg = objective === "MESSAGES";
  const metaObjective = isMsg ? "ENGAGEMENT" : objective;
  const name = cut(a.campaign_name || `${objective} campaign`, 180);
  const endTime = Number(a.duration_days) > 0 ? new Date(Date.now() + Number(a.duration_days) * 86400_000).toISOString() : undefined;
  const cta = isMsg ? undefined : objective === "TRAFFIC" ? "LEARN_MORE" : undefined;
  const ad = {
    adName: `${name} - Ad`, existingPostId: postId, videoId: postId ? undefined : videoId,
    message: a.message ? cut(a.message, 4900) : undefined, headline: a.headline ? cut(a.headline, 250) : undefined,
    link: objective === "TRAFFIC" ? link : undefined, cta, advantageCreative: false, format: "single",
  };
  const adset = {
    adsetName: `${name} - Ad set`, conversionLocation: "WEBSITE", endTime,
    budgetType: "daily", amount, bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    countries, ageMin, ageMax, genders, interests: [], connections: "all",
    ...(metaObjective === "ENGAGEMENT" ? { engagementLocation: isMsg ? "MESSAGING" : "ON_AD", msgDestinations: isMsg ? ["MESSENGER"] : undefined } : {}),
    ads: [ad],
  };
  return {
    label,
    body: {
      action: "create", pageDbId: page, adAccountDbId: acc, objective: metaObjective,
      campaignName: name, budgetLevel: "adset", specialCategories: [],
      budgetType: "daily", amount, bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      adsetName: adset.adsetName, adName: ad.adName, countries, ageMin, ageMax, genders, interests: [],
      publish: a.publish !== false, adsets: [adset],
    },
  };
}

export function normalizePlan(input: any): Plan {
  const actions: PlanAction[] = Array.isArray(input?.actions) ? input.actions.slice(0, MAX_ACTIONS) : [];
  if (!actions.length) throw new Error("Plan-এ কোনো কাজ নেই");
  actions.forEach((a) => expandAction(a)); // throws on the first invalid one
  let run_at: string | null = null;
  if (input?.run_at) {
    const t = Date.parse(String(input.run_at));
    if (!Number.isFinite(t)) throw new Error("সময় ঠিক নেই");
    if (t > Date.now() + 60_000) run_at = new Date(t).toISOString();
  }
  return { summary: cut(input?.summary || "", 600), run_at, repeat: input?.repeat === "daily" ? "daily" : "none", actions };
}

// ---------------- tool execution ----------------
async function runTool(admin: any, c: Caller, name: string, input: any): Promise<unknown> {
  if (name === "list_accounts") {
    const { accounts } = await callManagedAds(admin, c, { action: "accounts" });
    const ids = (accounts ?? []).slice(0, 30).map((a: any) => a.id);
    const summary = ids.length ? (await callManagedAds(admin, c, { action: "account_summary", ids }).catch(() => ({ summary: {} }))).summary : {};
    return (accounts ?? []).map((a: any) => ({ id: a.id, name: a.name, meta_id: a.account_id, kind: a.kind, ...(summary?.[a.id] ?? {}) }));
  }
  if (name === "list_campaigns" || name === "list_pages") {
    const range = rangeFor(input?.date_preset ?? "today");
    const d = await callManagedAds(admin, c, { action: "list", ...range, adAccountDbId: input.account_id });
    const pages = (d.allPages ?? d.pages ?? []).filter((p: any) => p.status !== "rejected").map((p: any) => ({ id: p.id, name: p.page_name }));
    if (name === "list_pages") return { pages };
    return {
      range, pages, errors: d.errors ?? [],
      campaigns: (d.campaigns ?? []).slice(0, 150).map((x: any) => ({ id: x.id, name: x.name, status: x.status, delivery: x.effective_status, objective: x.objective, daily_budget: x.daily_budget ? num(x.daily_budget) / 100 : null, ...metrics(x.insights) })),
      adsets: (d.adsets ?? []).slice(0, 200).map((x: any) => ({ id: x.id, campaign_id: x.campaign_id, name: x.name, status: x.status, daily_budget: x.daily_budget ? num(x.daily_budget) / 100 : null, spend: num(x.insights?.spend) })),
    };
  }
  if (name === "list_videos") {
    const { videos } = await callManagedAds(admin, c, { action: "videos", adAccountDbId: input.account_id });
    return (videos ?? []).map((v: any) => ({ id: v.id, title: v.title, length_sec: v.length ? Math.round(v.length) : null, created: v.created }));
  }
  if (name === "list_posts") {
    const { posts, needsAccess } = await callManagedAds(admin, c, { action: "posts", pageDbId: input.page_id, adAccountDbId: input.account_id });
    if (needsAccess) return { error: "এই Page-এর post পড়ার অনুমতি নেই" };
    return (posts ?? []).slice(0, 20).map((p: any) => ({ id: p.id, text: cut(p.message, 100), created: p.created }));
  }
  return { error: `Unknown tool ${name}` };
}

// ---------------- chat loop ----------------
function systemPrompt(selectedAccount?: string) {
  const now = new Date(Date.now() + DHAKA_OFFSET).toISOString().replace("T", " ").slice(0, 16);
  return `You are the AI Ads Agent inside an ad-management CRM in Bangladesh. Clients chat or speak (voice is transcribed, so expect spelling mistakes) to run Meta (Facebook) ads on THEIR OWN ad accounts.
Always reply in short, simple Bengali (বাংলা script), 1-4 sentences, unless the client writes English.
Current time in Bangladesh (Asia/Dhaka, UTC+06:00): ${now}.${selectedAccount ? ` The account selected on screen: ${selectedAccount}.` : ""}

How to work:
- Use the read tools to look things up yourself (accounts, campaigns, Pages, video library, posts). Never invent ids.
- Any change (create campaigns, start/pause, budget change, delete) MUST go through propose_plan. Never say something is done; after proposing, tell the client to check the list and press "Confirm".
- Bulk requests are normal: "make 20 campaigns with these videos at $5" = one create_campaign per campaign, each with its own video_id, daily_budget 5, clear numbered names. If they ask for more campaigns than videos, ask whether to reuse videos.
- Defaults when not stated: objective MESSAGES, countries ["BD"], age 18-65, gender all, publish true, runs until paused. If the account has only one Page, use it; otherwise ask which Page.
- MESSAGES ads with a video need a short primary text (message); write a friendly Bengali line if they don't give one, and show it in the plan summary.
- Schedules: "kal sokal 9 tay" etc. → run_at with +06:00 offset. Daily repeats → repeat "daily". If they want something at a time AND also now, make two plans.
- Ad account status must be 1 (active) to create; otherwise explain the problem.
- Budget is per campaign per day in USD. For shared (wallet) accounts the spend is charged from their CRM wallet.
- Only these goals are available here: Messages, Engagement, Traffic, Awareness. For Sales/Leads with a Pixel, tell them to use the Create button in My Ads.
- Stay on ads topics; be brief.`;
}

export type ChatMessage = { role: "user" | "assistant"; content: any };

// Thinking blocks are bound to the exact request they came from (system prompt includes the time),
// so they are never carried across turns.
function stripThinking(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
    const content = m.content.filter((b: any) => b?.type !== "thinking" && b?.type !== "redacted_thinking");
    return { ...m, content: content.length ? content : [{ type: "text", text: "…" }] };
  });
}

function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  let list = stripThinking(messages).slice(-40);
  // Start at a plain user text turn so tool_use/tool_result pairs are never split.
  while (list.length && !(list[0].role === "user" && typeof list[0].content === "string")) list = list.slice(1);
  return list;
}

export async function agentChat(admin: any, c: Caller, history: ChatMessage[], selectedAccount?: string) {
  const key = String(process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) throw new Error("AI Agent চালু নেই — Vercel-এ ANTHROPIC_API_KEY বসিয়ে Redeploy করুন");
  const model = String(process.env.ANTHROPIC_MODEL ?? "").trim() || DEFAULT_MODEL;
  const messages: ChatMessage[] = trimHistory(history);
  let plan: Plan | null = null;
  let planError: string | null = null;
  const system = systemPrompt(selectedAccount);
  for (let i = 0; i < 8; i++) {
    const res = await fetch(CLAUDE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 4096, system, tools: TOOLS, messages }),
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j) {
      const m = j?.error?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error("ANTHROPIC_API_KEY ঠিক নেই — Vercel-এ সঠিক key বসান");
      if (res.status === 429 || res.status === 529) throw new Error("AI এখন ব্যস্ত — একটু পরে আবার চেষ্টা করুন");
      throw new Error(`AI উত্তর দিতে পারেনি: ${m}`);
    }
    messages.push({ role: "assistant", content: j.content });
    if (j.stop_reason !== "tool_use") break;
    const results: any[] = [];
    for (const b of j.content ?? []) {
      if (b.type !== "tool_use") continue;
      let out: unknown;
      try {
        if (b.name === "propose_plan") {
          plan = normalizePlan(b.input);
          planError = null;
          out = { shown_to_client: true, actions: plan.actions.length, note: "The client now sees this plan with a Confirm button. Do not call propose_plan again for the same request; briefly tell them to review and confirm." };
        } else {
          out = await runTool(admin, c, b.name, b.input ?? {});
        }
      } catch (e: any) {
        if (b.name === "propose_plan") planError = String(e?.message || e);
        out = { error: String(e?.message || e) };
      }
      results.push({ type: "tool_result", tool_use_id: b.id, content: cut(JSON.stringify(out), 12000), ...(out && typeof out === "object" && "error" in (out as any) ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  const last = messages[messages.length - 1];
  const reply = last?.role === "assistant" && Array.isArray(last.content)
    ? last.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim()
    : "";
  return { messages: stripThinking(messages), reply: reply || (plan ? "Plan তৈরি — নিচের তালিকা দেখে Confirm চাপুন।" : planError ? `Plan বানানো যায়নি: ${planError}` : "…"), plan };
}

// ---------------- tasks ----------------
type Step = { label: string; body: Record<string, unknown>; status: "pending" | "done" | "failed"; error?: string; result?: string };

export async function createTask(admin: any, userId: string, plan: Plan, asUserId?: string) {
  const steps: Step[] = plan.actions.map((a) => {
    const s = expandAction(a);
    return { ...s, body: asUserId ? { ...s.body, asUserId } : s.body, status: "pending" as const };
  });
  const { data, error } = await admin.from("ads_agent_tasks").insert({
    user_id: userId, title: plan.summary || `${steps.length}টি কাজ`, run_at: plan.run_at ?? new Date().toISOString(),
    repeat: plan.repeat, steps, status: "scheduled",
  }).select("*").single();
  if (error) throw new Error(`কাজ সেভ হয়নি: ${error.message}`);
  return data;
}

/** Runs pending steps of one task within a time budget; safe to call from the browser loop and the cron. */
export async function processTask(admin: any, origin: string, taskId: string, budgetMs = 45_000) {
  const started = Date.now();
  const nowIso = new Date().toISOString();
  const { data: claimed } = await admin.from("ads_agent_tasks")
    .update({ locked_until: new Date(Date.now() + budgetMs + 30_000).toISOString(), status: "running", updated_at: nowIso })
    .eq("id", taskId).in("status", ["scheduled", "running"]).lte("run_at", nowIso)
    .or(`locked_until.is.null,locked_until.lt."${nowIso}"`)
    .select("*").maybeSingle();
  if (!claimed) {
    const { data: cur } = await admin.from("ads_agent_tasks").select("*").eq("id", taskId).maybeSingle();
    return cur;
  }
  const task = claimed;
  const steps: Step[] = Array.isArray(task.steps) ? task.steps : [];
  const c: Caller = { origin, userId: String(task.user_id) };
  const save = (patch: Record<string, unknown>) => admin.from("ads_agent_tasks").update({ ...patch, steps, updated_at: new Date().toISOString() }).eq("id", task.id);
  while (Date.now() - started < budgetMs) {
    const batch = steps.filter((s) => s.status === "pending").slice(0, 3);
    if (!batch.length) break;
    await Promise.all(batch.map(async (s) => {
      try {
        const r = await callManagedAds(admin, c, s.body);
        s.status = "done";
        s.result = r?.campaignId ? `Campaign ${r.campaignId}` : "OK";
        delete s.error;
      } catch (e: any) {
        s.status = "failed";
        s.error = cut(e?.message || e, 400);
      }
    }));
    await save({});
  }
  const pending = steps.filter((s) => s.status === "pending").length;
  if (pending) {
    await save({ locked_until: null, status: "running" });
  } else {
    const failed = steps.filter((s) => s.status === "failed").length;
    if (task.repeat === "daily") {
      const next = new Date(Date.parse(task.run_at) + 86400_000);
      while (next.getTime() < Date.now()) next.setTime(next.getTime() + 86400_000);
      const lastError = failed ? steps.find((s) => s.status === "failed")?.error ?? null : null;
      steps.forEach((s) => { s.status = "pending"; delete s.error; delete s.result; });
      await save({ status: "scheduled", run_at: next.toISOString(), locked_until: null, last_run_at: new Date().toISOString(), last_error: lastError });
    } else {
      await save({ status: failed === steps.length ? "failed" : "done", locked_until: null, last_run_at: new Date().toISOString(), last_error: failed ? `${failed}টি কাজ হয়নি` : null });
    }
  }
  const { data: after } = await admin.from("ads_agent_tasks").select("*").eq("id", task.id).maybeSingle();
  return after;
}
