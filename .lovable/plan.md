## Plan

### 1) Fix login/signout lag and stale role issue
- Refactor `AuthContext` so auth state restores with `getSession()` first, then listens to later auth events without awaiting database calls inside `onAuthStateChange`.
- Remove/limit stale `cached_role` behavior so a previous client role cannot temporarily show client UI after switching to an admin account.
- Make `signOut()` more forceful:
  - clear Supabase auth storage keys, cached role, session storage, and relevant query cache
  - reset auth state immediately even if Supabase signout is slow
  - navigate to `/auth` after signout
- Update the sidebar sign-out button to show a loading state and prevent double-clicks.

### 2) Add a new top-up method: `bKash/Nagad to Bank`
- In client top-up flow, add a separate method under Bank Transfer choices:
  - `Online Transfer`
  - `bKash/Nagad to Bank`
  - `NPSB`
  - `ATM Deposit`
  - `Cash Deposit`
- Store the new methods distinctly in `top_up_requests.payment_method`, for example:
  - `mfs_to_bank`
  - `npsb`
- Show the selected method in Review and history/admin logs where applicable.

### 3) Verification rules for the new method
- Keep normal bank transfer strict: full match or `first3 + last4` only.
- Add a narrow exception only for `mfs_to_bank`:
  - amount must match
  - transaction/reference ID must match
  - OCR must identify receiver bank account digits
  - if last 4 digits are not visible, allow `first3 + last3`
  - server log/admin note will clearly say `mfs_to_bank first3+last3 fallback`
- This exception will not apply to normal bank transfer, NPSB, ATM deposit, or cash deposit.

### 4) Current verification behavior to keep/document
- `MFS` currently means payment to a bKash/Nagad merchant/agent account. It uses MFS flow, reference/amount matching, and Telegram SMS matching by transaction ID.
- `Cash Deposit` currently requires OCR amount + destination account match, then Telegram SMS account/amount match. It does not require a reference match.
- `ATM Deposit` currently requires OCR reference match + amount match + account match + “ATM Transfer Credit” confirmation + Telegram SMS match.
- Normal `bank_transfer` currently requires OCR reference + amount + selected account match, plus Telegram SMS account/amount match.

### 5) Validation
- Test auth flow manually: client login → sign out → admin login without reload.
- Test verification logic with account examples like `...6001` vs `...1001` to confirm normal flow still fails.
- Test `mfs_to_bank` with `first3 + last3` visible to confirm only that method can pass the fallback.