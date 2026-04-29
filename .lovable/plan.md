
## Ki korbo

Apnar dui ta change:

1. **BM sync = sudhu System User-e assigned ad accounts ashbe** (purono CRM-er moto behavior). Top-up issue ar hobe na karon je account-e write permission nai, sheta CRM-e ashbei na.
2. **"Add Single Ad Account" option** — admin chaile ekta ad account ID type kore, kon BM-er token use hobe seta select kore, sheta CRM-e direct entry kore dite parbe (Meta sync chara).

---

## 1) Sync filter — System User assigned only

**Kaj:** `sync-bm-accounts` edge function-e BM-r sob owned/client ad account aanar por, aro ekta Meta API call kore System User-e assigned account-er list ene, oi list diye filter korbo. Sudhu match-kora account-gula return hobe.

**Technical flow (edge function-e):**
- Already `/{bm_id}/owned_ad_accounts` ar `/{bm_id}/client_ad_accounts` call hocche.
- Notun: BM token diye `GET /me?fields=id` → System User ID.
- Notun: `GET /{system_user_id}/assigned_ad_accounts?fields=account_id&limit=100` (paginated, sob page).
- Assigned account ID-r ekta `Set` banabo. Owned + client list-ke oi Set diye filter kore frontend-e return korbo.
- Filter na hole (System User na thakle ba call fail korle) — clearly error throw korbo, sob account return korbo na (purono behavior-e fire jabar jonno safety)। Apnar consent thakle: silent fallback rakhte pari "filter na hole sob return koro" — kintu default behavior strict thakbe।
- Toast message-e dekhabo: "X account synced (Y skipped — System User assignment nai)"।

**Note:** `sync-bm-accounts` source repo-te nai (Supabase-e direct deploy)। Ami implement korar agei Supabase theke current source ene `supabase/functions/sync-bm-accounts/index.ts`-e bosabo, tarpor filter logic add korbo, jeno apnar onyano logic intact thake।

---

## 2) "Add Single Ad Account" — manual entry

**Kothay:** `AdminBusinessManagers.tsx`-e ekta notun button: **"Add Single Ad Account"** (existing "Add BM" button-er pashe)। Click korle dialog khulbe।

**Dialog-er fields:**
- **Ad Account ID** (text input) — `act_` prefix chara/soho dutoi accept korbo, normalize kore save korbo।
- **Business Manager** (dropdown) — `business_managers` table theke active BM list, name + bm_id dekhabe। Eta select korle oi BM-er token-er nichey rakha hobe।
- **Account Name** (optional text) — diley setai save hobe; na diley Meta theke fetch kore nibo।

**Submit korle ki hobe:**
- Selected BM-er access token diye Meta call: `GET /act_{id}?fields=name,account_status,spend_cap,amount_spent,business`।
- Success hole `ad_accounts` table-e insert (status active, business_manager_id = selected BM-er row id, business_name = Meta-r BM name, ar spend_cap/amount_spent dollars-e convert kore)।
- Already `account_id` exist korle update korbo (upsert on conflict)।
- Failure hole (token-e access nai / wrong ID / System User assigned na) — clear error message dekhabo।
- Success-e toast: "Ad account added"; list refresh hobe।

**Implementation:** Notun ekta chhoto edge function `add-ad-account-manual/index.ts` banabo (BM token decrypt karon serverside hote hobe, ar `service_role` diye insert hobe RLS bypass-er jonno)। Frontend oi function call korbe।

---

## Files

**Edit:**
- `supabase/functions/sync-bm-accounts/index.ts` (Supabase theke ene + filter logic add)
- `src/components/admin/AdminBusinessManagers.tsx` (notun button + dialog + mutation)

**Notun:**
- `supabase/functions/add-ad-account-manual/index.ts` (single-account fetch + upsert)

---

## Edge cases ja handle korbo

- Manual add korar somoy Meta API error (invalid ID, no permission) — wallet/state-e kichu na change kore error dekhano।
- Already CRM-e thaka account abar add korle: upsert kore "Account updated" dekhabe।
- Sync-e System User call fail korle: toast-e warning ar import dialog-e shudhu jegula confirm assigned, sheguloi dekhano (na pele 0 dekhabe + reason)।

---

Approve korle implement kori।
