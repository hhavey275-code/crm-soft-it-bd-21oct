import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
async function decryptToken(stored, secret) {
  if (!stored.startsWith("enc:")) return stored;
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, [
      "deriveKey"
    ]);
    const key = await crypto.subtle.deriveKey({
      name: "PBKDF2",
      salt: enc.encode("bm-token-enc-v1"),
      iterations: 100000,
      hash: "SHA-256"
    }, keyMaterial, {
      name: "AES-GCM",
      length: 256
    }, false, [
      "decrypt"
    ]);
    const combined = Uint8Array.from(atob(stored.slice(4)), (c)=>c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv
    }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch  {
    return stored;
  }
}
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
};
const DEFAULT_META_PROXY_URL = "https://app.softitbd.com/api/meta-proxy";
// Track route + IP used for the most recent Meta API call (per request)
let lastMetaVia = "direct";
let lastMetaIp: string | null = null;
// Bangladesh timezone helpers (UTC+6, no DST). Day rollover at 00:00 BD time.
function bdDateString(date = new Date()) {
  const bdMs = date.getTime() + 6 * 60 * 60 * 1000;
  return new Date(bdMs).toISOString().slice(0, 10);
}
function bdYesterdayString(date = new Date()) {
  const bdMs = date.getTime() + 6 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000;
  return new Date(bdMs).toISOString().slice(0, 10);
}
async function metaFetch(url, options = {}) {
  if (!url.startsWith("https://graph.facebook.com/")) return fetch(url, options);
  const proxySecret = Deno.env.get("META_PROXY_SECRET")?.trim();
  const proxyUrl = (Deno.env.get("META_PROXY_URL") || DEFAULT_META_PROXY_URL).trim();
  if (proxySecret && proxyUrl) {
    try {
      const headers = new Headers(options.headers ?? {});
      const contentType = headers.get("Content-Type") ?? headers.get("content-type") ?? undefined;
      const method = options.method ?? "GET";
      const body = options.body instanceof URLSearchParams ? options.body.toString() : typeof options.body === "string" ? options.body : undefined;
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-proxy-secret": proxySecret
        },
        body: JSON.stringify({
          url,
          method,
          body,
          contentType
        })
      });
      // Capture proxy IP from response header
      try {
        const proxyIp = proxyRes.headers.get("x-egress-ip") || proxyRes.headers.get("x-proxy-ip");
        if (proxyIp) lastMetaIp = proxyIp;
      } catch  {}
      const text = await proxyRes.text();
      const trimmed = text.trimStart();
      const looksLikeHtml = trimmed.startsWith("<!") || trimmed.startsWith("<html");
      // Detect proxy-level errors (proxy server reporting its own failure,
      // not a Meta API error). Proxy errors look like {"error":"string"};
      // Meta errors look like {"error":{"message":...,"code":...}}.
      let isProxyOwnError = false;
      if (proxyRes.status >= 500 && proxyRes.status < 600 && trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed.error === "string") {
            isProxyOwnError = true;
            console.warn("Proxy returned own error, falling back to direct Meta API:", parsed.error);
          }
        } catch  {}
      }
      if (!looksLikeHtml && !isProxyOwnError) {
        lastMetaVia = "proxy";
        return new Response(text, {
          status: proxyRes.status,
          headers: proxyRes.headers
        });
      }
      if (looksLikeHtml) {
        console.warn("Proxy returned HTML, falling back to direct Meta API call");
      }
    } catch (proxyErr) {
      console.warn("Proxy failed, falling back to direct call:", proxyErr);
    }
  }
  lastMetaVia = "direct";
  lastMetaIp = null;
  return fetch(url, options);
}
function chunk(arr, size) {
  const chunks = [];
  for(let i = 0; i < arr.length; i += size){
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
const delay = (ms)=>new Promise((r)=>setTimeout(r, ms));
async function batchSelect(supabase, table, column, ids, selectStr) {
  const batches = chunk(ids, 30);
  const results = [];
  for (const batch of batches){
    const { data, error } = await supabase.from(table).select(selectStr).in(column, batch);
    if (error) throw error;
    if (data) results.push(...data);
  }
  return results;
}
function extractOrders(data) {
  const actions = data?.data?.[0]?.actions;
  if (!actions) return 0;
  const purchaseTypes = [
    "purchase"
  ];
  let total = 0;
  for (const a of actions){
    if (purchaseTypes.includes(a.action_type)) {
      total += parseInt(a.value, 10) || 0;
    }
  }
  return total;
}
function extractMessages(data) {
  const actions = data?.data?.[0]?.actions;
  if (!actions) return 0;
  const messageTypes = [
    "onsite_conversion.messaging_conversation_started_7d",
    "onsite_conversion.messaging_first_reply",
    "onsite_conversion.messaging_block",
    "messaging_conversation_started_7d"
  ];
  let total = 0;
  for (const a of actions){
    if (messageTypes.includes(a.action_type)) {
      total += parseInt(a.value, 10) || 0;
    }
  }
  return total;
}
async function fetchActiveCampaignCount(actId, accessToken) {
  try {
    const filterParam = encodeURIComponent(JSON.stringify([
      {
        "field": "effective_status",
        "operator": "IN",
        "value": [
          "ACTIVE"
        ]
      }
    ]));
    const res = await metaFetch(`https://graph.facebook.com/v23.0/${actId}/campaigns?filtering=${filterParam}&summary=true&limit=0&access_token=${accessToken}`);
    const data = await res.json();
    return data?.summary?.total_count ?? 0;
  } catch  {
    return 0;
  }
}
async function fetchBudgetTotalByEdge(actId, accessToken, edge) {
  try {
    const filterParam = encodeURIComponent(JSON.stringify([
      {
        "field": "effective_status",
        "operator": "IN",
        "value": [
          "ACTIVE"
        ]
      }
    ]));
    let url = `https://graph.facebook.com/v23.0/${actId}/${edge}?fields=daily_budget,name&filtering=${filterParam}&limit=200&access_token=${accessToken}`;
    let total = 0;
    let pageGuard = 0;
    const debugItems = [];
    while(url && pageGuard < 5){
      const res = await metaFetch(url);
      const data = await res.json();
      if (data?.error) {
        console.log(`DEBUG_BUDGET_ERROR[${actId}/${edge}]:`, JSON.stringify(data.error));
        return 0;
      }
      for (const row of data?.data ?? []){
        const rawVal = row?.daily_budget;
        debugItems.push({
          name: row?.name,
          daily_budget_raw: rawVal,
          id: row?.id
        });
        if (rawVal !== undefined && rawVal !== null) {
          const parsed = parseFloat(String(rawVal));
          if (Number.isFinite(parsed) && parsed > 0) {
            // Meta returns daily_budget in cents (minor units)
            total += parsed / 100;
          }
        }
      }
      url = data?.paging?.next ?? "";
      pageGuard += 1;
    }
    console.log(`DEBUG_BUDGET[${actId}/${edge}]: items=${JSON.stringify(debugItems)}, total=${total}`);
    return Number(total.toFixed(2));
  } catch  {
    return 0;
  }
}
async function fetchActiveDailyBudget(actId, accessToken) {
  const [campaignBudgetTotal, adsetBudgetTotal] = await Promise.all([
    fetchBudgetTotalByEdge(actId, accessToken, "campaigns"),
    fetchBudgetTotalByEdge(actId, accessToken, "adsets")
  ]);
  return Number(Math.max(campaignBudgetTotal, adsetBudgetTotal).toFixed(2));
}
// Check for Meta API rate limit errors
function checkRateLimit(data) {
  if (data?.error?.code === 17 || data?.error?.code === 32 || data?.error?.code === 4) return data.error.code;
  return null;
}
function extractNumericValue(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input === "string") {
    const n = Number(input);
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(input)) {
    for (const item of input){
      const n = extractNumericValue(item);
      if (n !== null) return n;
    }
    return null;
  }
  if (typeof input === "object") {
    const preferredKeys = [
      "amount",
      "value",
      "threshold_amount",
      "daily_spend_limit",
      "adtrust_dsl",
      "min_billing_threshold"
    ];
    for (const key of preferredKeys){
      if (key in input) {
        const n = extractNumericValue(input[key]);
        if (n !== null) return n;
      }
    }
    if ("data" in input) {
      const n = extractNumericValue(input.data);
      if (n !== null) return n;
    }
    for (const val of Object.values(input)){
      const n = extractNumericValue(val);
      if (n !== null) return n;
    }
  }
  return null;
}
function normalizeCurrency(raw) {
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return 0;
  // Meta may return either minor units (e.g. "2500") or major units (e.g. "25.00")
  if (Number.isInteger(raw) && raw >= 100) return raw / 100;
  return raw;
}
function extractCurrencyFromPayload(payload, field) {
  if (!payload || payload.error) return 0;
  const direct = extractNumericValue(payload?.[field]);
  if (direct !== null) return normalizeCurrency(direct);
  if (Array.isArray(payload?.data)) {
    for (const row of payload.data){
      const n = extractNumericValue(row?.[field] ?? row);
      if (n !== null) return normalizeCurrency(n);
    }
  } else if (payload?.data) {
    const n = extractNumericValue(payload.data?.[field] ?? payload.data);
    if (n !== null) return normalizeCurrency(n);
  }
  return 0;
}
// Process a single account's Meta API calls
async function processAccount(account, serviceKey, date, date_from, date_to) {
  const emptyInsight = {
    today_spend: 0,
    yesterday_spend: 0,
    today_orders: 0,
    yesterday_orders: 0,
    active_campaigns: 0,
    today_messages: 0,
    yesterday_messages: 0,
    balance: 0,
    daily_spend_limit: 0,
    billing_threshold: 0,
    cards: []
  };
  const rawToken = account.business_managers?.access_token;
  const actId = account.account_id;
  if (!rawToken) {
    return {
      id: account.id,
      insight: {
        ...emptyInsight
      }
    };
  }
  const accessToken = await decryptToken(rawToken, serviceKey);
  try {
    const isDateRange = date_from && date_to;
    const isSingleDate = date && !isDateRange;
    let todayUrl;
    let yesterdayUrl = "";
    let combinedTodayYesterday = false;
    if (isDateRange) {
      todayUrl = `https://graph.facebook.com/v23.0/${actId}/insights?fields=spend,actions&time_range={"since":"${date_from}","until":"${date_to}"}&time_increment=1&access_token=${accessToken}`;
    } else if (isSingleDate) {
      todayUrl = `https://graph.facebook.com/v23.0/${actId}/insights?fields=spend,actions&time_range={"since":"${date}","until":"${date}"}&access_token=${accessToken}`;
      const d = new Date(date);
      d.setDate(d.getDate() - 1);
      const prevDate = d.toISOString().split("T")[0];
      yesterdayUrl = `https://graph.facebook.com/v23.0/${actId}/insights?fields=spend,actions&time_range={"since":"${prevDate}","until":"${prevDate}"}&access_token=${accessToken}`;
    } else {
      // Combine today + yesterday into single call using time_increment=1.
      // Use Asia/Dhaka calendar dates so day rolls over at 12:00 AM BD time.
      const todayStr = bdDateString();
      const yesterdayStr = bdYesterdayString();
      todayUrl = `https://graph.facebook.com/v23.0/${actId}/insights?fields=spend,actions&time_range={"since":"${yesterdayStr}","until":"${todayStr}"}&time_increment=1&access_token=${accessToken}`;
      combinedTodayYesterday = true;
    }
    // Main account data fetch
    const accountFieldsUrl = `https://graph.facebook.com/v23.0/${actId}?fields=balance,amount_spent,spend_cap,funding_source_details,is_prepay_account,account_status,disable_reason&access_token=${accessToken}`;
    // Backup/all linked cards via payment cycle endpoint (Meta only returns primary in funding_source_details)
    const paymentCycleUrl = `https://graph.facebook.com/v23.0/${actId}/adspaymentcycle?fields=funding_source_details&access_token=${accessToken}`;
    const fetchPromises = [
      metaFetch(todayUrl),
      metaFetch(accountFieldsUrl),
      metaFetch(paymentCycleUrl),
      fetchActiveCampaignCount(actId, accessToken).then((c)=>({
          json: async ()=>c
        }))
    ];
    if (yesterdayUrl) {
      fetchPromises.splice(1, 0, metaFetch(yesterdayUrl));
    }
    const responses = await Promise.all(fetchPromises);
    let todayData, yesterdayData, accountData, paymentCycleData, activeCampaigns;
    if (yesterdayUrl) {
      todayData = await responses[0].json();
      yesterdayData = await responses[1].json();
      accountData = await responses[2].json();
      paymentCycleData = await responses[3].json();
      activeCampaigns = await responses[4].json();
    } else {
      todayData = await responses[0].json();
      yesterdayData = {
        data: []
      };
      accountData = await responses[1].json();
      paymentCycleData = await responses[2].json();
      activeCampaigns = await responses[3].json();
    }
    const rlCode = checkRateLimit(todayData) || checkRateLimit(yesterdayData) || checkRateLimit(accountData) || checkRateLimit(paymentCycleData);
    if (rlCode) {
      return {
        id: account.id,
        insight: {
          ...emptyInsight
        },
        rateLimit: {
          account_id: actId,
          account_name: account.account_name || actId,
          error_code: rlCode
        }
      };
    }
    // Parse today/yesterday spend
    let todaySpend = 0;
    let yesterdaySpend = 0;
    if (combinedTodayYesterday && Array.isArray(todayData?.data)) {
      // Combined call: rows tagged by BD calendar date
      const todayStr = bdDateString();
      for (const row of todayData.data){
        const rowDate = row.date_start?.split("T")[0] || "";
        const spend = row.spend ? parseFloat(row.spend) : 0;
        if (rowDate === todayStr) {
          todaySpend = spend;
        } else {
          yesterdaySpend = spend;
        }
      }
    } else if (isDateRange && Array.isArray(todayData?.data)) {
      todaySpend = todayData.data.reduce((sum, row)=>sum + (row.spend ? parseFloat(row.spend) : 0), 0);
    } else {
      todaySpend = todayData?.data?.[0]?.spend ? parseFloat(todayData.data[0].spend) : 0;
      yesterdaySpend = yesterdayData?.data?.[0]?.spend ? parseFloat(yesterdayData.data[0].spend) : 0;
    }
    const balance = accountData?.balance ? parseFloat(accountData.balance) / 100 : 0;
    // Daily spend limit and billing threshold removed from UI
    // as Meta API doesn't reliably provide these fields.
    const dailySpendLimit = 0;
    const billingThreshold = 0;
    const fsd = accountData?.funding_source_details;
    let adAccountUpdate = undefined;
    if (!isSingleDate && !isDateRange && accountData?.amount_spent !== undefined) {
      const metaAmountSpent = parseFloat(accountData.amount_spent) / 100;
      const rawSpendCap = accountData?.spend_cap;
      const metaSpendCap = rawSpendCap ? parseFloat(rawSpendCap) / 100 : 0;
      adAccountUpdate = {
        id: account.id,
        amount_spent: metaAmountSpent
      };
      if (metaSpendCap > 0) {
        adAccountUpdate.spend_cap = metaSpendCap;
      }
      // Map Meta account_status to CRM status
      const metaStatus = accountData?.account_status;
      if (metaStatus !== undefined && metaStatus !== null) {
        // Meta: 1=ACTIVE, 2=DISABLED, 3=UNSETTLED, 7=PENDING_RISK_REVIEW, 8=PENDING_SETTLEMENT, 9=IN_GRACE_PERIOD, 100=PENDING_CLOSURE, 101=CLOSED, 201=ANY_ACTIVE, 202=ANY_CLOSED
        if (metaStatus === 1) adAccountUpdate.status = "active";
        else if (metaStatus === 2) adAccountUpdate.status = "disabled";
        else if (metaStatus === 3) adAccountUpdate.status = "unsettled";
        else if (metaStatus === 101 || metaStatus === 100) adAccountUpdate.status = "disabled";
        else adAccountUpdate.status = "hold";
      }
    }
    const cards = [];
    const seenCardIds = new Set();
    const pushCard = (id, displayString, type, isPrimary)=>{
      const sid = String(id ?? "").trim();
      if (!sid || seenCardIds.has(sid)) return;
      seenCardIds.add(sid);
      cards.push({
        id: sid,
        display_string: displayString || `Card ending ${sid.slice(-4) || "****"}`,
        type: type ?? "unknown",
        is_primary: isPrimary
      });
    };
    // Primary card from funding_source_details
    if (fsd) {
      pushCard(fsd.id, fsd.display_string, fsd.type, true);
    }
    // Backup / additional cards from /adspaymentcycle
    if (paymentCycleData && !paymentCycleData.error && Array.isArray(paymentCycleData.data)) {
      for (const cycle of paymentCycleData.data){
        const source = cycle?.funding_source_details;
        if (!source) continue;
        pushCard(source.id, source.display_string, source.type, false);
      }
    } else if (paymentCycleData?.error) {
      console.log(`adspaymentcycle for ${actId} error:`, JSON.stringify(paymentCycleData.error));
    }
    // Build daily breakdown for date range queries
    let dailyBreakdown;
    if (isDateRange && todayData?.data && Array.isArray(todayData.data)) {
      dailyBreakdown = todayData.data.map((row)=>({
          date: row.date_start?.split("T")[0] || "",
          spend: row.spend ? parseFloat(row.spend) : 0
        }));
    }
    // For combined today+yesterday, extract orders/messages per day
    let todayOrders = 0, yesterdayOrders = 0, todayMessages = 0, yesterdayMessages = 0;
    if (combinedTodayYesterday && Array.isArray(todayData?.data)) {
      const todayStr = bdDateString();
      for (const row of todayData.data){
        const rowDate = row.date_start?.split("T")[0] || "";
        const fakeData = {
          data: [
            row
          ]
        };
        if (rowDate === todayStr) {
          todayOrders = extractOrders(fakeData);
          todayMessages = extractMessages(fakeData);
        } else {
          yesterdayOrders = extractOrders(fakeData);
          yesterdayMessages = extractMessages(fakeData);
        }
      }
    } else {
      todayOrders = extractOrders(todayData);
      yesterdayOrders = extractOrders(yesterdayData);
      todayMessages = extractMessages(todayData);
      yesterdayMessages = extractMessages(yesterdayData);
    }
    // Extract account_status and disable_reason from accountData
    const metaAccountStatus = accountData?.account_status ?? null;
    const metaDisableReason = accountData?.disable_reason ?? null;
    return {
      id: account.id,
      insight: {
        today_spend: todaySpend,
        yesterday_spend: yesterdaySpend,
        date_spend: isSingleDate || isDateRange ? todaySpend : undefined,
        daily_breakdown: dailyBreakdown,
        today_orders: todayOrders,
        yesterday_orders: yesterdayOrders,
        active_campaigns: activeCampaigns,
        today_messages: todayMessages,
        yesterday_messages: yesterdayMessages,
        balance,
        daily_spend_limit: dailySpendLimit,
        billing_threshold: billingThreshold,
        cards,
        account_status: metaAccountStatus,
        disable_reason: metaDisableReason
      },
      adAccountUpdate
    };
  } catch (fetchErr) {
    if (fetchErr instanceof Error && fetchErr.message.includes("META_PROXY")) {
      throw fetchErr;
    }
    if (fetchErr?.status === 429) {
      return {
        id: account.id,
        insight: {
          ...emptyInsight
        },
        rateLimit: {
          account_id: actId,
          account_name: account.account_name || actId,
          error_code: 429
        },
        syncError: "Meta API rate limit (429)"
      };
    }
    return {
      id: account.id,
      insight: {
        ...emptyInsight
      },
      syncError: String(fetchErr?.message || fetchErr || "Unknown sync error")
    };
  }
}
// ====== MAIN ======
// Process accounts in small batches (5 at a time) with 300ms delay between batches
// to avoid Meta API rate limits. Each account makes 3-4 API calls, so batch of 5 = ~20 calls.
const META_BATCH_SIZE = 20;
const META_BATCH_DELAY_MS = 300;

async function logMetaCall(supabase: any, params: {
  userId: string | null;
  userName: string | null;
  action: string;
  details: string;
}) {
  try {
    await supabase.from("system_logs").insert({
      user_id: params.userId,
      user_name: params.userName || "system",
      action: params.action,
      details: params.details,
    });
  } catch (e) {
    console.warn("logMetaCall failed:", e);
  }
}

Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({
      error: 'Unauthorized'
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const token = authHeader.replace('Bearer ', '');
  let callerUserId = null;
  let isAdminOrService = false;
  // Allow service_role calls (from cron/internal) or verify user JWT
  if (token === serviceKey) {
    isAdminOrService = true;
  } else {
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data, error } = await anonClient.auth.getClaims(token);
    if (error || !data?.claims) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    callerUserId = data.claims.sub;
    // Check if admin/superadmin
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await adminClient.from('user_roles').select('role').eq('user_id', callerUserId).in('role', [
      'admin',
      'superadmin',
      'agency'
    ]).limit(1);
    if (roleRow && roleRow.length > 0) {
      isAdminOrService = true;
    }
  }
  try {
    const { ad_account_ids, source = "cache", date, date_from, date_to } = await req.json();
    if (!ad_account_ids || !Array.isArray(ad_account_ids) || ad_account_ids.length === 0) {
      return new Response(JSON.stringify({
        error: "ad_account_ids required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Limit accounts per request to prevent timeout
    const MAX_ACCOUNTS = 100;
    if (source === "meta" && ad_account_ids.length > MAX_ACCOUNTS) {
      return new Response(JSON.stringify({
        error: `Too many accounts (${ad_account_ids.length}). Maximum ${MAX_ACCOUNTS} per request. Please use smaller batches.`
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    // Ownership check: non-admin users can only query their assigned accounts
    let filteredIds = ad_account_ids;
    if (!isAdminOrService && callerUserId) {
      const { data: assigned } = await supabase.from('user_ad_accounts').select('ad_account_id').eq('user_id', callerUserId).in('ad_account_id', ad_account_ids);
      filteredIds = assigned?.map((r)=>r.ad_account_id) ?? [];
      if (filteredIds.length === 0) {
        return new Response(JSON.stringify({
          insights: {}
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    if (source === "cache") {
      const cached = await batchSelect(supabase, "ad_account_insights", "ad_account_id", filteredIds, "*");
      const insights = {};
      for (const row of cached){
        insights[row.ad_account_id] = {
          today_spend: Number(row.today_spend),
          yesterday_spend: Number(row.yesterday_spend),
          today_orders: Number(row.today_orders ?? 0),
          yesterday_orders: Number(row.yesterday_orders ?? 0),
          active_campaigns: Number(row.active_campaigns ?? 0),
          today_messages: Number(row.today_messages ?? 0),
          yesterday_messages: Number(row.yesterday_messages ?? 0),
          balance: Number(row.balance),
          daily_spend_limit: Number(row.daily_spend_limit ?? 0),
          billing_threshold: Number(row.billing_threshold ?? 0),
          cards: row.cards ?? [],
          updated_at: row.updated_at,
          last_spend_date: row.last_spend_date ?? null
        };
      }
      // Log cache reads only when caller is a real user (skip noisy service polls)
      if (callerUserId) {
        let cacheUserName: string | null = null;
        try {
          const { data: pr } = await supabase.from("profiles").select("full_name, email").eq("user_id", callerUserId).single();
          cacheUserName = pr?.full_name || pr?.email || null;
        } catch {}
        await logMetaCall(supabase, {
          userId: callerUserId,
          userName: cacheUserName,
          action: "Meta Insights Cache Read",
          details: `${filteredIds.length} account(s) from cache`,
        });
      }
      return new Response(JSON.stringify({
        insights
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // source === "meta" — fetch from Meta API in controlled batches
    const accounts = await batchSelect(supabase, "ad_accounts", "id", filteredIds, "id, account_id, amount_spent, spend_cap, business_manager_id, business_managers(access_token)");
    const insights = {};
    const rateLimited = [];
    const adAccountUpdates = [];
    const syncErrors = {};
    // Process in small batches with delay to avoid Meta rate limits
    const accountBatches = chunk(accounts ?? [], META_BATCH_SIZE);
    let hitRateLimit = false;
    console.log(`Processing ${accounts?.length ?? 0} accounts in ${accountBatches.length} batches of ${META_BATCH_SIZE}`);
    for(let i = 0; i < accountBatches.length; i++){
      const batch = accountBatches[i];
      // If we already hit a rate limit, skip remaining Meta calls and return empty
      if (hitRateLimit) {
        for (const account of batch){
          insights[account.id] = {
            today_spend: 0,
            yesterday_spend: 0,
            today_orders: 0,
            yesterday_orders: 0,
            active_campaigns: 0,
            today_messages: 0,
            yesterday_messages: 0,
            balance: 0,
            daily_spend_limit: 0,
            billing_threshold: 0,
            cards: []
          };
        }
        continue;
      }
      // Process batch concurrently (small batch = safe)
      const results = await Promise.all(batch.map((account)=>processAccount(account, serviceKey, date, date_from, date_to)));
      for (const result of results){
        insights[result.id] = result.insight;
        if (result.rateLimit) {
          rateLimited.push(result.rateLimit);
          hitRateLimit = true;
        }
        if (result.adAccountUpdate) {
          adAccountUpdates.push(result.adAccountUpdate);
        }
        if (result.syncError) {
          syncErrors[result.id] = result.syncError;
        }
      }
      // Add delay between batches (skip after last batch)
      if (i < accountBatches.length - 1 && !hitRateLimit) {
        await delay(META_BATCH_DELAY_MS);
      }
    }
    // Upsert all insights into DB (only for non-date queries)
    if (!date && !date_from && !date_to) {
      const todayDate = bdDateString();
      // Pre-fetch existing last_spend_date so we can decide which accounts need a deeper lookback.
      const insightAccountIds = Object.keys(insights);
      const existingLastSpend = new Map();
      if (insightAccountIds.length > 0) {
        const existingRows = await batchSelect(supabase, "ad_account_insights", "ad_account_id", insightAccountIds, "ad_account_id, last_spend_date");
        for (const r of existingRows ?? []){
          existingLastSpend.set(r.ad_account_id, r.last_spend_date ?? null);
        }
      }
      // For accounts with both today=0 AND yesterday=0 AND no existing last_spend_date,
      // do a single 30-day lookback to recover the most recent spend date from Meta.
      // This prevents fresh accounts from being mis-labeled as "Unknown / 29d inactive"
      // when they actually had spend in the last few weeks.
      const needsLookback = [];
      for (const [adAccountId, data] of Object.entries(insights)){
        if ((data.today_spend ?? 0) > 0 || (data.yesterday_spend ?? 0) > 0) continue;
        if (existingLastSpend.get(adAccountId)) continue;
        needsLookback.push(adAccountId);
      }
      const lookbackResults = new Map();
      if (needsLookback.length > 0) {
        const accById = new Map();
        for (const a of accounts ?? [])accById.set(a.id, a);
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const until = bdYesterdayString();
        // Run in chunks of 5 with small delay to stay under Meta rate limits.
        const lbChunks = chunk(needsLookback, 5);
        for (const lbChunk of lbChunks){
          await Promise.all(lbChunk.map(async (adAccountId)=>{
            try {
              const acc = accById.get(adAccountId);
              const rawTok = acc?.business_managers?.access_token;
              if (!rawTok) return;
              const accessToken = await decryptToken(rawTok, serviceKey);
              const url = `https://graph.facebook.com/v23.0/${acc.account_id}/insights?fields=spend&time_range={"since":"${since}","until":"${until}"}&time_increment=1&limit=90&access_token=${accessToken}`;
              const res = await metaFetch(url);
              const json = await res.json();
              if (json?.error) return;
              let latest = null;
              for (const row of json?.data ?? []){
                const spend = parseFloat(row.spend ?? "0");
                const date = row.date_start?.split("T")[0];
                if (spend > 0 && date && (!latest || date > latest)) latest = date;
              }
              if (latest) lookbackResults.set(adAccountId, latest);
            } catch (e) {
              console.warn(`lookback failed for ${adAccountId}:`, e);
            }
          }));
          await delay(150);
        }
      }
      const upsertRows = Object.entries(insights).map(([adAccountId, data])=>{
        const row = {
          ad_account_id: adAccountId,
          today_spend: data.today_spend,
          yesterday_spend: data.yesterday_spend,
          today_orders: data.today_orders,
          yesterday_orders: data.yesterday_orders,
          active_campaigns: data.active_campaigns,
          today_messages: data.today_messages,
          yesterday_messages: data.yesterday_messages,
          balance: data.balance,
          daily_spend_limit: data.daily_spend_limit,
          billing_threshold: data.billing_threshold,
          cards: data.cards,
          updated_at: new Date().toISOString()
        };
        if (data.today_spend > 0) {
          row.last_spend_date = todayDate;
        } else if (data.yesterday_spend > 0) {
          // Today=0 but yesterday had spend → record yesterday so the account
          // doesn't falsely appear as "inactive for 29 days".
          row.last_spend_date = bdYesterdayString();
        } else if (lookbackResults.has(adAccountId)) {
          // Recovered from 30-day lookback for accounts that had no recorded
          // last_spend_date — prevents "Unknown / Needs sync" from sticking
          // on accounts that simply hadn't spent today or yesterday.
          row.last_spend_date = lookbackResults.get(adAccountId);
        }
        // If both today=0 AND yesterday=0 AND no lookback hit, leave field unset
        // so we DON'T overwrite a previously recorded last_spend_date with NULL.
        return row;
      });
      const upsertBatches = chunk(upsertRows, 30);
      for (const batch of upsertBatches){
        await supabase.from("ad_account_insights").upsert(batch, {
          onConflict: "ad_account_id"
        });
      }
      if (adAccountUpdates.length > 0) {
        const updateBatches = chunk(adAccountUpdates, 30);
        for (const batch of updateBatches){
          for (const item of batch){
            const updateData = {
              amount_spent: item.amount_spent
            };
            if (item.spend_cap !== undefined) {
              updateData.spend_cap = item.spend_cap;
            }
            if (item.status !== undefined) {
              updateData.status = item.status;
            }
            await supabase.from("ad_accounts").update(updateData).eq("id", item.id);
          }
        }
      }
      // --- Card Vault upsert + Assignment History diff/log + Last-Known State snapshot ---
      try {
        const accountMap = {};
        for (const acc of accounts ?? [])accountMap[acc.id] = acc;
        const syncedIds = Object.keys(insights);
        // Pre-fetch the most recent assignment row per (ad_account, funding_source_id)
        // to detect attached/detached/became_primary changes
        const recentEvents = syncedIds.length ? await batchSelect(supabase, "ad_account_card_assignments", "ad_account_id", syncedIds, "ad_account_id, funding_source_id, event_type, is_primary, detected_at") : [];
        // Keep latest event per (account, funding_source_id)
        const latestByKey = new Map();
        for (const ev of recentEvents){
          const key = `${ev.ad_account_id}:${ev.funding_source_id}`;
          const existing = latestByKey.get(key);
          if (!existing || new Date(ev.detected_at) > new Date(existing.detected_at)) {
            latestByKey.set(key, ev);
          }
        }
        const newAssignmentRows = [];
        const lastKnownRows = [];
        for (const adAccountId of syncedIds){
          const acc = accountMap[adAccountId];
          if (!acc) continue;
          const data = insights[adAccountId];
          const cards = Array.isArray(data?.cards) ? data.cards : [];
          // 1. Upsert each card to the vault
          for (const c of cards){
            const fsId = String(c?.id ?? "");
            if (!fsId) continue;
            try {
              await supabase.from("ad_account_cards").upsert({
                funding_source_id: fsId,
                bm_id: acc.business_manager_id ?? null,
                display_string: String(c.display_string ?? `Card ...${fsId.slice(-4)}`),
                card_type: c.type ?? null,
                exp_month: c.exp_month ?? null,
                exp_year: c.exp_year ?? null,
                last_seen_at: new Date().toISOString()
              }, {
                onConflict: "bm_id,funding_source_id",
                ignoreDuplicates: false
              });
            } catch (e) {
              console.error("card vault upsert failed:", e);
            }
          }
          // 2. Diff against the last known state — log attached/detached/became_primary
          // Find the card_id from vault for FK linkage
          const fsIds = cards.map((c)=>String(c?.id ?? "")).filter(Boolean);
          let cardIdMap = {};
          if (fsIds.length && acc.business_manager_id) {
            const { data: vaultRows } = await supabase.from("ad_account_cards").select("id, funding_source_id").eq("bm_id", acc.business_manager_id).in("funding_source_id", fsIds);
            for (const row of vaultRows ?? [])cardIdMap[row.funding_source_id] = row.id;
          }
          const seenFsIds = new Set();
          for (const c of cards){
            const fsId = String(c?.id ?? "");
            if (!fsId) continue;
            seenFsIds.add(fsId);
            const key = `${adAccountId}:${fsId}`;
            const last = latestByKey.get(key);
            const isPrimary = !!c.is_primary;
            if (!last || last.event_type === "detached") {
              newAssignmentRows.push({
                ad_account_id: adAccountId,
                card_id: cardIdMap[fsId] ?? null,
                funding_source_id: fsId,
                display_string: c.display_string ?? null,
                event_type: "attached",
                is_primary: isPrimary,
                detected_by: "sync",
                metadata: c
              });
            } else if (isPrimary && !last.is_primary) {
              newAssignmentRows.push({
                ad_account_id: adAccountId,
                card_id: cardIdMap[fsId] ?? null,
                funding_source_id: fsId,
                display_string: c.display_string ?? null,
                event_type: "became_primary",
                is_primary: true,
                detected_by: "sync",
                metadata: c
              });
            }
          }
          // Detect detachments: cards that were last known attached but no longer present
          for (const [key, last] of latestByKey.entries()){
            if (!key.startsWith(`${adAccountId}:`)) continue;
            if (last.event_type === "detached") continue;
            if (!seenFsIds.has(last.funding_source_id)) {
              newAssignmentRows.push({
                ad_account_id: adAccountId,
                card_id: null,
                funding_source_id: last.funding_source_id,
                display_string: null,
                event_type: "detached",
                is_primary: false,
                detected_by: "sync",
                metadata: {
                  reason: "no_longer_in_meta_response"
                }
              });
            }
          }
          // 3. Update last-known state (used by Hack Recovery panel)
          // If this account had a sync error, ONLY record the error — don't overwrite the last good snapshot
          const errMsg = syncErrors[adAccountId];
          if (errMsg) {
            lastKnownRows.push({
              ad_account_id: adAccountId,
              last_sync_error: errMsg,
              last_sync_error_at: new Date().toISOString()
            });
          } else {
            const lastSpendDateForSnapshot = data.today_spend > 0 ? bdDateString() : data.yesterday_spend > 0 ? bdYesterdayString() : undefined;
            lastKnownRows.push({
              ad_account_id: adAccountId,
              spend_cap: acc.spend_cap ?? 0,
              amount_spent: data.amount_spent ?? acc.amount_spent ?? 0,
              balance: data.balance ?? 0,
              account_status: data.account_status ?? null,
              cards: cards,
              last_spend_date: lastSpendDateForSnapshot,
              last_synced_at: new Date().toISOString(),
              last_sync_error: null,
              last_sync_error_at: null
            });
          }
        }
        if (newAssignmentRows.length > 0) {
          const batches = chunk(newAssignmentRows, 50);
          for (const batch of batches){
            await supabase.from("ad_account_card_assignments").insert(batch);
          }
          console.log(`Logged ${newAssignmentRows.length} card assignment events`);
        }
        if (lastKnownRows.length > 0) {
          const batches = chunk(lastKnownRows, 50);
          for (const batch of batches){
            // Strip undefined fields so onConflict update doesn't overwrite with null
            const cleaned = batch.map((r)=>{
              const out = {};
              for (const [k, v] of Object.entries(r))if (v !== undefined) out[k] = v;
              return out;
            });
            await supabase.from("ad_account_last_known_state").upsert(cleaned, {
              onConflict: "ad_account_id"
            });
          }
        }
      } catch (vaultErr) {
        console.error("card vault / assignment / last_known_state error:", vaultErr);
      }
      // --- Populate client_daily_stats per user ---
      try {
        // Get user assignments for the synced accounts
        const syncedIds = Object.keys(insights);
        const assignments = await batchSelect(supabase, "user_ad_accounts", "ad_account_id", syncedIds, "user_id, ad_account_id");
        // Group by user_id
        const userStats = {};
        for (const a of assignments){
          const ins = insights[a.ad_account_id];
          if (!ins) continue;
          if (!userStats[a.user_id]) userStats[a.user_id] = {
            spend: 0,
            orders: 0,
            count: 0
          };
          userStats[a.user_id].spend += Number(ins.today_spend ?? 0);
          userStats[a.user_id].orders += Number(ins.today_orders ?? 0);
          userStats[a.user_id].count += 1;
        }
        const dailyRows = Object.entries(userStats).map(([userId, s])=>({
            user_id: userId,
            stat_date: todayDate,
            total_spend: s.spend,
            total_orders: s.orders,
            account_count: s.count
          }));
        if (dailyRows.length > 0) {
          const dailyBatches = chunk(dailyRows, 30);
          for (const batch of dailyBatches){
            await supabase.from("client_daily_stats").upsert(batch, {
              onConflict: "user_id,stat_date"
            });
          }
        }
      } catch (dailyErr) {
        console.error("client_daily_stats upsert error:", dailyErr);
      }
      // --- Log unhealthy accounts to meta_account_events ---
      try {
        const accountMap = {};
        for (const acc of accounts ?? []){
          accountMap[acc.id] = acc;
        }
        const unhealthyEvents = Object.entries(insights).filter(([_, data])=>data.account_status && data.account_status !== 1).map(([adAccountId, data])=>{
          const acc = accountMap[adAccountId];
          return {
            ad_account_id: adAccountId,
            ad_account_name: acc?.account_name || null,
            account_meta_id: acc?.account_id || null,
            bm_id: acc?.business_manager_id || null,
            event_type: "health_check",
            actor: callerUserId ? `user:${callerUserId}` : "system:insight-sync",
            request_summary: null,
            response_summary: {
              account_status: data.account_status,
              disable_reason: data.disable_reason,
              today_spend: data.today_spend
            },
            account_status: data.account_status,
            disable_reason: data.disable_reason
          };
        });
        if (unhealthyEvents.length > 0) {
          const evBatches = chunk(unhealthyEvents, 30);
          for (const batch of evBatches){
            await supabase.from("meta_account_events").insert(batch);
          }
          console.log(`Logged ${unhealthyEvents.length} unhealthy account events`);
        }
      } catch (eventErr) {
        console.error("meta_account_events insert error:", eventErr);
      }
    }
    // Log API calls per BM
    if (source === "meta") {
      const bmCallMap = {};
      for (const account of accounts ?? []){
        const bmDbId = account.business_manager_id;
        if (bmDbId) {
          if (!bmCallMap[bmDbId]) bmCallMap[bmDbId] = {
            bmDbId,
            count: 0
          };
          bmCallMap[bmDbId].count += 3; // ~3 API calls per account (combined today+yesterday)
        }
      }
      const logRows = Object.values(bmCallMap).map(({ bmDbId, count })=>({
          business_manager_id: bmDbId,
          function_name: "get-account-insights",
          call_count: count
        }));
      if (logRows.length > 0) {
        await supabase.from("api_call_logs").insert(logRows);
      }
    }
    const now = new Date().toISOString();
    for (const key of Object.keys(insights)){
      insights[key].updated_at = now;
    }
    // Log this Meta call (live source) into system_logs
    if (callerUserId) {
      let metaUserName: string | null = null;
      try {
        const { data: pr } = await supabase.from("profiles").select("full_name, email").eq("user_id", callerUserId).single();
        metaUserName = pr?.full_name || pr?.email || null;
      } catch {}
      const isDateRange = !!(date_from && date_to);
      const action = isDateRange ? "Meta Date-Range Fetch" : "Meta Insights Refresh";
      const accountNames = (accounts ?? [])
        .map((a: any) => a.account_name || a.account_id)
        .filter(Boolean)
        .slice(0, 5)
        .join(", ");
      const moreCount = Math.max(0, (accounts?.length ?? 0) - 5);
      const range = isDateRange
        ? ` · since=${date_from} until=${date_to}`
        : (date ? ` · date=${date}` : "");
      const details = `${accounts?.length ?? 0} accounts${range} · via=${lastMetaVia} · IP: ${lastMetaIp ?? "n/a"}` +
        (accountNames ? ` · ${accountNames}${moreCount ? ` (+${moreCount} more)` : ""}` : "");
      await logMetaCall(supabase, {
        userId: callerUserId,
        userName: metaUserName,
        action,
        details,
      });
    }
    return new Response(JSON.stringify({
      insights,
      rate_limited: rateLimited
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
