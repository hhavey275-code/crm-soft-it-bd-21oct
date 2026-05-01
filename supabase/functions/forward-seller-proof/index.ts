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
    if (t.type === 'bdt_payment' || t.type === 'client_topup' || t.type === 'tenant_payment') {
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
      // New (idempotency + USDT support)
      seller_transaction_id,
      payment_kind, // 'bdt_payment' | 'usdt_received'
      usdt_amount,
      rate,
    } = await req.json();

    if (!proof_url) {
      return new Response(JSON.stringify({ error: 'proof_url required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Idempotency lock: if a seller_transaction_id is provided and it's already
    // been forwarded, skip silently. Prevents duplicate Telegram messages on
    // retries, double clicks, or replays.
    if (seller_transaction_id) {
      const { data: existing } = await supabase
        .from('seller_transactions')
        .select('telegram_forwarded, telegram_message_id')
        .eq('id', seller_transaction_id)
        .maybeSingle();
      if (existing?.telegram_forwarded) {
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: 'already_forwarded', message_id: existing.telegram_message_id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
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
    // Include THIS pending bdt_payment as a credit so the forwarded total shows
    // what the seller's balance will be once admin approves the entry.
    let runningTotalLine = '';
    if (resolvedSellerId) {
      try {
        const { data: txns } = await supabase
          .from('seller_transactions')
          .select('type, bdt_amount, usdt_amount, rate, status, created_at')
          .eq('seller_id', resolvedSellerId);
        let balance = computeDueAdvance((txns as any[]) || []);
        // If the current transaction is already in the ledger (we received an id),
        // the running total already accounts for it — do NOT add again.
        // Otherwise, factor in the pending entry so the forwarded total reflects
        // what the balance WILL be once admin approves.
        if (!seller_transaction_id) {
          if (payment_kind === 'usdt_received') {
            balance -= Number(usdt_amount || 0) * Number(rate || 0);
          } else {
            balance += Number(bdt_amount || 0);
          }
        }
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

    let caption: string;
    if (payment_kind === 'usdt_received') {
      const usdt = Number(usdt_amount || 0);
      const r = Number(rate || 0);
      const converted = usdt * r;
      caption = `💵 <b>USDT Given (Approved)</b>\n👤 ${seller_name || 'Unknown'}\n🏦 ${bankName} — ${accountNumber}`;
      if (otherAccountHolderName) caption += `\n📛 ${otherAccountHolderName}`;
      caption += `\n💲 USDT: ${usdt.toLocaleString()}`;
      caption += `\n📈 Rate: ৳${r.toLocaleString()}`;
      caption += `\n💰 BDT: ৳${formatBdtIN(converted)}`;
      caption += `\n🔖 Ref: ${reference || 'N/A'}${runningTotalLine}`;
    } else {
      caption = `💰 <b>Seller Payment</b>\n👤 ${seller_name || 'Unknown'}\n🏦 ${bankName} — ${accountNumber}`;
      if (otherAccountHolderName) caption += `\n📛 ${otherAccountHolderName}`;
      caption += `\n৳${bdt_amount ? Number(bdt_amount).toLocaleString() : 'N/A'}\n🔖 Ref: ${reference || 'N/A'}${runningTotalLine}`;
    }

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

    // Mark as forwarded (idempotency lock) — best-effort.
    if (seller_transaction_id) {
      try {
        await supabase
          .from('seller_transactions')
          .update({
            telegram_forwarded: true,
            telegram_message_id: tgResult.result?.message_id || null,
            telegram_forwarded_at: new Date().toISOString(),
          })
          .eq('id', seller_transaction_id)
          .eq('telegram_forwarded', false); // double-safety against race
      } catch (e) {
        console.error('Failed to mark seller_transaction as forwarded:', e);
      }
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
