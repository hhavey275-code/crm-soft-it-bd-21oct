import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  computeDueAdvance,
  buildTotalLine,
  formatBdtIN,
  fetchAllSellerTxns,
  fetchForwardedBalanceMismatches,
  claimForwardSlot,
  completeForwardSlot,
  releaseForwardSlot,
} from '../_shared/seller-balance.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
      seller_transaction_id,
      payment_kind, // 'bdt_payment' | 'usdt_received' | 'withdraw'
      usdt_amount,
      rate,
      withdraw_note,
    } = await req.json();

    // Withdraw and usdt_received can be text-only (no proof). bdt_payment still needs proof.
    if (!proof_url && payment_kind !== 'withdraw' && payment_kind !== 'usdt_received') {
      return new Response(JSON.stringify({ error: 'proof_url required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Source-type for the telegram_forward_log table (atomic dedupe happens
    // RIGHT BEFORE the Telegram POST below — not here — so concurrent invocations
    // can't both pass an early read-then-act check).
    const sourceTypeMap: Record<string, string> = {
      bdt_payment: 'seller_payment',
      usdt_received: 'usdt_received',
      withdraw: 'withdraw',
    };
    const sourceType = sourceTypeMap[payment_kind] || 'seller_payment';

    // Cheap early bail-out via the legacy mirror flag (saves work when we can
    // tell upfront the row was already forwarded). Authoritative dedupe is
    // still the atomic claim_forward_slot below.
    if (seller_transaction_id) {
      const { data: existing } = await supabase
        .from('seller_transactions')
        .select('telegram_forwarded, telegram_message_id')
        .eq('id', seller_transaction_id)
        .maybeSingle();
      if (existing?.telegram_forwarded) {
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: 'already_forwarded_flag', message_id: existing.telegram_message_id }),
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
    let resolvedSellerName: string | null = seller_name || null;

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

    // For withdraw with no bank, fall back to seller's primary group via any of their bank accounts.
    if (!groupId && resolvedSellerId) {
      const { data: anyBank } = await supabase
        .from('bank_accounts')
        .select('telegram_group_id')
        .eq('seller_id', resolvedSellerId)
        .not('telegram_group_id', 'is', null)
        .limit(1)
        .maybeSingle();
      if (anyBank?.telegram_group_id) groupId = anyBank.telegram_group_id;
    }

    if (!groupId) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_group_id' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve seller name from profiles when not supplied (e.g., DB trigger path)
    if (!resolvedSellerName && resolvedSellerId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('user_id', resolvedSellerId)
        .maybeSingle();
      resolvedSellerName = prof?.full_name || prof?.email || null;
    }

    // Build Due/Advance running total from live seller_transactions only — this
    // is the same source the dashboard uses, so Telegram Total cannot drift.
    let runningTotalLine = '';
    let finalBalance: number | null = null;
    if (resolvedSellerId) {
      try {
        const txns = await fetchAllSellerTxns(supabase, resolvedSellerId);
        let balance = computeDueAdvance(txns);

        const alreadyInLedger = seller_transaction_id
          ? txns.some((t: any) => (t as any).id === seller_transaction_id)
          : false;
        if (!alreadyInLedger) {
          console.warn('forward-seller-proof balance mismatch: txn missing from dashboard ledger', {
            seller_transaction_id,
            resolvedSellerId,
            payment_kind,
          });
          try {
            await supabase.from('system_logs').insert({
              action: 'Telegram Balance Mismatch',
              details: `Seller txn ${seller_transaction_id || 'unknown'} was not found in live seller_transactions while forwarding. Telegram used dashboard live balance before fallback.`,
            });
          } catch { /* best-effort log */ }
          if (payment_kind === 'usdt_received') {
            balance -= Number(usdt_amount || 0) * Number(rate || 0);
          } else if (payment_kind === 'withdraw') {
            balance -= Number(bdt_amount || 0);
          } else {
            balance += Number(bdt_amount || 0);
          }
        }
        finalBalance = balance;
        runningTotalLine = buildTotalLine(balance);
        const mismatch = await fetchForwardedBalanceMismatches(supabase, resolvedSellerId);
        if (mismatch.pendingTopupCount > 0) {
          console.warn('forward-seller-proof balance probe: pending/unmirrored topups excluded to match dashboard', mismatch);
        }
      } catch (e) {
        console.error('Due/Advance compute failed:', e);
      }
    }

    // Compose caption per kind
    let caption: string;
    if (payment_kind === 'usdt_received') {
      const usdt = Number(usdt_amount || 0);
      const r = Number(rate || 0);
      const converted = usdt * r;
      caption = `🔻 <b>USDT Given</b>\n👤 ${seller_name || 'Unknown'}`;
      if (bank_account_id) caption += `\n🏦 ${bankName} — ${accountNumber}`;
      if (otherAccountHolderName) caption += `\n📛 ${otherAccountHolderName}`;
      caption += `\n💲 USDT: ${usdt.toLocaleString()}`;
      caption += `\n📈 Rate: ৳${r.toLocaleString()}`;
      caption += `\n💰 BDT: ৳${formatBdtIN(converted)}`;
      caption += `\n🔖 Ref: ${reference || 'N/A'}${runningTotalLine}`;
    } else if (payment_kind === 'withdraw') {
      const w = Number(bdt_amount || 0);
      caption = `🔻 <b>Withdraw</b>\n👤 ${seller_name || 'Unknown'}`;
      if (bank_account_id) caption += `\n🏦 ${bankName} — ${accountNumber}`;
      caption += `\n💰 ৳${formatBdtIN(w)}`;
      if (withdraw_note) caption += `\n📝 ${withdraw_note}`;
      if (reference) caption += `\n🔖 Ref: ${reference}`;
      caption += runningTotalLine;
    } else {
      caption = `💰 <b>Seller Payment</b>\n👤 ${seller_name || 'Unknown'}\n🏦 ${bankName} — ${accountNumber}`;
      if (otherAccountHolderName) caption += `\n📛 ${otherAccountHolderName}`;
      caption += `\n৳${bdt_amount ? Number(bdt_amount).toLocaleString() : 'N/A'}\n🔖 Ref: ${reference || 'N/A'}${runningTotalLine}`;
    }

    // ATOMIC CLAIM — race-safe: if seller_transaction_id is provided, only the
    // first concurrent caller wins the slot. Without an id we fall through (legacy
    // callers without a row id — extremely rare).
    if (seller_transaction_id) {
      const claimed = await claimForwardSlot(supabase, sourceType, seller_transaction_id, groupId);
      if (!claimed) {
        console.log(`forward-seller-proof: slot already claimed for ${seller_transaction_id}, skipping`);
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: 'already_claimed' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Send: photo if proof, text-only otherwise
    let tgResult: any;
    if (proof_url) {
      const tgResp = await fetch(`https://api.telegram.org/bot${tokenRow.value}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: groupId, photo: proof_url, caption, parse_mode: 'HTML' }),
      });
      tgResult = await tgResp.json();
    } else {
      const tgResp = await fetch(`https://api.telegram.org/bot${tokenRow.value}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: groupId, text: caption, parse_mode: 'HTML' }),
      });
      tgResult = await tgResp.json();
    }

    if (!tgResult.ok) {
      console.error('Telegram forward error:', tgResult);
      // Release the slot so a manual retry can resend.
      if (seller_transaction_id) {
        await releaseForwardSlot(supabase, sourceType, seller_transaction_id);
      }
      return new Response(JSON.stringify({ error: tgResult.description || 'Telegram error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Persist message_id + balance into the previously-claimed row, plus mirror flag.
    if (seller_transaction_id) {
      await completeForwardSlot(
        supabase,
        sourceType,
        seller_transaction_id,
        tgResult.result?.message_id ?? null,
        finalBalance,
      );
      try {
        await supabase
          .from('seller_transactions')
          .update({
            telegram_forwarded: true,
            telegram_message_id: tgResult.result?.message_id || null,
            telegram_forwarded_at: new Date().toISOString(),
          })
          .eq('id', seller_transaction_id)
          .eq('telegram_forwarded', false);
      } catch (e) {
        console.error('Failed to mark seller_transaction as forwarded:', e);
      }
    }
    console.log(`✅ Forwarded ${payment_kind || 'bdt_payment'} to group ${groupId} (msg ${tgResult.result?.message_id})`);
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
