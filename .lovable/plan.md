## Samasya

Client bKash/Nagad → Bank top-up submit korte parche na. Screenshot er destination account masked thake (e.g. `1503XXXXX001`), tai strict "first 3 + last 4" rule fail kore.

Apnar nirdharito rule: **bKash/Nagad → Bank** er khetre target account er **first 4 digit + last 3 digit** match korlei pass. Onnyo sob method e age er strict rule (first 3 + last 4) jemon ase temon thakbe.

Bortoman code:
- Relaxed branch `allow_first3_last3` use kore **first 3 + last 3** (apnar bola rule noy).
- Flag tao only `paymentMethod === "mfs_to_bank"` selected hole on hoy — jodi user "Online Transfer" → "NPSB" / wrong sub-method select kore felle bkash screenshot e atke jay.

## Fix (UI only, kono business logic / locked top-up flow tach noy)

1. **Relaxed rule ke "first 4 + last 3" e shift kora** — exactly user er bola rule.
   - `supabase/functions/ocr-seller-payment/index.ts`: `allowFirst3Last3` branch e `first3`/`last3` er jaygay `first4` + `last3` use korbo (variable name keep — internal). Strict branch (first3 + last4) unchanged.
   - `src/components/client/ClientTopUp.tsx` `verifyAccountFromData`: same change — relaxed branch use first4 + last3.

2. **Bkash/Nagad source auto-detect** (so wrong sub-method select korleo MFS→Bank screenshot pass kore, ar Ager-er onnyo rule unchanged):
   - OCR response e source detect: `data.bank_name` / `data.source` / `data.reference` / OCR text e "bkash", "bikash", "বিকাশ", "nagad", "নগদ" thakle treat as MFS source.
   - Jodi (a) `paymentMethod === "mfs_to_bank"`, **OR** (b) OCR-detected source MFS **ebong** selected destination bank MFS noy (i.e. real bank like City Bank) → relaxed first4+last3 rule apply.
   - Server call e `allow_first3_last3: true` patabo same condition e (OCR detection toh OCR er pore jana jay — tai upload e first call `mfs_to_bank` hole true, na hole client-side `verifyAccountFromData` ke OCR data hate ele MFS detect korle relaxed mode e re-run korbo ar `accountVerified` state correct kore set korbo). Server o relaxed branch alreadyrule mante allow flag dile pass dibe.

3. **Bank → Online Transfer flow er sub-method selection clearer kora** (optional small UX nudge): "bKash/Nagad → Bank" card er description e jukto korbo "(masked account: first 4 + last 3 match)" — taking guesswork out.

## Technical details

`verifyAccountFromData` (client) + `verifyAccount` (server) — only the relaxed branch:

```text
// before
d.length >= 6 && d.startsWith(first3) && d.endsWith(last3)
// after
d.length >= 7 && d.startsWith(first4) && d.endsWith(last3)
```

Sliding-window regex same way: `${first4}\d{0,20}${last3}` (replace current `${first3}\d{0,20}${last3}`).

Client MFS auto-detect helper:
```text
const ocrMentionsMFS = /bkash|bikash|বিকাশ|nagad|নগদ/i.test(
  [data?.bank_name, data?.source, data?.reference, data?.account_holder_name].filter(Boolean).join(" ")
);
const destIsBank = !isMFS(bankSnapshot.bank_name);
const allowRelaxed = paymentMethodSnapshot === "mfs_to_bank" || (ocrMentionsMFS && destIsBank);
```

Use `allowRelaxed` for both client `verifyAccountFromData` invocation and the server `allow_first3_last3` body field (pass true if `mfs_to_bank` from the start; for the auto-detect case the server already returns false but client recheck with relaxed rule will flip `accountVerified` to true and unlock submit).

## Files

- `supabase/functions/ocr-seller-payment/index.ts` — relaxed-branch formula change only.
- `src/components/client/ClientTopUp.tsx` — `verifyAccountFromData` formula change, OCR caller MFS auto-detect, post-OCR re-verify with allowRelaxed, and (optional) MFS→Bank card copy.

## Out of scope (touch korbo na)

- Strict (non-MFS) verification rule.
- Top-up auto-approval / forwarding / Telegram / sheet sync (locked flows).
- Server top-up enforcement beyond the relaxed-branch formula update.
