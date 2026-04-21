import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Compute single global Due/Advance running balance for a seller.
 * Positive = Advance (seller has received extra), Negative = Due (seller owes).
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const {
      proof_url,
      seller_name,
      seller_id,
      bdt_amount,
      bank_account_id,
      reference,
      others_telegram_group_id,
      bank_name: otherBankName,
      account_number: otherAccountNumber,
      account_holder_name: otherAccountHolderName,
    } = await req.json();

    if (!proof_url) {
      return new Response(JSON.stringify({ error: 'proof_url required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get bot token
    const { data: tokenRow } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'telegram_bot_token')
      .single();
    if (!tokenRow?.value) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_bot_token' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let groupId: string | null = null;
    let bankName = 'Unknown';
    let accountNumber = 'N/A';
    let resolvedSellerId: string | null = seller_id || null;

    if (bank_account_id) {
      const { data: bankData } = await supabase
        .from('bank_accounts')
        .select('bank_name, account_number, telegram_group_id, seller_id')
        .eq('id', bank_account_id)
        .single();
      groupId = bankData?.telegram_group_id || null;
      bankName = bankData?.bank_name || 'Unknown';
      accountNumber = bankData?.account_number || 'N/A';
      if (!resolvedSellerId && bankData?.seller_id) resolvedSellerId = bankData.seller_id;

      if (!groupId) {
        const { data: globalGroup } = await supabase
          .from('site_settings')
          .select('value')
          .eq('key', 'telegram_forward_group_id')
          .single();
        groupId = globalGroup?.value || null;
      }
    } else if (others_telegram_group_id) {
      groupId = others_telegram_group_id;
      bankName = otherBankName || 'Others Bank';
      accountNumber = otherAccountNumber || 'N/A';
    }

    if (!groupId) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_group_id' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build Due/Advance running total line for THIS seller (single global balance).
    let runningTotalLine = '';
    if (resolvedSellerId) {
      try {
        const { data: txns } = await supabase
          .from('seller_transactions')
          .select('type, bdt_amount, usdt_amount, rate, status, created_at')
          .eq('seller_id', resolvedSellerId);
        const balance = computeDueAdvance((txns as any[]) || []);
        if (balance > 0) {
          runningTotalLine = `\n🟢 Total: Advance +৳${formatBdtIN(balance)}`;
        } else if (balance < 0) {
          runningTotalLine = `\n🔴 Total: Due −৳${formatBdtIN(balance)}`;
        } else {
          runningTotalLine = `\n⚪ Total: ৳0`;
        }
      } catch (e) {
        console.error('Due/Advance compute failed:', e);
      }
    }

    let caption = `💰 <b>Seller Payment</b>\n👤 ${seller_name || 'Unknown'}\n🏦 ${bankName} — ${accountNumber}`;
    if (otherAccountHolderName) caption += `\n📛 ${otherAccountHolderName}`;
    caption += `\n৳${bdt_amount ? Number(bdt_amount).toLocaleString() : 'N/A'}\n🔖 Ref: ${reference || 'N/A'}${runningTotalLine}`;

    const tgResp = await fetch(`https://api.telegram.org/bot${tokenRow.value}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: groupId, photo: proof_url, caption, parse_mode: 'HTML' }),
    });
    const tgResult = await tgResp.json();

    if (!tgResult.ok) {
      console.error('Telegram forward error:', tgResult);
      return new Response(JSON.stringify({ error: tgResult.description || 'Telegram error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`✅ Forwarded seller proof to group ${groupId}`);
    return new Response(JSON.stringify({ ok: true, message_id: tgResult.result?.message_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('forward-seller-proof error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
