// Per-minute auto-verifier: pulls latest Telegram SMS, then runs verify-topup
// for every pending/hold top-up request so any newly-arrived SMS that matches
// will auto-approve immediately without requiring the user to re-submit.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const started = Date.now();
  const log: string[] = [];

  // 1) Pull latest Telegram updates first so the freshest SMS are in DB.
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/telegram-poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ quick: true }),
    });
    log.push(`telegram-poll: ${r.status}`);
  } catch (e: any) {
    log.push(`telegram-poll err: ${e?.message || e}`);
  }

  // 2) Find pending client requests submitted within last 24h (anything older is stale).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('top_up_requests')
    .select('id, status, created_at')
    .in('status', ['pending', 'hold'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message, log }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let approved = 0;
  let checked = 0;
  for (const row of rows || []) {
    checked++;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/verify-topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ request_id: row.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.auto_approved) approved++;
    } catch (e: any) {
      log.push(`verify ${row.id}: ${e?.message || e}`);
    }
  }

  // 3) Tenant payments use tenant-webhook auth, so verify them separately.
  const { data: tenantRows, error: tenantErr } = await supabase
    .from('tenant_payments')
    .select('id, status, created_at, tenants(api_key)')
    .in('status', ['pending', 'hold'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(50);

  let tenantApproved = 0;
  let tenantChecked = 0;
  if (tenantErr) {
    log.push(`tenant query err: ${tenantErr.message}`);
  } else {
    for (const row of tenantRows || []) {
      const tenantKey = (row as any)?.tenants?.api_key;
      if (!tenantKey) {
        log.push(`tenant verify ${row.id}: missing tenant api key`);
        continue;
      }
      tenantChecked++;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/tenant-webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Tenant-Key': String(tenantKey) },
          body: JSON.stringify({ action: 'verify-tenant-payment', payment_id: row.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.auto_approved) tenantApproved++;
        if (!res.ok) log.push(`tenant verify ${row.id}: ${res.status} ${json?.error || ''}`);
      } catch (e: any) {
        log.push(`tenant verify ${row.id}: ${e?.message || e}`);
      }
    }
  }

  // 4) SELF-HEAL: approved top-ups that never got a wallet credit.
  // A manual approval credits the wallet from the admin's browser, so a closed
  // tab / dropped connection could leave "approved but not credited". This
  // repairs them idempotently (credit_missing_approved_topup is a no-op when a
  // credit already exists).
  let healed = 0;
  try {
    const healSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: approvedRows } = await supabase
      .from('top_up_requests')
      .select('id, user_id, amount, created_at, sheet_bill_bdt, wallet_due_paid_bdt, main_deposit_bdt, secondary_due_bdt')
      .eq('status', 'approved')
      .gte('created_at', healSince)
      .lt('updated_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(200);

    for (const row of approvedRows || []) {
      // Skip split/bill-adjusted requests — their credit amount is not the raw amount.
      const split =
        Number(row.sheet_bill_bdt || 0) > 0 ||
        Number(row.wallet_due_paid_bdt || 0) > 0 ||
        Number(row.main_deposit_bdt || 0) > 0 ||
        Number(row.secondary_due_bdt || 0) > 0;
      if (split) continue;

      const { count } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('reference_id', row.id);
      if ((count || 0) > 0) continue;

      const { data: fix, error: fixErr } = await supabase.rpc('credit_missing_approved_topup', {
        p_request_id: row.id,
        p_processed_by: 'auto-heal:auto-verify-pending',
      });
      if (fixErr) {
        log.push(`heal ${row.id}: ${fixErr.message}`);
      } else if ((fix as any)?.success) {
        healed++;
        log.push(`healed ${row.id} ($${row.amount})`);
        await supabase.from('system_logs').insert({
          action: 'Top-Up Credit Auto-Repaired',
          details: `Approved top-up $${row.amount} had no wallet credit — credited automatically (request ${row.id})`,
        } as any);
      }
    }
  } catch (e: any) {
    log.push(`heal err: ${e?.message || e}`);
  }

  const ms = Date.now() - started;
  console.log(`[auto-verify-pending] checked=${checked} approved=${approved} healed=${healed} tenant_checked=${tenantChecked} tenant_approved=${tenantApproved} ms=${ms} ${log.join(' | ')}`);

  return new Response(
    JSON.stringify({ ok: true, checked, approved, healed, tenant_checked: tenantChecked, tenant_approved: tenantApproved, ms, log }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
