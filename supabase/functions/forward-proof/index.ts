import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Compute single global Due/Advance running balance for a seller.
 * Positive = Advance, Negative = Due. Same formula as forward-seller-proof.
 *  +bdt_amount on bdt_payment / client_topup
 *  -bdt_amount on withdraw
 *  -(usdt_amount * rate) on usdt_received
 * Only approved entries count.
 */
function computeDueAdvance(txns: any[]): number {
  let running = 0;
  const sorted = [...(txns || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  for (const t of sorted) {
    if ((t.status || 'approved') !== 'approved') continue;
    if (t.type === 'bdt_payment' || t.type === 'client_topup') {
      running += Number(t.bdt_amount || 0);
    } else if (t.type === 'withdraw') {
      running -= Number(t.bdt_amount || 0);
    } else if (t.type === 'usdt_received') {
      running -= Number(t.usdt_amount || 0) * Number(t.rate || 0);
    }
  }
  return running;
}

function formatBdtIN(value: number): string {
  return Math.round(Math.abs(value)).toLocaleString('en-IN');
}

function buildTotalLine(balance: number): string {
  if (balance > 0) return `\n🟢 Total: Advance +৳${formatBdtIN(balance)}`;
  if (balance < 0) return `\n🔴 Total: Due −৳${formatBdtIN(balance)}`;
  return `\n⚪ Total: ৳0`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { request_id } = await req.json();
    if (!request_id) {
      return new Response(JSON.stringify({ error: 'request_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: reqData, error: reqErr } = await supabase
      .from('top_up_requests')
      .select('id, proof_url, bank_account_id, amount, bdt_amount, payment_reference, user_id')
      .eq('id', request_id)
      .single();
    if (reqErr || !reqData) {
      return new Response(JSON.stringify({ error: 'Request not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!reqData.proof_url) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_proof' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Bot token
    const { data: tokenRow } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'telegram_bot_token')
      .single();
    if (!tokenRow?.value) {
      return new Response(JSON.stringify({ error: 'Bot token not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve target group + sellerId from bank account in one fetch
    let targetGroupId = '';
    let sellerId: string | null = null;
    if (reqData.bank_account_id) {
      const { data: bankData } = await supabase
        .from('bank_accounts')
        .select('telegram_group_id, seller_id')
        .eq('id', reqData.bank_account_id)
        .single();
      if (bankData?.telegram_group_id) targetGroupId = bankData.telegram_group_id;
      if (bankData?.seller_id) sellerId = bankData.seller_id;
    }
    if (!targetGroupId) {
      const { data: globalGroup } = await supabase
        .from('site_settings')
        .select('value')
        .eq('key', 'telegram_forward_group_id')
        .single();
      targetGroupId = globalGroup?.value || '';
    }
    if (!targetGroupId) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_group_id' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client display name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', reqData.user_id)
      .single();
    const clientName = profile?.full_name || profile?.email || reqData.user_id.slice(0, 8);

    // Global Due/Advance running balance for this seller (matches forward-seller-proof)
    let runningTotalLine = '';
    if (sellerId) {
      try {
        const { data: txns } = await supabase
          .from('seller_transactions')
          .select('type, bdt_amount, usdt_amount, rate, status, created_at')
          .eq('seller_id', sellerId);
        const balance = computeDueAdvance((txns as any[]) || []);
        runningTotalLine = buildTotalLine(balance);
      } catch (e) {
        console.error('Due/Advance compute failed:', e);
      }
    }

    const caption = `✅ <b>Approved Top-Up</b>\n👤 ${clientName}\n💰 $${reqData.amount} (৳${reqData.bdt_amount ? Number(reqData.bdt_amount).toLocaleString() : 'N/A'})\n🔖 Ref: ${reqData.payment_reference || 'N/A'}${runningTotalLine}`;

    const tgResp = await fetch(`https://api.telegram.org/bot${tokenRow.value}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetGroupId,
        photo: reqData.proof_url,
        caption,
        parse_mode: 'HTML',
      }),
    });
    const tgResult = await tgResp.json();
    if (!tgResult.ok) {
      console.error('Telegram forward error:', tgResult);
      return new Response(JSON.stringify({ error: tgResult.description || 'Telegram error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.log(`✅ Forwarded proof for ${request_id} to group ${targetGroupId}`);
    return new Response(JSON.stringify({ ok: true, message_id: tgResult.result?.message_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('forward-proof error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});