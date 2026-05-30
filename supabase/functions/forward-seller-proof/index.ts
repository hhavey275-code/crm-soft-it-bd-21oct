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
      force_resend,
    } = await req.json();

    // Withdraw and usdt_received can be text-only (no proof). bdt_payment still needs proof.
    if (!proof_url && payment_kind !== 'withdraw' && payment_kind !== 'usdt_received') {
      return new Response(JSON.stringify({ error: 'proof_url required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    // HARD ALLOWLIST: payment_kind must be one of the seller-side kinds.
    // client_topup (and anything else) MUST go through forward-proof, never
    // this function — otherwise we'd claim a different source_type slot and
    // produce a DUPLICATE Telegram message for the same proof.
    const ALLOWED_KINDS = new Set(['bdt_payment', 'usdt_received', 'withdraw']);
    if (!ALLOWED_KINDS.has(payment_kind)) {
      console.error('forward-seller-proof: REJECTED — invalid payment_kind', { payment_kind, seller_transaction_id });
      try {
        await supabase.from('system_logs').insert({
          action: 'Telegram Forward Rejected',
          details: `forward-seller-proof called with disallowed payment_kind=${payment_kind || 'null'} (txn=${seller_transaction_id || 'unknown'}). Only bdt_payment / usdt_received / withdraw are allowed; client_topup must use forward-proof.`,
        });
      } catch { /* best-effort */ }
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: 'invalid_payment_kind' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Source-type for the telegram_forward_log table (atomic dedupe happens
    // RIGHT BEFORE the Telegram POST below — not here — so concurrent invocations
    // can't both pass an early read-then-act check).
    const sourceTypeMap: Record<string, string> = {
      bdt_payment: 'seller_payment',
      usdt_received: 'usdt_received',
      withdraw: 'withdraw',
    };
    const sourceType = sourceTypeMap[payment_kind];

    // STRICT: seller_transaction_id is REQUIRED. Without it the atomic
    // claim_forward_slot dedupe below cannot run, and concurrent invocations
    // produce duplicate Telegram messages (root cause of repeated double-forward
    // bugs whenever a caller is refactored). Reject loudly so the caller is
    // forced to pass the id — never silently send unguarded.
    if (!seller_transaction_id) {
      console.error('forward-seller-proof: REJECTED — missing seller_transaction_id', { payment_kind, seller_id, bdt_amount });
      try {
        await supabase.from('system_logs').insert({
          action: 'Telegram Forward Rejected',
          details: `forward-seller-proof called without seller_transaction_id (payment_kind=${payment_kind || 'unknown'}, seller=${seller_id || 'unknown'}, bdt=${bdt_amount || 0}). Caller must pass the row id so dedupe works.`,
        });
      } catch { /* best-effort */ }
      return new Response(
        JSON.stringify({ error: 'seller_transaction_id is required for dedupe', skipped: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Cheap early bail-out via the legacy mirror flag (saves work when we can
    // tell upfront the row was already forwarded). Authoritative dedupe is
    // still the atomic claim_forward_slot below.
    {
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
        // Source of truth = live seller_transactions (matches dashboard + sheet).
        // Race window: row may not be visible yet. Retry briefly instead of
        // manually adding bdt_amount (the old fallback double-counted when the
        // row WAS already there but our `id` lookup raced).
        let txns = await fetchAllSellerTxns(supabase, resolvedSellerId);
        let alreadyInLedger = txns.some((t: any) => t.id === seller_transaction_id);
        for (let i = 0; i < 3 && !alreadyInLedger; i++) {
          await new Promise((r) => setTimeout(r, 300));
          txns = await fetchAllSellerTxns(supabase, resolvedSellerId);
          alreadyInLedger = txns.some((t: any) => t.id === seller_transaction_id);
        }
        if (!alreadyInLedger) {
          console.warn('forward-seller-proof: txn still missing from ledger after retries — using dashboard balance as-is (no manual add to avoid double-count)', {
            seller_transaction_id, resolvedSellerId, payment_kind,
          });
          try {
            await supabase.from('system_logs').insert({
              action: 'Telegram Balance Mismatch',
              details: `Seller txn ${seller_transaction_id} not found in live seller_transactions while forwarding (after 3 retries). Caption Total uses dashboard balance.`,
            });
          } catch { /* best-effort */ }
        }
        finalBalance = computeDueAdvance(txns);
        runningTotalLine = buildTotalLine(finalBalance);
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
      caption = `🔻 <b>USDT Given</b>\n👤 ${resolvedSellerName || 'Unknown'}`;
      if (bank_account_id) caption += `\n🏦 ${bankName} — ${accountNumber}`;
      if (otherAccountHolderName) caption += `\n📛 ${otherAccountHolderName}`;
      caption += `\n💲 USDT: ${usdt.toLocaleString()}`;
      caption += `\n📈 Rate: ৳${r.toLocaleString()}`;
      caption += `\n💰 BDT: ৳${formatBdtIN(converted)}`;
      caption += `\n🔖 Ref: ${reference || 'N/A'}${runningTotalLine}`;
    } else if (payment_kind === 'withdraw') {
      const w = Number(bdt_amount || 0);
      caption = `🔻 <b>Withdraw</b>\n👤 ${resolvedSellerName || 'Unknown'}`;
      if (bank_account_id) caption += `\n🏦 ${bankName} — ${accountNumber}`;
      caption += `\n💰 ৳${formatBdtIN(w)}`;
      if (withdraw_note) caption += `\n📝 ${withdraw_note}`;
      if (reference) caption += `\n🔖 Ref: ${reference}`;
      caption += runningTotalLine;
    } else {
      caption = `💰 <b>Seller Payment</b>\n👤 ${resolvedSellerName || 'Unknown'}\n🏦 ${bankName} — ${accountNumber}`;
      if (otherAccountHolderName) caption += `\n📛 ${otherAccountHolderName}`;
      caption += `\n৳${bdt_amount ? Number(bdt_amount).toLocaleString() : 'N/A'}\n🔖 Ref: ${reference || 'N/A'}${runningTotalLine}`;
    }

    // ATOMIC CLAIM — race-safe: if seller_transaction_id is provided, only the
    // first concurrent caller wins the slot. Without an id we fall through (legacy
    // callers without a row id — extremely rare).
    if (seller_transaction_id) {
      if (force_resend) {
        try {
          await supabase
            .from('telegram_forward_log')
            .delete()
            .eq('source_type', sourceType)
            .eq('source_id', seller_transaction_id);
          await supabase
            .from('seller_transactions')
            .update({ telegram_forwarded: null })
            .eq('id', seller_transaction_id);
        } catch (e) {
          console.warn('force_resend slot delete failed:', (e as any)?.message);
        }
      }
      const claimed = await claimForwardSlot(supabase, sourceType, seller_transaction_id, groupId);

      if (!claimed) {
        // Slot already exists. STRICT no-resend policy — never auto-release
        // and re-claim, because that path produced duplicate Telegram sends
        // when two invocations raced (the loser would release the winner's
        // in-flight slot and resend). If the slot is stuck without a
        // message_id, an admin must explicitly clear it via the manual
        // "Resend" tool, which deletes the row first.
        const { data: slot } = await supabase
          .from('telegram_forward_log')
          .select('telegram_message_id')
          .eq('source_type', sourceType)
          .eq('source_id', seller_transaction_id)
          .maybeSingle();
        if (slot?.telegram_message_id) {
          try {
            await supabase
              .from('seller_transactions')
              .update({
                telegram_forwarded: true,
                telegram_message_id: slot.telegram_message_id,
                telegram_forwarded_at: new Date().toISOString(),
              })
              .eq('id', seller_transaction_id)
              .or('telegram_forwarded.is.null,telegram_forwarded.eq.false');
          } catch (e) {
            console.warn('self-heal flag update failed:', (e as any)?.message);
          }
          return new Response(
            JSON.stringify({ ok: true, skipped: true, reason: 'already_forwarded', message_id: slot.telegram_message_id, healed: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
        console.log(`forward-seller-proof: slot already claimed for ${seller_transaction_id}, skipping (strict dedupe)`);
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: 'already_claimed_strict' }),
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
      // IMPORTANT: do NOT release the slot here — Telegram has seen this
      // request. Releasing causes parallel/cron callers to re-send and
      // produces duplicate messages. Leave slot claimed; admin can manually
      // retry via { force_resend: true }.
      return new Response(JSON.stringify({ error: tgResult.description || 'Telegram error', slot_locked: true }), {
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
