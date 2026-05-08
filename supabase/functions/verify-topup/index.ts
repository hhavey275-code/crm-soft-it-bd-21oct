import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runOcrWithFallback } from '../_shared/ocr-fallback.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const BDT_TOLERANCE = 15;
function amountMatches(a: number, b: number) {
  return Math.abs(a - b) <= BDT_TOLERANCE;
}

function refsMatch(a: string, b: string) {
  const clean = (value: string) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return !!clean(a) && clean(a) === clean(b);
}

function parseBdtAmount(value: string): number {
  return Number(value.replace(/,/g, ''));
}

function extractSmsCreditAmounts(text: string): number[] {
  const amounts = new Set<number>();
  const currencyRegex = /(?:tk\.?|bdt|৳)\s*([\d,]+(?:\.\d+)?)/gi;
  let match: RegExpExecArray | null;

  while ((match = currencyRegex.exec(text)) !== null) {
    const raw = match[1];
    const amount = parseBdtAmount(raw);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const start = match.index;
    const end = start + match[0].length;
    const before = text.slice(Math.max(0, start - 45), start).toLowerCase();
    const after = text.slice(end, end + 45).toLowerCase();
    const near = `${before} ${after}`;
    const immediateBefore = before.slice(-18);
    const immediateAfter = after.slice(0, 24);

    const looksLikeCredit = /(deposit|credited|credit|cash\s*out|received|transfer|successful)/i.test(near);
    const looksLikeFeeOrBalance = /(fee\s*$|charge\s*$|vat\s*$|balance\s*$|bal\s*$|c\/b\s*$|available\s*$|a\/c\s*bal\s*$)/i.test(immediateBefore)
      || /^(\s*(balance|bal|c\/b|available balance|a\/c bal|fee|charge|vat)\b)/i.test(immediateAfter);

    if (looksLikeCredit && !looksLikeFeeOrBalance) amounts.add(amount);
  }

  return [...amounts];
}

// Multi-provider OCR fallback: Lovable AI -> Gemini direct -> OpenAI direct.
// If Lovable credit/rate-limit fails, automatically falls back so verification keeps working.
async function callOcrWithFallback(prompt: string, imageUrl: string): Promise<string> {
  const providers: Array<{ name: string; fn: () => Promise<string> }> = [];

  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  if (lovableKey) {
    providers.push({
      name: 'lovable',
      fn: async () => {
        const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ] }],
          }),
        });
        if (!r.ok) throw new Error(`lovable ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const d = await r.json();
        return d?.choices?.[0]?.message?.content || '';
      },
    });
  }

  const geminiKey = Deno.env.get('USER_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY');
  if (geminiKey) {
    providers.push({
      name: 'gemini',
      fn: async () => {
        const imgResp = await fetch(imageUrl);
        if (!imgResp.ok) throw new Error(`fetch image ${imgResp.status}`);
        const mime = imgResp.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        const buf = new Uint8Array(await imgResp.arrayBuffer());
        let bin = ''; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        const b64 = btoa(bin);
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { text: prompt },
              { inline_data: { mime_type: mime, data: b64 } },
            ] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        });
        if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const d = await r.json();
        return d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') || '';
      },
    });
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (openaiKey) {
    providers.push({
      name: 'openai',
      fn: async () => {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ] }],
            response_format: { type: 'json_object' },
          }),
        });
        if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const d = await r.json();
        return d?.choices?.[0]?.message?.content || '';
      },
    });
  }

  let lastErr = '';
  for (const p of providers) {
    try {
      const out = await p.fn();
      if (out) {
        console.log(`[verify-topup OCR] provider=${p.name} ok`);
        return out;
      }
    } catch (e: any) {
      lastErr = `${p.name}: ${e?.message || e}`;
      console.warn(`[verify-topup OCR] ${lastErr}`);
    }
  }
  console.error('[verify-topup OCR] all providers failed:', lastErr);
  return '';
}

/**
 * Single global Due/Advance running balance for a seller.
 *  +bdt_amount on bdt_payment / client_topup
 *  -bdt_amount on withdraw
 *  -(usdt_amount * rate) on usdt_received
 * Only approved entries count. Same formula as forward-seller-proof.
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

async function forwardProofToTelegram(
  supabase: any,
  proofUrl: string,
  caption: string,
  bankAccountId: string | null,
) {
  try {
    const { data: botTokenSetting } = await supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'telegram_bot_token')
      .single();
    if (!botTokenSetting?.value) {
      console.log('Telegram forward skipped: bot token not configured');
      return false;
    }
    let targetGroupId = '';
    if (bankAccountId) {
      const { data: bankData } = await supabase
        .from('bank_accounts')
        .select('telegram_group_id')
        .eq('id', bankAccountId)
        .single();
      if (bankData?.telegram_group_id) targetGroupId = bankData.telegram_group_id;
    }
    if (!targetGroupId) {
      console.log('Telegram forward skipped: selected bank has no Telegram group ID. bankAccountId:', bankAccountId);
      return false;
    }
    const resp = await fetch(`https://api.telegram.org/bot${botTokenSetting.value}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetGroupId,
        photo: proofUrl,
        caption,
        parse_mode: 'HTML',
      }),
    });
    const result = await resp.json();
    console.log('Telegram forward result:', JSON.stringify(result));
    return result.ok === true;
  } catch (e) {
    console.error('Telegram forward failed (non-blocking):', e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token = authHeader.replace('Bearer ', '');
  if (token !== supabaseServiceKey) {
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await anonClient.auth.getUser(token);
    if (error || !data?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const svc = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleCheck } = await svc.rpc('has_role', { _user_id: data.user.id, _role: 'admin' });
    const { data: superCheck } = await svc.rpc('has_role', { _user_id: data.user.id, _role: 'superadmin' });
    if (!roleCheck && !superCheck) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // No hard requirement on LOVABLE_API_KEY — OCR uses fallback chain (Lovable → Gemini → OpenAI).
  const hasAnyAiKey = !!(Deno.env.get('LOVABLE_API_KEY') || Deno.env.get('USER_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY') || Deno.env.get('OPENAI_API_KEY'));
  if (!hasAnyAiKey) {
    return new Response(JSON.stringify({ error: 'No AI provider configured (LOVABLE_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY)' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { request_id } = await req.json();
    if (!request_id) throw new Error('request_id is required');

    const { data: request, error: reqErr } = await supabase
      .from('top_up_requests')
      .select('*')
      .eq('id', request_id)
      .single();
    if (reqErr || !request) throw new Error('Request not found');
    if (request.status !== 'pending' && request.status !== 'hold') {
      return new Response(JSON.stringify({ ok: true, message: 'Already processed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const isHold = request.status === 'hold';

    const { bdt_amount, bank_account_id, proof_url, user_id, amount, payment_method } = request;
    const payment_reference = (request.payment_reference || '').trim();

    // LOCKED: Hard requirement — no TXN ID, no auto-approval. Ever.
    if (!payment_reference) {
      return new Response(JSON.stringify({
        ok: true,
        auto_approved: false,
        reason: 'Missing transaction ID — manual review required',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const bdtNum = Number(bdt_amount);
    const verificationLog: string[] = [];
    const method = payment_method || 'bank_transfer';

    let bankLast4 = '';
    let bankFirst4 = '';
    let bankLast3 = '';
    let bankFirst3 = '';
    let fullBankAccount = '';
    let bankName = '';
    if (bank_account_id) {
      const { data: bank } = await supabase
        .from('bank_accounts')
        .select('account_number, bank_name')
        .eq('id', bank_account_id)
        .single();
      if (bank?.account_number) {
        fullBankAccount = bank.account_number.replace(/\s+/g, '');
        bankLast4 = fullBankAccount.slice(-4);
        bankFirst4 = fullBankAccount.slice(0, 4);
        bankLast3 = fullBankAccount.slice(-3);
        bankFirst3 = fullBankAccount.slice(0, 3);
      }
      if (bank?.bank_name) bankName = bank.bank_name.toLowerCase();
    }

    function accountMatches(ocrAccNum: string, bankAccNum: string, allowFirst3Last3 = false) {
      const ocr = ocrAccNum.replace(/\D/g, '');
      const bank = bankAccNum.replace(/\D/g, '');
      if (ocr === bank) return true;
      if (ocr.length >= 7 && bank.length >= 7) {
        const ocrFirst3 = ocr.slice(0, 3);
        const ocrLast4 = ocr.slice(-4);
        if (ocrFirst3 === bank.slice(0, 3) && ocrLast4 === bank.slice(-4)) return true;
      }
      // Narrow exception: only for mfs_to_bank — bKash/Nagad → Bank receipts often
      // hide last 4 digits but show last 3.
      if (allowFirst3Last3 && ocr.length >= 6 && bank.length >= 6) {
        if (ocr.slice(0, 3) === bank.slice(0, 3) && ocr.slice(-3) === bank.slice(-3)) return true;
      }
      return false;
    }

    const isMobileAgent = bankName.includes('bkash') || bankName.includes('nagad');
    const isMfsToBank = method === 'mfs_to_bank';

    let ocrRef = '';
    let ocrAmount = 0;
    let ocrRefMatch = false;
    let ocrAmountMatch = false;
    let ocrAccountMatch = false;
    let ocrAtmCredit = false;
    let ocrAccountNumber = '';
    if (proof_url) {
      try {
        if (method === 'bank_transfer' || method === 'mfs_to_bank' || method === 'npsb') {
          const { result } = await runOcrWithFallback(proof_url);
          ocrRef = String(result.reference || '').trim();
          ocrAmount = Number(result.bdt_amount || 0);
          ocrAccountNumber = String(result.account_number || '').trim();
        } else {
          let ocrPrompt = '';
          if (method === 'atm_deposit') {
          ocrPrompt =
            'Extract the following from this ATM deposit receipt screenshot: transaction reference number, deposit amount (in BDT), receiver/destination account number, date, and whether this is an "ATM Transfer Credit" transaction. Return ONLY a JSON object like: {"ref": "ABC123", "amount": 1300, "account_number": "1234567890", "date": "2025-01-15", "is_atm_credit": true}. If you cannot find a value, use empty string for strings, 0 for amount, and false for is_atm_credit. No explanation, just JSON.';
          } else if (method === 'cash_deposit') {
          ocrPrompt =
            'Extract the following from this cash deposit receipt screenshot: deposit amount (in BDT), receiver/destination account number, and date. Return ONLY a JSON object like: {"amount": 1300, "account_number": "1234567890", "date": "2025-01-15"}. If you cannot find a value, use empty string for strings and 0 for amount. No explanation, just JSON.';
          } else {
          ocrPrompt =
            'Extract the transaction reference number, the BASE payment amount (in BDT), and the receiver/destination account number from this payment screenshot. IMPORTANT: If the screenshot shows a breakdown like "৳1,300.00 + ৳16.25" or "amount + charge", extract ONLY the base amount (1300), NOT the total including charges/fees/VAT. The base amount is the actual money sent, excluding any service charge, VAT, or bank fee. For bank transfer screenshots, extract the transfer amount excluding service charge and VAT. Return ONLY a JSON object like: {"ref": "ABC123", "amount": 1300, "account_number": "1234567890"}. If you cannot find a value, use empty string for strings and 0 for amount. No explanation, just JSON.';
          }
          const content = await callOcrWithFallback(ocrPrompt, proof_url);
          if (content) {
            const jsonMatch = content.match(/\{[^}]+\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              ocrRef = String(parsed.ref || parsed.reference || '').trim();
              ocrAmount = Number(parsed.amount || parsed.bdt_amount || 0);
              ocrAccountNumber = String(parsed.account_number || '').trim();
              ocrAtmCredit = Boolean(parsed.is_atm_credit);
            }
          }
        }
      } catch (e) {
        console.error('OCR failed (non-blocking):', e);
      }
    }

    if (method === 'atm_deposit' || method === 'cash_deposit') {
      if (method === 'atm_deposit') {
        if (ocrRef && payment_reference) {
          ocrRefMatch = refsMatch(ocrRef, payment_reference);
          verificationLog.push(ocrRefMatch ? `✅ OCR Ref matched (${ocrRef})` : `❌ OCR Ref mismatch (${ocrRef} vs ${payment_reference})`);
        } else {
          verificationLog.push(`❌ OCR Ref missing`);
        }
        verificationLog.push(ocrAtmCredit ? `✅ ATM Transfer Credit confirmed` : `❌ ATM Transfer Credit NOT found`);
      }
      if (ocrAmount > 0 && bdtNum > 0) {
        ocrAmountMatch = amountMatches(ocrAmount, bdtNum);
        verificationLog.push(ocrAmountMatch ? `✅ OCR Amount matched (${ocrAmount} vs ${bdtNum})` : `❌ OCR Amount mismatch (${ocrAmount} vs ${bdtNum})`);
      } else {
        verificationLog.push(`❌ OCR Amount missing`);
      }
      if (ocrAccountNumber && fullBankAccount) {
        ocrAccountMatch = accountMatches(ocrAccountNumber, fullBankAccount);
        verificationLog.push(ocrAccountMatch ? `✅ OCR Account matched (${ocrAccountNumber} ~ ${bankFirst3}...${bankLast4})` : `❌ OCR Account mismatch (OCR: ${ocrAccountNumber} vs Bank: ${bankFirst3}...${bankLast4})`);
      } else {
        verificationLog.push(`❌ OCR Account missing`);
      }
    } else {
      if (ocrRef && payment_reference) {
        ocrRefMatch = refsMatch(ocrRef, payment_reference);
        verificationLog.push(ocrRefMatch ? `✅ OCR Ref matched (${ocrRef})` : `❌ OCR Ref mismatch (OCR: ${ocrRef} vs Submitted: ${payment_reference})`);
      } else {
        verificationLog.push(`❌ OCR Ref missing (OCR: "${ocrRef}", Submitted: "${payment_reference || ''}")`);
      }
      if (ocrAmount > 0 && bdtNum > 0) {
        ocrAmountMatch = amountMatches(ocrAmount, bdtNum);
        verificationLog.push(ocrAmountMatch ? `✅ OCR Amount matched (OCR: ৳${ocrAmount} vs Submitted: ৳${bdtNum}, diff: ৳${Math.abs(ocrAmount - bdtNum)})` : `❌ OCR Amount mismatch (OCR: ৳${ocrAmount} vs Submitted: ৳${bdtNum}, diff: ৳${Math.abs(ocrAmount - bdtNum)})`);
      } else {
        verificationLog.push(`❌ OCR Amount missing (OCR: ${ocrAmount}, Submitted: ${bdtNum})`);
      }
    }

    // Telegram SMS match window
    const requestTime = new Date(request.created_at);
    const useMobileAgentFlow = isMobileAgent && method === 'bank_transfer';
    const windowMinsBack = useMobileAgentFlow ? 360 : 120;
    const windowMinsForward = 30;
    const windowStart = new Date(requestTime.getTime() - windowMinsBack * 60 * 1000).toISOString();
    const windowEnd = new Date(requestTime.getTime() + windowMinsForward * 60 * 1000).toISOString();

    // Fetch ALL messages in the window (do NOT pre-filter by matched_request_id)
    // so the diagnostic log can show admins exactly which SMS arrived and why
    // each one was skipped — instead of misleading "messages checked: 0".
    const { data: telegramMsgs } = await supabase
      .from('telegram_messages')
      .select('text, raw_update, created_at, update_id, chat_id, matched_request_id')
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .order('created_at', { ascending: false })
      .limit(200);

    let telegramMatch = false;
    let telegramMatchDetail = '';
    let matchedMsg: any = null;
    let alreadyMatchedSkipped = 0;
    const perMsgReasons: string[] = [];
    if (telegramMsgs && bdtNum > 0) {
      for (const msg of telegramMsgs) {
        const raw = msg.raw_update || {};
        const payload = raw.message || raw.edited_message || raw.channel_post || raw.edited_channel_post || {};
        const text = msg.text || payload.text || payload.caption || '';
        const snippet = text.replace(/\s+/g, ' ').slice(0, 80);
        // Skip messages already consumed by another request (but log them for visibility)
        if (msg.matched_request_id && msg.matched_request_id !== request_id) {
          alreadyMatchedSkipped++;
          if (perMsgReasons.length < 5) {
            perMsgReasons.push(`⏭ already matched to other req: "${snippet}"`);
          }
          continue;
        }
        if (useMobileAgentFlow && payment_reference) {
          if (text.toLowerCase().includes(payment_reference.toLowerCase())) {
            telegramMatch = true;
            matchedMsg = msg;
            telegramMatchDetail = `trnxID: ${payment_reference} found in SMS`;
            break;
          } else if (perMsgReasons.length < 5) {
            perMsgReasons.push(`✗ trnxID "${payment_reference}" not in: "${snippet}"`);
          }
        } else {
          const digitsInText = text.replace(/[^\d]/g, '');
          const hasFullAccount = fullBankAccount && digitsInText.includes(fullBankAccount);
          const hasFirst3Last4 = bankFirst3 && bankLast4 && digitsInText.includes(bankFirst3) && digitsInText.includes(bankLast4);
          const hasFirst4Last4 = bankFirst4 && bankLast4 && digitsInText.includes(bankFirst4) && digitsInText.includes(bankLast4);
          const hasAccountMatch = hasFullAccount || hasFirst4Last4 || hasFirst3Last4;
          const creditAmounts = extractSmsCreditAmounts(text);
          const numberMatches = creditAmounts.length > 0 ? creditAmounts.map(String) : (text.match(/[\d,]+/g) || []);
          let hasAmount = false;
          let matchedTelegramAmount = 0;
          for (const numStr of numberMatches) {
            const num = typeof numStr === 'number' ? numStr : Number(String(numStr).replace(/,/g, ''));
            if (num > 0 && amountMatches(num, bdtNum)) {
              hasAmount = true;
              matchedTelegramAmount = num;
              break;
            }
          }
          if (hasAccountMatch && hasAmount) {
            telegramMatch = true;
            matchedMsg = msg;
            const matchType = hasFullAccount ? `full: ${fullBankAccount}` : hasFirst4Last4 ? `first4+last4: ${bankFirst4}...${bankLast4}` : `first3+last4: ${bankFirst3}...${bankLast4}`;
            telegramMatchDetail = `${matchType}, amount: ৳${matchedTelegramAmount} (submitted: ৳${bdtNum}, diff: ৳${Math.abs(matchedTelegramAmount - bdtNum)})`;
            break;
          } else if (perMsgReasons.length < 5) {
            const acctTag = hasAccountMatch ? '✓acct' : `✗acct(need ${bankFirst3}...${bankLast4})`;
            const amtTag = hasAmount ? '✓amt' : `✗amt(need ৳${bdtNum})`;
            perMsgReasons.push(`${acctTag} ${amtTag}: "${snippet}"`);
          }
        }
      }
    }
    if (telegramMatch) {
      verificationLog.push(`✅ Telegram SMS matched (${telegramMatchDetail})`);
    } else {
      const matchInfo = useMobileAgentFlow
        ? `trnxID=${payment_reference}`
        : `bankAcct=${fullBankAccount} (last4=${bankLast4}, first4=${bankFirst4}, last3=${bankLast3}), bdt=${bdtNum}`;
      const total = telegramMsgs?.length ?? 0;
      const checked = total - alreadyMatchedSkipped;
      const detail = perMsgReasons.length > 0 ? ` | tried: ${perMsgReasons.join(' ; ')}` : '';
      verificationLog.push(
        `❌ Telegram SMS no match (${matchInfo}, total in window: ${total}, checked: ${checked}, already-matched skipped: ${alreadyMatchedSkipped}, window: ${windowStart} → ${windowEnd})${detail}`,
      );
    }

    let allPassed = false;
    if (method === 'atm_deposit') {
      allPassed = ocrAmountMatch && ocrAccountMatch && ocrAtmCredit && ocrRefMatch && telegramMatch;
    } else if (method === 'cash_deposit') {
      allPassed = ocrAmountMatch && ocrAccountMatch && telegramMatch;
    } else {
      // LOCKED: bank_transfer / MFS — strict checks. OCR amount MUST be present
      // and match submitted amount; OCR ref MUST match submitted ref; OCR account
      // MUST include selected account first3+last4. This prevents wrong-screenshot approvals.
      // Do NOT loosen these conditions without owner approval.
      const refOk = ocrRef !== '' && ocrRefMatch;
      const amountOk = ocrAmount > 0 && ocrAmountMatch;
      let acctOk = false;
      if (ocrAccountNumber && fullBankAccount) {
        acctOk = accountMatches(ocrAccountNumber, fullBankAccount);
        ocrAccountMatch = acctOk;
        verificationLog.push(acctOk ? `✅ OCR Account matched (${ocrAccountNumber} ~ ${bankFirst3}...${bankLast3})` : `❌ OCR Account mismatch (OCR: ${ocrAccountNumber} vs Bank: ${bankFirst3}...${bankLast3})`);
      } else {
        verificationLog.push(`❌ OCR Account missing (OCR could not extract account number)`);
      }
      allPassed = refOk && amountOk && acctOk && telegramMatch;
    }

    const logText = `Auto-verification (${method}): ${verificationLog.join(' | ')}`;
    if (!allPassed) {
      // Write match details for both pending AND hold so admins can see OCR/amount match status on held requests too.
      // For hold rows, prepend the existing manual hold reason so it's not lost.
      const { data: curRow } = await supabase.from('top_up_requests').select('status, admin_note').eq('id', request_id).maybeSingle();
      if (curRow && (curRow.status === 'pending' || curRow.status === 'hold')) {
        const prevNote = (curRow.admin_note || '').trim();
        const isVerifyLog = prevNote.startsWith('Auto-verification');
        const merged = curRow.status === 'hold' && prevNote && !isVerifyLog
          ? `Hold reason: ${prevNote}\n\n${logText}`
          : logText;
        await supabase.from('top_up_requests').update({ admin_note: merged }).eq('id', request_id).in('status', ['pending', 'hold']);
      }
      const failReasons: string[] = [];
      if (method === 'atm_deposit') {
        if (!ocrRefMatch) failReasons.push('OCR ref mismatch');
        if (!ocrAmountMatch) failReasons.push('OCR amount mismatch');
        if (!ocrAccountMatch) failReasons.push('OCR account mismatch');
        if (!ocrAtmCredit) failReasons.push('ATM Transfer Credit not found');
      } else if (method === 'cash_deposit') {
        if (!ocrAmountMatch) failReasons.push('OCR amount mismatch');
        if (!ocrAccountMatch) failReasons.push('OCR account mismatch');
      } else {
        if (ocrRef === '' || !ocrRefMatch) failReasons.push('OCR ref mismatch/missing');
        if (ocrAmount <= 0 || !ocrAmountMatch) failReasons.push('OCR amount mismatch/missing');
        if (!ocrAccountNumber || !ocrAccountMatch) failReasons.push('OCR account mismatch/missing');
      }
      if (!telegramMatch) failReasons.push('No Telegram SMS match');
      return new Response(JSON.stringify({ ok: true, auto_approved: false, reason: failReasons.join(', '), retry_suggested: !telegramMatch }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Auto-approving request ${request_id}: ${logText}`);
    // Idempotency guard: if a top_up transaction already exists for this request_id,
    // someone (manual admin or another verifier) already credited the wallet.
    // Never double-credit.
    const { data: existingTx } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference_id', request_id)
      .eq('type', 'top_up')
      .limit(1);
    if (existingTx && existingTx.length > 0) {
      console.log(`Skip auto-approve: transaction already exists for request ${request_id}`);
      // Still consume the matched SMS so it can't trigger another request later
      if (matchedMsg) {
        await supabase.from('telegram_messages').update({ matched_request_id: request_id }).eq('update_id', matchedMsg.update_id);
      }
      return new Response(JSON.stringify({ ok: true, auto_approved: false, reason: 'Already credited (idempotency guard)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: approvedRows, error: updateErr } = await supabase
      .from('top_up_requests')
      .update({ status: 'approved', admin_note: logText, reviewed_by: null })
      .eq('id', request_id)
      .eq('status', 'pending')
      .select('id');
    if (updateErr) throw updateErr;
    if (!approvedRows?.length) {
      return new Response(JSON.stringify({ ok: true, auto_approved: false, reason: 'Request already processed by another verifier' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Card bill deduction
    let finalUsdAmount = Number(amount);
    let cardBillDeducted = 0;
    try {
      const { data: pendingBill } = await supabase
        .from('card_bills')
        .select('id, due_amount_bdt')
        .eq('user_id', user_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (pendingBill && pendingBill.due_amount_bdt > 0 && bdtNum > 0) {
        const dueBdt = Number(pendingBill.due_amount_bdt);
        const deductBdt = Math.min(dueBdt, bdtNum);
        cardBillDeducted = deductBdt;
        const remainingBdt = bdtNum - deductBdt;
        const usdRate = Number(request.usd_rate) || 1;
        finalUsdAmount = remainingBdt / usdRate;
        const newDue = dueBdt - deductBdt;
        await supabase.from('card_bills').update({ due_amount_bdt: newDue, status: newDue <= 0 ? 'paid' : 'pending', updated_at: new Date().toISOString() }).eq('id', pendingBill.id);
        try {
          let clientName = '';
          try {
            const { data: cp } = await supabase.from('profiles').select('full_name, email').eq('user_id', user_id).single();
            clientName = cp?.full_name || cp?.email || '';
          } catch {}
          const syncUrl = `${supabaseUrl}/functions/v1/sync-card-bills`;
          await fetch(syncUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'write_payment', user_id, amount_bdt: deductBdt, client_name: clientName }),
          });
        } catch (sheetErr) {
          console.error('sync-card-bills call failed (non-blocking):', sheetErr);
        }
      }
    } catch (billErr: any) {
      console.log('Card bill check skipped:', billErr?.message);
    }

    // Wallet credit
    const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', user_id).single();
    const currentBalance = Number(wallet?.balance ?? 0);
    const newBalance = currentBalance + finalUsdAmount;
    const { error: walletErr } = await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', user_id);
    if (walletErr) throw walletErr;

    // Agency wallet deduction
    const { data: userProfile } = await supabase.from('profiles').select('agency_id').eq('user_id', user_id).single();
    if (userProfile?.agency_id) {
      const { data: agencyWallet } = await supabase.from('agency_wallets').select('balance').eq('agency_id', userProfile.agency_id).single();
      if (agencyWallet) {
        const agencyBalance = Number(agencyWallet.balance);
        const newAgencyBalance = agencyBalance - Number(amount);
        await supabase.from('agency_wallets').update({ balance: newAgencyBalance }).eq('agency_id', userProfile.agency_id);
      }
    }

    // Transaction
    const txDescription = cardBillDeducted > 0 ? `Wallet top-up auto-approved (Card bill ৳${cardBillDeducted.toLocaleString()} deducted)` : 'Wallet top-up auto-approved';
    const { error: txErr } = await supabase.from('transactions').insert({
      user_id,
      type: 'top_up',
      amount: finalUsdAmount,
      balance_after: newBalance,
      reference_id: request_id,
      description: txDescription,
      processed_by: 'system',
    });
    if (txErr) throw txErr;

    // Invoice
    const { data: invNum } = await supabase.rpc('generate_invoice_number');
    await supabase.from('invoices').insert({
      top_up_request_id: request_id,
      invoice_number: invNum || `INV-${Date.now()}`,
      user_id,
      amount: Number(amount),
      bdt_amount: bdtNum,
      usd_rate: Number(request.usd_rate || 0),
    });

    await supabase.from('notifications').insert({
      user_id,
      type: 'top_up_update',
      title: 'Top-Up Approved',
      message: `Your top-up of $${amount} has been auto-approved.`,
      reference_id: request_id,
    });

    if (matchedMsg) {
      await supabase.from('telegram_messages').update({ matched_request_id: request_id }).eq('update_id', matchedMsg.update_id);
      try {
        const raw = matchedMsg.raw_update || {};
        const payload = raw.message || raw.edited_message || raw.channel_post || raw.edited_channel_post || {};
        const messageId = payload.message_id;
        const chatId = matchedMsg.chat_id;
        if (messageId && chatId) {
          const { data: botTokenSetting } = await supabase.from('site_settings').select('value').eq('key', 'telegram_bot_token').single();
          if (botTokenSetting?.value) {
            await fetch(`https://api.telegram.org/bot${botTokenSetting.value}/setMessageReaction`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji: '❤' }] }),
            });
          }
        }
      } catch (e) {
        console.error('Telegram reaction failed (non-blocking):', e);
      }
    }

    // Seller ledger sync + Telegram forward are handled atomically by the
    // database trigger `sync_seller_transaction_for_approved_topup_trigger`.
    // We only INITIALIZE telegram_forwarded to false when the receiving bank
    // has a Telegram group configured — the forward-proof edge function will
    // flip it to true once Telegram actually accepts the message. This way
    // the field is a truthful "did the message land?" indicator instead of
    // an optimistic "we tried" flag.
    if (bank_account_id) {
      const { data: bankRow } = await supabase
        .from('bank_accounts')
        .select('telegram_group_id')
        .eq('id', bank_account_id)
        .single();
      if (bankRow?.telegram_group_id) {
        await supabase
          .from('top_up_requests')
          .update({ telegram_forwarded: false })
          .eq('id', request_id)
          .is('telegram_forwarded', null);
      }
    }

    return new Response(JSON.stringify({ ok: true, auto_approved: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('verify-topup error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});