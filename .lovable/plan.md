# Multi-App Rate Limit Strategy — Architecture Plan

Eta ekhon **shudhu plan**, code change na. Future e jokhon rate limit problem hobe, tokhon implement korbo.

---

## 1. Meta Rate Limit kivabe count hoy (summary)

Meta'r BUC (Business Use Case) limit **3 layer** e count hoy:

| Layer | Scope | Multi-app diye bypass hoy? |
|---|---|---|
| **App-level** | Per App ID per user | ✅ Haan — different app = different bucket |
| **Ad Account-level** | Per ad account (call_count, cputime, total_time) | ❌ Na — same account same bucket |
| **BM-level** | Puro Business Manager | ❌ Na — same BM same bucket |

**Mul kotha:** Multi-app strategy **app-level throttling** solve kore, account/BM level e kichu kore na.

---

## 2. Tomar setup e ki hobe

```text
System User (1)
   ├── App A (token A)  ─┐
   ├── App B (token B)  ─┼── 100 ad accounts (same BM)
   └── App C (token C)  ─┘
```

- **App A** diye account X call → A bucket ↑, X bucket ↑, BM bucket ↑
- **App B** diye same account X call → B bucket ↑ (fresh!), X bucket ↑ (same), BM bucket ↑ (same)

**Net effect:** App-level e 3x headroom, account-level e 0x gain.

---

## 3. Same BM e multiple system user na hole ki kora?

Eta common problem. Solution:

- **1 system user + multiple app token** — eta pura allowed
- BM Settings → System Users → select user → **Add Assets → Apps** → multiple app assign
- Protek app er jonno alada token generate kora jaay (different scope/expiry)
- Mane: 1 system user identity, kintu 3-5 ta app token hand e

---

## 4. Proposed Architecture (jokhon implement korbo)

### 4.1 Database changes

`business_managers` table e ekhon `access_token` (single) ache. Notun structure:

```text
business_manager_app_tokens
├── id
├── business_manager_id  (FK)
├── app_id               (Meta App ID)
├── app_label            ("Primary", "Backup-1", etc.)
├── access_token         (encrypted, like ekhon)
├── is_active            (boolean)
├── priority             (int — lower = preferred)
├── last_used_at         (timestamptz)
└── disabled_until       (timestamptz, null — set when 429 hit)
```

Backward compat: existing `business_managers.access_token` ke "default app token" hisebe migrate kora hobe.

### 4.2 App selection logic (in `metaFetch` / `chunkedMetaSync`)

```text
function pickAppToken(bmId):
  candidates = tokens where bm_id=bmId AND is_active
                              AND (disabled_until IS NULL OR disabled_until < now())
  if empty: fallback to legacy bm.access_token
  sort by priority ASC, last_used_at ASC  (least-recently-used)
  return first
```

### 4.3 429 / rate-limit handling

Meta response headers parse korte hobe:
- `X-Business-Use-Case-Usage` → JSON with `call_count`, `total_cputime`, `total_time`, `estimated_time_to_regain_access`
- Jodi kono metric > 90% → oi token er `disabled_until = now() + estimated_time_to_regain_access`
- Pore automatically next app token use hobe

### 4.4 UI (Admin → Business Managers page)

- Existing BM card e "Manage App Tokens" button
- Dialog e: list of tokens, add new, mark active/inactive, see last_used_at + disabled_until
- Health badge: 🟢 healthy, 🟡 throttled (X min remaining), 🔴 disabled

---

## 5. Limitations (clearly communicate)

Multi-app **j gulo solve kore na**:

1. **Account-level block** — ekta account e too many calls → oi account 1 hour block, kono app diyei call jabe na. Solution: caching, polling frequency reduce, batch calls.
2. **BM-level throttle** — entire BM slow. Solution: BM split (different accounts → different BMs), but eta business decision.
3. **Spend cap update / write operations** — eta sensitive, multi-app rotation FB suspicious dekhte pare. Write call gulo single "primary" app diye rakha better.

---

## 6. Recommended action priority (jokhon problem hobe)

1. **First:** Reduce call frequency (already chunked sync ache, tar interval barano)
2. **Second:** Implement multi-app rotation (ei plan)
3. **Third:** Account-level caching/throttling (per-account cooldown after heavy fetch)
4. **Last resort:** BM split

---

## 7. Akhon ki korte hobe?

**Kichui na.** Ei plan reference er jonno — jokhon "User request limit reached" error dekha jabe regularly, tokhon ei plan theke implement korbo. Tokhon notun chat e bolba "multi-app rotation implement koro" — ei plan apply hobe.
