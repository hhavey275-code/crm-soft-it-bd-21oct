import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  computeDueAdvance,
  buildTotalLine,
  fetchAllSellerTxns,
  fetchForwardedBalanceMismatches,
  claimForwardSlot,
  completeForwardSlot,
  releaseForwardSlot,
} from '../_shared/seller-balance.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    // (Atomic dedupe via claim_forward_slot happens AFTER we resolve the
    // target group and BEFORE we actually POST to Telegram — so concurrent
    // invocations cannot both send the same message.)

    const { data: reqData, error: reqErr } = await supabase
      .from('top_up_requests')
      .select('id, proof_url, bank_account_id, amount, bdt_amount, payment_reference, user_id, created_at, status, reviewed_by')
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
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'no_bank_group_id' }), {
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

    // Ensure the approved top-up exists in seller_transactions BEFORE the
    // Telegram caption is built. This keeps Total aligned with the dashboard.
    let runningTotalLine = '';
    let finalBalance: number | null = null;
    if (sellerId) {
      try {
        const { data: existingMirror } = await supabase
          .from('seller_transactions')
          .select('id')
          .eq('top_up_request_id', request_id)
          .maybeSingle();
        if (!existingMirror) {
          const { error: mirrorErr } = await supabase.from('seller_transactions').insert({
            seller_id: sellerId,
            type: 'client_topup',
            bdt_amount: Number(reqData.bdt_amount || 0),
            usdt_amount: 0,
            rate: 0,
            description: `Client top-up approved — $${reqData.amount || 0}`,
            bank_account_id: reqData.bank_account_id,
            top_up_request_id: request_id,
            proof_url: reqData.proof_url,
            created_at: reqData.created_at,
            status: 'approved',
            reviewed_by: reqData.reviewed_by || null,
            reviewed_at: new Date().toISOString(),
            entry_by_name: clientName,
          });
          if (mirrorErr && !String(mirrorErr.message || '').toLowerCase().includes('duplicate')) {
            throw mirrorErr;
          }
        }
        const txns = await fetchAllSellerTxns(supabase, sellerId);
        const balance = computeDueAdvance(txns);
        if (!txns.some((t: any) => (t as any).top_up_request_id === request_id)) {
          console.warn('forward-proof balance mismatch: top-up mirror missing after upsert', { request_id, sellerId });
          await supabase.from('system_logs').insert({
            action: 'Telegram Balance Mismatch',
            details: `Top-up ${request_id} was not found in live seller_transactions while forwarding. Telegram used dashboard live balance.`,
          }).catch(() => {});
        }
        finalBalance = balance;
        runningTotalLine = buildTotalLine(balance);
        const mismatch = await fetchForwardedBalanceMismatches(supabase, sellerId);
        if (mismatch.pendingTopupCount > 0) {
          console.warn('forward-proof balance probe: pending/unmirrored topups excluded to match dashboard', mismatch);
        }
      } catch (e) {
        console.error('Due/Advance compute failed:', e);
      }
    }

    const caption = `✅ <b>Approved Top-Up</b>\n👤 ${clientName}\n💰 $${reqData.amount} (৳${reqData.bdt_amount ? Number(reqData.bdt_amount).toLocaleString() : 'N/A'})\n🔖 Ref: ${reqData.payment_reference || 'N/A'}${runningTotalLine}`;

    // ATOMIC CLAIM — race-safe: only the first concurrent caller wins this slot.
    const claimed = await claimForwardSlot(supabase, 'client_topup', request_id, targetGroupId);
    if (!claimed) {
      console.log(`forward-proof: slot already claimed for ${request_id}, skipping`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: 'already_claimed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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
      // Release the slot so a manual retry can resend.
      await releaseForwardSlot(supabase, 'client_topup', request_id);
      return new Response(JSON.stringify({ error: tgResult.description || 'Telegram error' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await completeForwardSlot(
      supabase,
      'client_topup',
      request_id,
      tgResult.result?.message_id ?? null,
      finalBalance,
    );
    try {
      await supabase
        .from('top_up_requests')
        .update({ telegram_forwarded: true })
        .eq('id', request_id);
    } catch (e) {
      console.warn('top_up_requests flag update failed:', (e as any)?.message);
    }
    console.log(`✅ Forwarded proof for ${request_id} to group ${targetGroupId} (msg ${tgResult.result?.message_id})`);
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
