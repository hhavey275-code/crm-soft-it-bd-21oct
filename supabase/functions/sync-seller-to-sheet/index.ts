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

async function createTab(spreadsheetId: string, title: string, sourceSheetId: number | null) {
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
    range: `'${tabName}'!${c.col.toUpperCase()}${rowNumber}`,
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

// ---- handler ----------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { seller_transaction_id, dry_run } = await req.json();
    if (!seller_transaction_id) throw new Error("seller_transaction_id required");

    // Already synced?
    const { data: existing } = await supabase
      .from("sheet_sync_log")
      .select("id, row_number, tab_name, status")
      .eq("seller_transaction_id", seller_transaction_id)
      .maybeSingle();
    if (existing && existing.status === "success") {
      return new Response(JSON.stringify({ ok: true, skipped: "already_synced", ...existing }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load txn
    const { data: txn, error: txnErr } = await supabase
      .from("seller_transactions")
      .select("*")
      .eq("id", seller_transaction_id)
      .maybeSingle();
    if (txnErr || !txn) throw new Error(`txn not found: ${txnErr?.message}`);

    // Only sync approved txns
    if ((txn.status || "approved") !== "approved") {
      return new Response(JSON.stringify({ ok: true, skipped: "not_approved" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load seller config
    const { data: cfg, error: cfgErr } = await supabase
      .from("seller_sheet_config")
      .select("*")
      .eq("seller_id", txn.seller_id)
      .maybeSingle();
    if (cfgErr) throw new Error(`config lookup failed: ${cfgErr.message}`);
    if (!cfg || !cfg.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_config_or_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine target tab name
    const txnDate = new Date(txn.created_at);
    const targetTab = formatTabName(cfg.tab_pattern || "{MMMM-YYYY}", txnDate);

    // Ensure tab exists
    const meta = await getSheetsMeta(cfg.spreadsheet_id);
    const sheets = meta.sheets || [];
    const existingTab = sheets.find((s: any) => s.properties.title === targetTab);
    if (!existingTab) {
      const tmpl = cfg.template_tab
        ? sheets.find((s: any) => s.properties.title === cfg.template_tab)
        : null;
      await createTab(cfg.spreadsheet_id, targetTab, tmpl ? tmpl.properties.sheetId : null);
    }

    // Pick a probe column for finding next empty row — prefer date col, fallback to payment, else A
    const probeCol = (cfg.col_datetime || cfg.col_payment_bdt || cfg.col_payo_usd || "A").toUpperCase();
    const rowNumber = await findFirstEmptyDataRow(
      cfg.spreadsheet_id,
      targetTab,
      cfg.data_start_row || 7,
      probeCol,
    );

    // Build cells based on mapping + txn type
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
      // Withdraw shown as negative in Payment column
      push(cfg.col_payment_bdt, -Math.abs(Number(txn.bdt_amount || 0)));
    } else if (isUsdt) {
      // USDT given — populate Payo columns
      push(cfg.col_payo_usd, Number(txn.usdt_amount || 0));
      push(cfg.col_payo_rate, Number(txn.rate || 0));
      const converted = Number(txn.usdt_amount || 0) * Number(txn.rate || 0);
      push(cfg.col_payo_bdt, Number(converted.toFixed(2)));
    }

    push(cfg.col_description, txn.description || "");
    push(cfg.col_proof_url, txn.proof_url || "");
    push(cfg.col_txn_id, txn.id);

    if (dry_run) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, targetTab, rowNumber, cells }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await writeRowCells(cfg.spreadsheet_id, targetTab, rowNumber, cells);

    // Log success
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

    return new Response(JSON.stringify({ ok: true, tab: targetTab, row: rowNumber }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("sync-seller-to-sheet error:", msg);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body?.seller_transaction_id) {
        await supabase.from("sheet_sync_log").upsert({
          seller_transaction_id: body.seller_transaction_id,
          spreadsheet_id: "unknown",
          tab_name: "unknown",
          status: "error",
          error_message: msg,
        }, { onConflict: "seller_transaction_id" });
      }
    } catch (_) { /* ignore logging error */ }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
