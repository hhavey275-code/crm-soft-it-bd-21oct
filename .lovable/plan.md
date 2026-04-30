Bujhlam. Current v2.0 implementation faltu hoyeche mainly karon eta generic GraphQL text parse kortese, exact Meta operation/doc_id capture kortese na, and card remove mutation blank doc_id diye call kortese. Tai card details wrong, threshold miss, remove fail. Ami eta v2.1 e properly fix korbo without tomake aro question kora.

Plan:

1. Extension data capture reliable korbo
- `hook.js` e shudhu response text na, request body-o capture korbo:
  - `fb_api_req_friendly_name`
  - `doc_id`
  - `variables`
  - `fb_dtsg`, `lsd`, `jazoest`, actor/user id
  - current URL/account id
- Per account operation cache rakha hobe, jate Meta er exact query/mutation replay kora jay.
- Generic parser er upor depend komabo.

2. Card details thik korbo
- Payment methods section theke visible DOM parse fallback add korbo, exactly page e jeta dekha jay:
  - brand/name
  - last 4
  - expiry
  - default/backup status
  - row/menu/remove availability
- GraphQL parser e only real card/payment method IDs accept korbo. Fake `local:visa:7144` type ID diye Remove button dekhabo na.
- Duplicate card issue fix korbo by merging on real funding source/payment method id first, then last4+brand fallback only for display.
- Extension panel e card row display Meta billing page er sathe match korbe.

3. Threshold / hidden daily limit sync fix korbo
- DOM parser add korbo for these exact Meta billing page texts:
  - `Your balance reaches $...` = billing threshold
  - `Daily spending limit (set by Meta): $...` = hidden daily limit / DSL
  - `Current balance $...`
  - `Funds $...`
- GraphQL fields theke threshold/daily limit pele use korbo, na pele DOM fallback use korbo.
- CRM sync payload mapping fix korbo so:
  - `hidden_daily_limit` CRM e hidden DSL hisebe jay
  - `billing_threshold` CRM e threshold hisebe jay
  - balance/outstanding/total spending jodi available hoy store hoy
- `get-ad-account-limits` function update korbo so old `daily_spend_limit` column na pele `hidden_daily_limit` column theke DSL return kore.

4. Card removal properly fix korbo
- Current blank `doc_id` GraphQL replay remove korbo.
- Captured exact delete mutation/doc_id/variables use kore removal call korbo.
- If exact mutation not captured, extension same-page context e Meta UI fallback korbe:
  - correct card row find
  - menu open
  - Remove click
  - confirmation dialog confirm
  - success/failure verify
- Remove button only show korbo when:
  - real payment method/funding source id ase, or
  - visible Meta UI row remove action available
- Remove fail hole fake success dekhabe na; clear error dekhabe.
- Remove success hole panel theke card remove kore CRM sync e detached event pathabe.

5. CRM card list/update fix korbo
- `ingest-dsl` e detached/removed card events support add korbo.
- `ad_account_last_known_state.cards` theke removed card remove korbo.
- `AdAccountSyncedCards` current card list e detached card current card hisebe dekhabe na; needed hole only history/cache context e show korbe.
- Sync button click korle updated card count CRM e reflect korbe.

6. CRM sync button reliability fix korbo
- Current hidden tab 4.5s wait kore immediately collect kore, tai often snapshot empty hoy. Eta change korbo:
  - billing page load wait
  - hook ready wait
  - DOM + GraphQL data wait loop up to ~25s
  - minimum expected fields/card rows found hole then push
- Sync result e matched/unmatched info/status better show korbo.

7. Payment method add support answer + implementation boundary
- New card number directly add kora practical/safe na: Meta card add flow uses tokenization, bank/3DS/payment verification, and PCI-sensitive fields. Eta extension diye raw card add kora uchit na.
- But existing saved BM/card/funding source ke ad account e attach/add kora possible hote pare, if Meta page exposes an attach/add GraphQL mutation. Ami hook e add/attach mutation recorder add korbo.
- If captured attach mutation available hoy, extension e “Attach existing payment method” support add korbo for already-saved payment methods only.
- If Meta mutation/doc_id not captured, button disabled thakbe with reason. Fake add success dekhabo na.

8. Version/package update
- Extension version bump korbo to `2.1.0`.
- `public/dsl-sync-extension.zip` rebuild korbo.
- CRM page extension version text/update instructions update korbo.

Expected result:
- Billing page e card count/details Meta page er sathe match korbe.
- Threshold and hidden daily limit CRM e sync hobe jodi page e visible/API response e available thake.
- Card remove real action korbe, fake/local ID diye remove korbe na.
- CRM synced cards remove er por current card list theke disappear korbe.
- Existing payment method attach/add technically possible hole support thakbe; new raw card add korbo na.