import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function pickPayload(update: any) {
  return update?.message || update?.edited_message || update?.channel_post || update?.edited_channel_post || null;
}

function payloadText(payload: any) {
  return String(payload?.text || payload?.caption || '');
}

async function telegramCall(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body?.limit || 100), 100);
  const log: string[] = [];

  try {
    const { data: tokenRow } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'telegram_bot_token')
      .maybeSingle();
    const token = tokenRow?.value;
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: 'telegram_bot_token not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only poll when there is a pending top-up or tenant payment.
    // No periodic cron — DB triggers fire on insert with {quick:true}, then
    // this function self-loops every ~10s while pending rows still exist.
    // Window: last 60 minutes (older requests are stale and shouldn't keep polling).
    const PENDING_WINDOW_MIN = 60;
    const sinceIso = new Date(Date.now() - PENDING_WINDOW_MIN * 60 * 1000).toISOString();
    const [{ count: topupPending }, { count: tenantPending }] = await Promise.all([
      supabase.from('top_up_requests').select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'hold']).gte('created_at', sinceIso),
      supabase.from('tenant_payments').select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'hold']).gte('created_at', sinceIso),
    ]);
    if ((topupPending || 0) === 0 && (tenantPending || 0) === 0) {
      await supabase.from('telegram_bot_state').upsert({
        id: 1,
        updated_at: new Date().toISOString(),
      });
      console.log('[telegram-poll] stop: no pending in last 60 min');
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_pending' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: state } = await supabase
      .from('telegram_bot_state')
      .select('update_offset')
      .eq('id', 1)
      .maybeSingle();
    const offset = Number(state?.update_offset || 0);
    log.push(`offset=${offset || 'none'}`);

    let tg = await telegramCall(token, 'getUpdates', {
      offset: offset || undefined,
      limit,
      timeout: 0,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
    });

    if (!tg.res.ok && tg.res.status === 409) {
      log.push('webhook conflict — deleting webhook and retrying polling');
      await telegramCall(token, 'deleteWebhook', { drop_pending_updates: false });
      tg = await telegramCall(token, 'getUpdates', {
        offset: offset || undefined,
        limit,
        timeout: 0,
        allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
      });
    }

    if (!tg.res.ok || tg.json?.ok !== true) {
      await supabase.from('telegram_bot_state').upsert({ id: 1, update_offset: offset || 0, updated_at: new Date().toISOString() });
      return new Response(JSON.stringify({ ok: false, error: tg.json?.description || `telegram ${tg.res.status}`, log }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const updates = Array.isArray(tg.json?.result) ? tg.json.result : [];
    let maxNextOffset = offset || 0;
    let inserted = 0;
    let skippedNoText = 0;

    for (const update of updates) {
      const updateId = Number(update?.update_id);
      if (Number.isFinite(updateId)) maxNextOffset = Math.max(maxNextOffset, updateId + 1);
      const payload = pickPayload(update);
      const chatId = payload?.chat?.id;
      const text = payloadText(payload);
      if (!updateId || !chatId || !text.trim()) {
        skippedNoText++;
        continue;
      }
      const createdAt = payload?.date ? new Date(Number(payload.date) * 1000).toISOString() : new Date().toISOString();
      const { error } = await supabase.from('telegram_messages').upsert({
        update_id: updateId,
        chat_id: chatId,
        text,
        raw_update: update,
        created_at: createdAt,
      }, { onConflict: 'update_id', ignoreDuplicates: true });
      if (!error) inserted++;
      else log.push(`insert ${updateId}: ${error.message}`);
    }

    await supabase.from('telegram_bot_state').upsert({
      id: 1,
      update_offset: maxNextOffset,
      updated_at: new Date().toISOString(),
    });

    let autoVerified = 0;
    let tenantAutoVerified = 0;
    if (body?.autoVerify !== false) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: pendingTopups } = await supabase
        .from('top_up_requests')
        .select('id')
        .in('status', ['pending', 'hold'])
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(50);
      for (const row of pendingTopups || []) {
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/verify-topup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ request_id: row.id }),
          });
          const j = await r.json().catch(() => ({}));
          if (j?.auto_approved) autoVerified++;
        } catch (e: any) {
          log.push(`verify topup ${row.id}: ${e?.message || e}`);
        }
      }

      const { data: tenantPayments } = await supabase
        .from('tenant_payments')
        .select('id, tenants(api_key)')
        .in('status', ['pending', 'hold'])
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .limit(50);
      for (const row of tenantPayments || []) {
        const tenantKey = (row as any)?.tenants?.api_key;
        if (!tenantKey) continue;
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/tenant-webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Tenant-Key': String(tenantKey) },
            body: JSON.stringify({ action: 'verify-tenant-payment', payment_id: (row as any).id }),
          });
          const j = await r.json().catch(() => ({}));
          if (j?.auto_approved) tenantAutoVerified++;
        } catch (e: any) {
          log.push(`verify tenant ${(row as any).id}: ${e?.message || e}`);
        }
      }
    }

    // Self-loop: if pending still exists after this pass, schedule another run
    // (without blocking the response). Bank SMS often arrives 2–10 min after the
    // client submits, so keep checking for ~20 min: every 10s for the first
    // 2 min, then every 20s. New pending rows fire fresh chains via DB trigger.
    const hop = Number(body?.hop || 0);
    const MAX_HOPS = 66;
    const HOP_DELAY_MS = hop < 12 ? 10_000 : 20_000;
    let scheduledNext = false;
    try {
      const [{ count: topupStill }, { count: tenantStill }] = await Promise.all([
        supabase.from('top_up_requests').select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'hold']).gte('created_at', sinceIso),
        supabase.from('tenant_payments').select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'hold']).gte('created_at', sinceIso),
      ]);
      if (((topupStill || 0) > 0 || (tenantStill || 0) > 0) && hop < MAX_HOPS) {
        scheduledNext = true;
        // Fire-and-forget after delay; don't await.
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        setTimeout(() => {
          fetch(`${supabaseUrl}/functions/v1/telegram-poll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
            body: JSON.stringify({ hop: hop + 1 }),
          }).catch((e) => console.error('[telegram-poll] reschedule failed:', e?.message || e));
        }, HOP_DELAY_MS);
      }
    } catch (e: any) {
      log.push(`reschedule check err: ${e?.message || e}`);
    }

    console.log(`[telegram-poll] ok hop=${hop} updates=${updates.length} inserted=${inserted} skipped=${skippedNoText} topup_auto=${autoVerified} tenant_auto=${tenantAutoVerified} next=${scheduledNext}`);
    return new Response(JSON.stringify({
      ok: true,
      hop,
      scheduled_next: scheduledNext,
      updates: updates.length,
      processed: inserted,
      inserted,
      skipped_no_text: skippedNoText,
      update_offset: maxNextOffset,
      auto_verified: autoVerified,
      tenant_auto_verified: tenantAutoVerified,
      ms: Date.now() - started,
      log,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('telegram-poll error:', e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'telegram poll failed', log }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});