// Sync a single seller_transaction row to the seller's configured Google Sheet.
// - Reads per-seller mapping from seller_sheet_config
// - Auto-creates monthly tab if missing (clones template tab if configured, else blank)
// - Idempotent via sheet_sync_log (one row per seller_transaction_id)
//
// Trigger: called by frontend after admin inserts a seller_transaction, OR
// by pg trigger via net.http_post on insert.
//
// Body: { seller_transaction_id: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const GOOGLE_SHEETS_API_KEY = Deno.env.get("GOOGLE_SHEETS_API_KEY")!;

const gwHeaders = {
  Authorization: `Bearer ${LOVABLE_API_KEY}`,
  "X-Connection-Api-Key": GOOGLE_SHEETS_API_KEY,
  "Content-Type": "application/json",
};

// ---- helpers ----------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatTabName(pattern: string, date: Date): string {
  const yyyy = date.getFullYear().toString();
  const yy = yyyy.slice(-2);
  const mmmm = MONTH_NAMES[date.getMonth()];
  const mmm = mmmm.slice(0, 3);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  // Support compound tokens like {MMMM-YYYY} as well as individual tokens.
  // Order matters: longer/compound tokens FIRST.
  return pattern
    .replace(/\{MMMM-YYYY\}/g, `${mmmm}-${yyyy}`)
    .replace(/\{MMM-YYYY\}/g, `${mmm}-${yyyy}`)
    .replace(/\{MMMM_YYYY\}/g, `${mmmm}_${yyyy}`)
    .replace(/\{MM-YYYY\}/g, `${mm}-${yyyy}`)
    .replace(/\{MMMM\}/g, mmmm)
    .replace(/\{MMM\}/g, mmm)
    .replace(/\{MM\}/g, mm)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yy);
}

function formatDateTimeBn(d: Date): string {
  // "02 April 01.40 am" style — matches Faisal Vai's sheet
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTH_NAMES[d.getMonth()].toLowerCase();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${day} ${mon} ${String(h).padStart(2, "0")}.${m} ${ap}`;
}

function normalizeCol(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = String(v).toUpperCase().match(/[A-Z]+/);
  return m ? m[0] : null;
}

function colLetterToIndex(letter: string): number {
  // "A" -> 0, "Z" -> 25, "AA" -> 26
  const s = letter.trim().toUpperCase();
  let n = 0;
  for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

async function getSheetsMeta(spreadsheetId: string) {
  const r = await fetch(`${GATEWAY}/spreadsheets/${spreadsheetId}`, { headers: gwHeaders });
  const j = await r.json();
  if (!r.ok) throw new Error(`getSheetsMeta failed [${r.status}]: ${JSON.stringify(j)}`);
  return j;
}

async function createTab(
  spreadsheetId: string,
  title: string,
  sourceSheetId: number | null,
  clearFromRow: number | null = null,
) {
  // If sourceSheetId provided, duplicate it (preserves header, formatting). Otherwise add blank.
  const body = sourceSheetId != null
    ? { requests: [{ duplicateSheet: { sourceSheetId, newSheetName: title, insertSheetIndex: 0 } }] }
    : { requests: [{ addSheet: { properties: { title, index: 0 } } }] };
  const r = await fetch(`${GATEWAY}/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: gwHeaders,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`createTab failed [${r.status}]: ${JSON.stringify(j)}`);

  // After cloning a template, wipe the data rows (keep header + opening balance rows).
  if (sourceSheetId != null && clearFromRow && clearFromRow > 0) {
    const newSheetId = j.replies?.[0]?.duplicateSheet?.properties?.sheetId;
    if (newSheetId != null) {
      const clearReq = {
        requests: [{
          updateCells: {
            range: {
              sheetId: newSheetId,
              startRowIndex: clearFromRow - 1, // 0-indexed
            },
            fields: "userEnteredValue",
          },
        }],
      };
      const cr = await fetch(`${GATEWAY}/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        headers: gwHeaders,
        body: JSON.stringify(clearReq),
      });
      if (!cr.ok) {
        const cj = await cr.json();
        console.warn("clear cloned data failed:", JSON.stringify(cj));
      }
    }
  }
  return j;
}


async function findFirstEmptyDataRow(
  spreadsheetId: string,
  tabName: string,
  dataStartRow: number,
  probeColLetter: string,
): Promise<number> {
  // Read the probe column from data_start_row downward; first blank cell = our row.
  const range = `'${tabName}'!${probeColLetter}${dataStartRow}:${probeColLetter}10000`;
  const r = await fetch(`${GATEWAY}/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: gwHeaders,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`probe failed [${r.status}]: ${JSON.stringify(j)}`);
  const values: string[][] = j.values || [];
  for (let i = 0; i < values.length; i++) {
    const cell = (values[i] && values[i][0]) ?? "";
    if (String(cell).trim() === "") return dataStartRow + i;
  }
  return dataStartRow + values.length;
}

async function writeRowCells(
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
  cells: { col: string; value: string | number }[],
) {
  if (cells.length === 0) return;
  // Build batchUpdate values payload — one range per cell so non-contiguous columns work.
  const data = cells.map((c) => ({
    range: `'${tabName}'!${normalizeCol(c.col)}${rowNumber}`,
    values: [[c.value]],
  }));
  const r = await fetch(
    `${GATEWAY}/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: "POST",
      headers: gwHeaders,
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
    },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(`writeRowCells failed [${r.status}]: ${JSON.stringify(j)}`);
}

// ---- core sync ----------------------------------------------------------------

async function syncOneTransaction(
  supabase: any,
  seller_transaction_id: string,
  dry_run = false,
): Promise<any> {
  // Already synced?
  const { data: existing } = await supabase
    .from("sheet_sync_log")
    .select("id, row_number, tab_name, status")
    .eq("seller_transaction_id", seller_transaction_id)
    .maybeSingle();
  if (existing && existing.status === "success") {
    return { ok: true, skipped: "already_synced", ...existing };
  }

  const { data: txn, error: txnErr } = await supabase
    .from("seller_transactions")
    .select("*")
    .eq("id", seller_transaction_id)
    .maybeSingle();
  if (txnErr || !txn) throw new Error(`txn not found: ${txnErr?.message}`);

  if ((txn.status || "approved") !== "approved") {
    return { ok: true, skipped: "not_approved" };
  }

  const { data: cfg, error: cfgErr } = await supabase
    .from("seller_sheet_config")
    .select("*")
    .eq("seller_id", txn.seller_id)
    .maybeSingle();
  if (cfgErr) throw new Error(`config lookup failed: ${cfgErr.message}`);
  if (!cfg || !cfg.enabled) return { ok: true, skipped: "no_config_or_disabled" };

  const txnDate = new Date(txn.created_at);
  const targetTab = formatTabName(cfg.tab_pattern || "{MMMM-YYYY}", txnDate);

  const meta = await getSheetsMeta(cfg.spreadsheet_id);
  const sheets = meta.sheets || [];
  const existingTab = sheets.find((s: any) => s.properties.title === targetTab);
  if (!existingTab) {
    const tmpl = cfg.template_tab
      ? sheets.find((s: any) => s.properties.title === cfg.template_tab)
      : null;
    await createTab(cfg.spreadsheet_id, targetTab, tmpl ? tmpl.properties.sheetId : null, cfg.data_start_row || 7);
  }

  const probeCol = normalizeCol(cfg.col_datetime || cfg.col_payment_bdt || cfg.col_payo_usd || "A") || "A";
  const rowNumber = await findFirstEmptyDataRow(
    cfg.spreadsheet_id, targetTab, cfg.data_start_row || 7, probeCol,
  );

  const cells: { col: string; value: string | number }[] = [];
  const push = (col: string | null, val: any) => {
    if (col && val !== undefined && val !== null && val !== "") {
      cells.push({ col, value: val });
    }
  };

  push(cfg.col_datetime, formatDateTimeBn(txnDate));
  const isPayment = txn.type === "bdt_payment" || txn.type === "client_topup" || txn.type === "tenant_payment";
  const isUsdt = txn.type === "usdt_received";
  const isWithdraw = txn.type === "withdraw";

  if (isPayment) {
    push(cfg.col_payment_bdt, Number(txn.bdt_amount || 0));
  } else if (isWithdraw) {
    if (cfg.col_withdraw) {
      push(cfg.col_withdraw, Math.abs(Number(txn.bdt_amount || 0)));
    } else {
      push(cfg.col_payment_bdt, -Math.abs(Number(txn.bdt_amount || 0)));
    }
  } else if (isUsdt) {
    push(cfg.col_payo_usd, Number(txn.usdt_amount || 0));
    push(cfg.col_payo_rate, Number(txn.rate || 0));
    const converted = Number(txn.usdt_amount || 0) * Number(txn.rate || 0);
    push(cfg.col_payo_bdt, Number(converted.toFixed(2)));
  }


  push(cfg.col_description, txn.description || "");
  push(cfg.col_proof_url, txn.proof_url || "");
  push(cfg.col_txn_id, txn.id);

  if (dry_run) return { ok: true, dry_run: true, targetTab, rowNumber, cells };

  await writeRowCells(cfg.spreadsheet_id, targetTab, rowNumber, cells);

  await supabase.from("sheet_sync_log").upsert({
    seller_transaction_id,
    spreadsheet_id: cfg.spreadsheet_id,
    tab_name: targetTab,
    row_number: rowNumber,
    status: "success",
    error_message: null,
    synced_at: new Date().toISOString(),
  }, { onConflict: "seller_transaction_id" });

  await supabase.from("seller_sheet_config")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", cfg.id);

  return { ok: true, tab: targetTab, row: rowNumber };
}

// ---- handler ----------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const jsonResp = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let bodyJson: any = {};
  try { bodyJson = await req.json(); } catch (_) { /* ignore */ }

  try {
    const { seller_transaction_id, dry_run, backfill, seller_id, months, limit, delete_tabs, set_opening_balance, recreate, ensure_month, prepare_next_month } = bodyJson;

    // Helper: compute opening balance for a given month from seller_monthly_balance_view.
    // Returns the closing_balance of the previous month, or 0 if none.
    async function autoOpeningBalance(sId: string, year: number, month1to12: number): Promise<number> {
      const monthStart = `${year}-${String(month1to12).padStart(2, "0")}-01`;
      const { data } = await supabase
        .from("seller_monthly_balance_view")
        .select("opening_balance, month_start")
        .eq("seller_id", sId)
        .eq("month_start", monthStart)
        .maybeSingle();
      if (data && data.opening_balance != null) return Number(data.opening_balance);
      // Fallback: take last available month <= monthStart-1 closing
      const { data: prev } = await supabase
        .from("seller_monthly_balance_view")
        .select("closing_balance, month_start")
        .eq("seller_id", sId)
        .lt("month_start", monthStart)
        .order("month_start", { ascending: false })
        .limit(1)
        .maybeSingle();
      return prev?.closing_balance != null ? Number(prev.closing_balance) : 0;
    }

    // Helper: ensure a month tab exists (clone template if missing) and write opening balance if cell configured.
    async function ensureMonthTab(sId: string, monthStr: string, openingValueOverride?: number) {
      if (!/^\d{4}-\d{2}$/.test(monthStr)) throw new Error("month must be YYYY-MM");
      const { data: cfg } = await supabase
        .from("seller_sheet_config").select("*").eq("seller_id", sId).maybeSingle();
      if (!cfg) throw new Error("config not found");
      const [y, mo] = monthStr.split("-").map(Number);
      const tabName = formatTabName(cfg.tab_pattern || "{MMMM-YYYY}", new Date(Date.UTC(y, mo - 1, 1)));

      const meta = await getSheetsMeta(cfg.spreadsheet_id);
      const sheets = meta.sheets || [];
      const exists = sheets.find((s: any) => s.properties.title === tabName);
      let createdNow = false;
      if (!exists) {
        const tmpl = cfg.template_tab
          ? sheets.find((s: any) => s.properties.title === cfg.template_tab) : null;
        if (!tmpl) throw new Error(`template_tab "${cfg.template_tab || ''}" not found in sheet — set Template tab first`);
        await createTab(cfg.spreadsheet_id, tabName, tmpl.properties.sheetId, cfg.data_start_row || 7);
        createdNow = true;
      }

      let openingWritten: number | null = null;
      if (cfg.opening_balance_cell) {
        const opening = openingValueOverride !== undefined
          ? Number(openingValueOverride)
          : await autoOpeningBalance(sId, y, mo);
        const cell = String(cfg.opening_balance_cell).toUpperCase();
        const range = `'${tabName}'!${cell}`;
        const r = await fetch(
          `${GATEWAY}/spreadsheets/${cfg.spreadsheet_id}/values/${range}?valueInputOption=USER_ENTERED`,
          { method: "PUT", headers: gwHeaders, body: JSON.stringify({ values: [[opening]] }) },
        );
        const j = await r.json();
        if (!r.ok) throw new Error(`opening balance write failed [${r.status}]: ${JSON.stringify(j)}`);
        openingWritten = opening;
      }
      return { tab: tabName, created: createdNow, opening_balance: openingWritten };
    }

    // ---- ENSURE MONTH TAB (manual) ----
    if (ensure_month) {
      if (!seller_id) throw new Error("seller_id required");
      const result = await ensureMonthTab(seller_id, ensure_month);
      return jsonResp({ ok: true, ...result });
    }

    // ---- PREPARE NEXT MONTH (cron-friendly: for all enabled sellers, or one) ----
    if (prepare_next_month) {
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const monthStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
      let q = supabase.from("seller_sheet_config").select("seller_id").eq("enabled", true);
      if (seller_id) q = q.eq("seller_id", seller_id);
      const { data: cfgs } = await q;
      const out: any[] = [];
      for (const c of cfgs || []) {
        try {
          const r = await ensureMonthTab(c.seller_id, monthStr);
          out.push({ seller_id: c.seller_id, ...r });
        } catch (e: any) {
          out.push({ seller_id: c.seller_id, error: e?.message || String(e) });
        }
      }
      return jsonResp({ ok: true, month: monthStr, results: out });
    }

    // ---- SET OPENING BALANCE for a specific month tab ----
    if (set_opening_balance) {
      if (!seller_id) throw new Error("seller_id required");
      const { month, value } = set_opening_balance; // month: "YYYY-MM", value?: number (auto if omitted)
      if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error("month required (YYYY-MM)");
      const override = (value === undefined || value === null || value === "") ? undefined : Number(value);
      if (override !== undefined && isNaN(override)) throw new Error("value must be a number");
      const result = await ensureMonthTab(seller_id, month, override);
      if (!result.opening_balance && result.opening_balance !== 0)
        throw new Error("opening_balance_cell not configured (e.g. I6) — set it in mapping and Save");
      return jsonResp({
        ok: true,
        tab: result.tab,
        cell: String((await supabase.from("seller_sheet_config").select("opening_balance_cell").eq("seller_id", seller_id).maybeSingle()).data?.opening_balance_cell || "").toUpperCase(),
        value: result.opening_balance,
        auto: override === undefined,
      });
    }



    // ---- BACKFILL MODE (optimized: 1 meta read + 1 probe per tab + 1 batch write per tab) ----
    if (backfill) {
      // Optional: delete specified tabs first (used to recreate from template)
      if (Array.isArray(delete_tabs) && delete_tabs.length > 0) {
        if (!seller_id) throw new Error("seller_id required");
        const { data: cfgPre } = await supabase
          .from("seller_sheet_config").select("spreadsheet_id").eq("seller_id", seller_id).maybeSingle();
        if (cfgPre?.spreadsheet_id) {
          const metaPre = await getSheetsMeta(cfgPre.spreadsheet_id);
          const reqs: any[] = [];
          for (const title of delete_tabs) {
            const sh = (metaPre.sheets || []).find((s: any) => s.properties.title === title);
            if (sh) reqs.push({ deleteSheet: { sheetId: sh.properties.sheetId } });
          }
          if (reqs.length > 0) {
            await fetch(`${GATEWAY}/spreadsheets/${cfgPre.spreadsheet_id}:batchUpdate`, {
              method: "POST", headers: gwHeaders,
              body: JSON.stringify({ requests: reqs }),
            });
          }
          // Also clear sync logs for those tabs so backfill re-syncs them
          await supabase.from("sheet_sync_log").delete().in("tab_name", delete_tabs);
        }
      }

      if (!seller_id) throw new Error("seller_id required for backfill");
      if (!Array.isArray(months) || months.length === 0)
        throw new Error("months[] required (e.g. ['2026-04','2026-05'])");

      // If recreate=true, derive tab names from months + config pattern, delete & reset logs.
      if (recreate) {
        const { data: cfgPre2 } = await supabase
          .from("seller_sheet_config").select("spreadsheet_id, tab_pattern")
          .eq("seller_id", seller_id).maybeSingle();
        if (cfgPre2?.spreadsheet_id) {
          const pattern = cfgPre2.tab_pattern || "{MMMM-YYYY}";
          const tabsToDelete = months.map((m: string) => {
            const [y, mo] = m.split("-").map(Number);
            return formatTabName(pattern, new Date(Date.UTC(y, mo - 1, 1)));
          });
          const metaPre2 = await getSheetsMeta(cfgPre2.spreadsheet_id);
          const reqs2: any[] = [];
          for (const title of tabsToDelete) {
            const sh = (metaPre2.sheets || []).find((s: any) => s.properties.title === title);
            if (sh) reqs2.push({ deleteSheet: { sheetId: sh.properties.sheetId } });
          }
          if (reqs2.length > 0) {
            await fetch(`${GATEWAY}/spreadsheets/${cfgPre2.spreadsheet_id}:batchUpdate`, {
              method: "POST", headers: gwHeaders,
              body: JSON.stringify({ requests: reqs2 }),
            });
          }
          await supabase.from("sheet_sync_log").delete().in("tab_name", tabsToDelete);
        }
      }

      // Load seller config
      const { data: cfg, error: cfgErr } = await supabase
        .from("seller_sheet_config")
        .select("*")
        .eq("seller_id", seller_id)
        .maybeSingle();
      if (cfgErr) throw new Error(`config: ${cfgErr.message}`);
      if (!cfg || !cfg.enabled) throw new Error("seller has no enabled sheet config");

      // Pull all approved txns in months (full row needed for mapping)
      let allTxns: any[] = [];
      for (const m of months) {
        const [y, mo] = m.split("-").map(Number);
        const start = new Date(Date.UTC(y, mo - 1, 1)).toISOString();
        const end = new Date(Date.UTC(y, mo, 1)).toISOString();
        const { data, error } = await supabase
          .from("seller_transactions")
          .select("*")
          .eq("seller_id", seller_id)
          .eq("status", "approved")
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: true });
        if (error) throw new Error(`txn fetch failed: ${error.message}`);
        if (data) allTxns = allTxns.concat(data);
      }

      // Skip already synced
      const ids = allTxns.map((t) => t.id);
      let doneSet = new Set<string>();
      if (ids.length > 0) {
        const { data: doneRows } = await supabase
          .from("sheet_sync_log")
          .select("seller_transaction_id")
          .in("seller_transaction_id", ids)
          .eq("status", "success");
        doneSet = new Set((doneRows || []).map((r: any) => r.seller_transaction_id));
      }
      const remaining = allTxns.filter((t) => !doneSet.has(t.id));

      // Group by target tab
      const tabPattern = cfg.tab_pattern || "{MMMM-YYYY}";
      const groups = new Map<string, any[]>();
      // Seed with every requested month so even empty months get a tab created.
      for (const m of months) {
        const [y, mo] = m.split("-").map(Number);
        const tab = formatTabName(tabPattern, new Date(Date.UTC(y, mo - 1, 1)));
        if (!groups.has(tab)) groups.set(tab, []);
      }
      for (const t of remaining) {
        const tab = formatTabName(tabPattern, new Date(t.created_at));
        if (!groups.has(tab)) groups.set(tab, []);
        groups.get(tab)!.push(t);
      }

      // 1 meta call
      const meta = await getSheetsMeta(cfg.spreadsheet_id);
      const sheets = meta.sheets || [];
      const titleSet = new Set(sheets.map((s: any) => s.properties.title));

      // Ensure all needed tabs exist (create missing ones, cloning template if set)
      // and write opening balance (auto-derived from monthly view) for each.
      const monthByTab = new Map<string, string>();
      for (const m of months) {
        const [y, mo] = m.split("-").map(Number);
        const tab = formatTabName(tabPattern, new Date(Date.UTC(y, mo - 1, 1)));
        monthByTab.set(tab, m);
      }
      for (const tab of groups.keys()) {
        if (!titleSet.has(tab)) {
          const tmpl = cfg.template_tab
            ? sheets.find((s: any) => s.properties.title === cfg.template_tab)
            : null;
          if (!tmpl) throw new Error(`template_tab "${cfg.template_tab || ''}" not found in sheet — set Template tab first`);
          await createTab(cfg.spreadsheet_id, tab, tmpl.properties.sheetId, cfg.data_start_row || 7);
          titleSet.add(tab);
        }
        // Auto write opening balance if cell configured and we know the month
        if (cfg.opening_balance_cell && monthByTab.has(tab)) {
          const m = monthByTab.get(tab)!;
          const [y, mo] = m.split("-").map(Number);
          const opening = await autoOpeningBalance(seller_id, y, mo);
          const cell = String(cfg.opening_balance_cell).toUpperCase();
          const range = `'${tab}'!${cell}`;
          await fetch(
            `${GATEWAY}/spreadsheets/${cfg.spreadsheet_id}/values/${range}?valueInputOption=USER_ENTERED`,
            { method: "PUT", headers: gwHeaders, body: JSON.stringify({ values: [[opening]] }) },
          );
        }
      }

      const probeCol = normalizeCol(cfg.col_datetime || cfg.col_payment_bdt || cfg.col_payo_usd || "A") || "A";
      const dataStart = cfg.data_start_row || 7;

      const buildCells = (txn: any) => {
        const txnDate = new Date(txn.created_at);
        const cells: { col: string; value: string | number }[] = [];
        const push = (col: string | null, val: any) => {
          if (col && val !== undefined && val !== null && val !== "") cells.push({ col, value: val });
        };
        push(cfg.col_datetime, formatDateTimeBn(txnDate));
        const isPayment = txn.type === "bdt_payment" || txn.type === "client_topup" || txn.type === "tenant_payment";
        const isUsdt = txn.type === "usdt_received";
        const isWithdraw = txn.type === "withdraw";
        if (isPayment) push(cfg.col_payment_bdt, Number(txn.bdt_amount || 0));
        else if (isWithdraw) {
          if (cfg.col_withdraw) push(cfg.col_withdraw, Math.abs(Number(txn.bdt_amount || 0)));
          else push(cfg.col_payment_bdt, -Math.abs(Number(txn.bdt_amount || 0)));
        }
        else if (isUsdt) {
          push(cfg.col_payo_usd, Number(txn.usdt_amount || 0));
          push(cfg.col_payo_rate, Number(txn.rate || 0));
          push(cfg.col_payo_bdt, Number((Number(txn.usdt_amount || 0) * Number(txn.rate || 0)).toFixed(2)));
        }
        push(cfg.col_description, txn.description || "");
        push(cfg.col_proof_url, txn.proof_url || "");
        push(cfg.col_txn_id, txn.id);
        return cells;
      };

      let totalRowsWritten = 0;
      const tabResults: any[] = [];

      for (const [tab, txns] of groups.entries()) {
        // 1 probe per tab
        const startRow = await findFirstEmptyDataRow(cfg.spreadsheet_id, tab, dataStart, probeCol);

        // Build batch data for all txns in this tab
        const data: any[] = [];
        const logRows: any[] = [];
        txns.forEach((t, i) => {
          const rowNumber = startRow + i;
          const cells = buildCells(t);
          for (const c of cells) {
            data.push({
              range: `'${tab}'!${normalizeCol(c.col)}${rowNumber}`,
              values: [[c.value]],
            });
          }
          logRows.push({
            seller_transaction_id: t.id,
            spreadsheet_id: cfg.spreadsheet_id,
            tab_name: tab,
            row_number: rowNumber,
            status: "success",
            error_message: null,
            synced_at: new Date().toISOString(),
          });
        });

        if (data.length > 0) {
          const r = await fetch(
            `${GATEWAY}/spreadsheets/${cfg.spreadsheet_id}/values:batchUpdate`,
            {
              method: "POST",
              headers: gwHeaders,
              body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
            },
          );
          const j = await r.json();
          if (!r.ok) throw new Error(`batchWrite failed [${r.status}]: ${JSON.stringify(j)}`);
        }

        // Log to sheet_sync_log in chunks
        if (logRows.length > 0) {
          await supabase.from("sheet_sync_log").upsert(logRows, { onConflict: "seller_transaction_id" });
        }
        totalRowsWritten += txns.length;
        tabResults.push({ tab, rows_written: txns.length, start_row: startRow });
      }

      await supabase.from("seller_sheet_config")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", cfg.id);

      return jsonResp({
        ok: true, backfill: true,
        total_in_months: allTxns.length,
        already_synced: doneSet.size,
        processed: totalRowsWritten,
        tabs: tabResults,
      });
    }

    if (!seller_transaction_id) throw new Error("seller_transaction_id required");
    const result = await syncOneTransaction(supabase, seller_transaction_id, !!dry_run);
    return jsonResp(result);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("sync-seller-to-sheet error:", msg);
    try {
      if (bodyJson?.seller_transaction_id) {
        await supabase.from("sheet_sync_log").upsert({
          seller_transaction_id: bodyJson.seller_transaction_id,
          spreadsheet_id: "unknown",
          tab_name: "unknown",
          status: "error",
          error_message: msg,
        }, { onConflict: "seller_transaction_id" });
      }
    } catch (_) { /* ignore */ }
    return jsonResp({ ok: false, error: msg }, 500);
  }
});
