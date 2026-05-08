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

  // 2) Find pending requests submitted within last 24h (anything older is stale).
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

  const ms = Date.now() - started;
  console.log(`[auto-verify-pending] checked=${checked} approved=${approved} ms=${ms} ${log.join(' | ')}`);

  return new Response(
    JSON.stringify({ ok: true, checked, approved, ms, log }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
