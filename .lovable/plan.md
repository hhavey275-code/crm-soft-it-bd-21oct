## লক্ষ্য
"Old Seller" নামে একটা read-only admin menu, যেখানে প্রতিটা seller এর archive ডাটা (`seller_transactions_archive_2026_05`) detailed breakdown সহ দেখা যাবে — forwarded vs not-forwarded আলাদা, USDT/withdraw আলাদা, এবং দুই রকম Due/Advance total (forwarded-only এবং সব মিলিয়ে)।

## নতুন Menu
- Sidebar এ admin section এ "Old Seller" (Archive icon), শুধু admin/superadmin
- Route: `/old-seller` → `src/routes/old-seller.tsx` → `OldSellerPage`

## Page Structure

### 1. Seller Selector (top)
Dropdown: archive এ ডাটা আছে এমন seller list (name + email)। Default — প্রথম জন।

### 2. Summary Cards (selected seller এর জন্য — ৬টা card grid)

প্রতিটা card এ count + BDT (এবং relevant হলে USD/USDT):

| Card | কী count হবে |
|---|---|
| 🟢 Forwarded payments IN | `client_topup` যেখানে linked top-up এর `telegram_forwarded=true` + `bdt_payment` যেখানে live table এর forwarded flag true ছিল* |
| 🔴 Not-forwarded payments IN | বাকি approved client_topup + bdt_payment + tenant_payment |
| 💵 USDT Given | `type=usdt_received` — count, total USDT, avg rate, total BDT cost (=Σ usdt×rate) |
| 💸 Withdraw | `type=withdraw` — count, total BDT |
| ⚖️ Due/Advance (Forwarded only) | (Forwarded payments IN) − USDT cost − Withdraw |
| ⚖️ Due/Advance (All) | (All payments IN) − USDT cost − Withdraw |

*Note: archive table এ `telegram_forwarded` column নাই। তাই detection rule:
- `client_topup` → `top_up_requests.telegram_forwarded` join করে দেখব
- `bdt_payment / tenant_payment / withdraw / usdt_received` → archive এ flag নাই, তাই এদের সবাইকে "not forwarded বা unknown" হিসাবে dashboard এ ২টা bucket এ দেখাব এবং note দিব। But USDT/Withdraw সবসময় উভয় total এ count হবে (যেমন তুমি বললে)।

### 3. Reconciliation Note (small panel)
Forwarded-only Due/Advance ↔ All Due/Advance এর difference exact কত, এবং সেটাই "not forwarded payment IN" এর সমান হওয়ার কথা — যদি না হয় lal warning।

### 4. Detailed Breakdown (Tabs)

৫টা tab, প্রতিটায় full table + CSV export + search box:

**A. Forwarded Payments (IN)**
| Date/Time | TrxID / Ref | Type | BDT | USD (top-up হলে) | Bank | Entry by | Telegram msg id |

**B. Not-forwarded Payments (IN)**
একই columns, কিন্তু "Forwarded?" column এ ❌ badge

**C. USDT Given**
| Date/Time | USDT | Rate | BDT cost | Bank | Description | Entry by |

**D. Withdraw**
| Date/Time | BDT | Description (Rifat / Whatsapp group ইত্যাদি) | Entry by | Reviewed by |

**E. All Transactions (raw)**
সব archive rows একসাথে, sortable, type badge সহ — manual deep-check এর জন্য।

প্রতিটা table এর footer এ subtotal।

### 5. Top-up Requests panel (collapsible)
আলাদা একটা section এ archive period এর সব `top_up_requests` (status=approved, এই seller এর bank দিয়ে) — যাতে তুমি দেখতে পারো কোন top-up গুলো archive-ledger এ ঢুকেছে আর কোনগুলো ঢুকে নাই (orphan)। Columns: time, USD, rate, BDT, bank, telegram_forwarded badge, "ledger entry আছে?" tick/cross।

## Technical Details

**Files create:**
- `src/routes/old-seller.tsx` — TanStack route, admin guard
- `src/components/pages/OldSellerPage.tsx` — selector + layout
- `src/components/admin/OldSellerBreakdown.tsx` — summary cards + tabs
- `src/lib/oldSellerData.ts` — data fetching:
  - `fetchArchivedSellers()` → distinct seller_id from archive + profile names
  - `fetchSellerArchiveBundle(sellerId)` → all archive txns + linked top_up_requests in one go
  - `splitForwardedBuckets(rows, topupMap)` → returns `{forwardedIn, notForwardedIn, usdtGiven, withdraws}`
  - `computeDueAdvancePair(...)` → returns `{forwardedOnly, all}` using existing logic from `sellerRunningTotal.ts`

**Edit:**
- `src/components/AppSidebar.tsx` — add "Old Seller" menu item under admin section
- `src/routeTree.gen.ts` — auto-regen by Vite plugin

**Data source:** `seller_transactions_archive_2026_05` + `top_up_requests` (live, joined by `top_up_request_id`) + `bank_accounts` (for bank name) + `profiles` (seller name)

**RLS:** Archive table inherits from migration; verify admin/superadmin SELECT works. Add policy if missing।

**No mutations** — pure read-only audit UI। কিছু ঠিক করতে হলে আলাদা request দিবে।

## Out of scope
- Archive ডাটা edit/delete
- Live `seller_transactions` কোনো change
- নতুন archive তৈরি (monthly close flow এ আগে থেকেই আছে)
