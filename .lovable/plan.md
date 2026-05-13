## পরিবর্তনগুলো

### ১. Client sidebar থেকে "Wallet" menu remove
- `AppSidebar.tsx` থেকে client role এর Wallet nav item বাদ
- Dashboard এর Wallet Balance card এ click করলে wallet info modal/section এ দেখাবে (অথবা শুধু dashboard-এ display)
- Routing `/wallet` থাকবে কিন্তু sidebar এ আসবে না

### ২. Tutorial system পুরোপুরি rebuild
নতুন structure:
- **Tutorial hub**: client dashboard এ "📺 Tutorial" button → একটা modal খুলবে যেখানে multiple tutorial-এর list:
  1. কীভাবে Top-Up Request দিব
  2. কীভাবে Ad Account Top-Up করব
  3. কীভাবে Ad Account rename করব
  4. কীভাবে Theme/Color পরিবর্তন করব
  5. কীভাবে BM Access request করব
  6. কীভাবে Spend Cap Withdraw request করব

- প্রতিটি tutorial-এ **Device toggle** (PC view / Mobile view) — user যেটায় আছে সেটা auto-select হবে কিন্তু switch করতে পারবে

- প্রতিটি tutorial **একই pattern** এ flow করবে:
  1. **Login screen** mock দেখানো (caption: "প্রথমে login করুন")
  2. **Dashboard** এ আসা — overview দেখানো
  3. **Sidebar menu** highlight + click animation দেখিয়ে target page এ যাওয়া
  4. **Target page** এ এসে exact button/option highlight
  5. **Action perform** — step-by-step click sequence with captions

### ৩. Dashboard "পরিচিতি" tutorial — সব ৭টা card cover
বর্তমান cards:
- Wallet Balance, Ad Accounts, Remaining, Today Spend, Today Orders, Total Top-Up, Total Spend (All)
প্রতিটি card individually highlight + Bangla caption

### ৪. Ad Account rename flow সঠিক করা
বর্তমান ভুল: সরাসরি rename দেখাচ্ছে।
সঠিক flow:
1. Ad Accounts page এ যাওয়া
2. Account row এর ডানদিকে **3-dot menu (⋮)** highlight
3. 3-dot click → dropdown খোলা animation
4. Dropdown এ **Rename** option highlight + click
5. Rename dialog এ নতুন নাম type → Save

### ৫. Theme/Color tutorial — full color theme
শুধু dark/light না, সম্পূর্ণ color picker:
1. Top bar এ **theme palette icon** (🎨) highlight
2. Click করলে color theme picker খুলবে — Green / Orange / Blue / Purple ইত্যাদি options
3. একটা color select করার animation
4. UI পরিবর্তনের preview

### ৬. Payment Request tutorial — actual UI mirror
বর্তমান CRM এর UI exactly follow করা:
1. Sidebar → Top-Up Request
2. **Bank type select**: প্রথমে bKash / Nagad / Rocket buttons → তারপর **NPSB** option → তারপর specific **bank account** dropdown
3. **Amount** field
4. **Screenshot upload** — upload করার পর "OCR processing..." animation দেখানো → extracted data (sender, amount, txn ID) auto-fill হওয়া দেখানো
5. **Review** section দেখানো
6. **Submit** button click

### ৭. PC vs Mobile UI fidelity
Tutorial overlay নিজে বর্তমান CRM-এর actual rendered UI এর উপর spotlight করবে (যেটা আগেই করছে), কিন্তু:
- **PC mode**: viewport ≥768px assume — full sidebar visible, 4-column card grid
- **Mobile mode**: viewport <768px assume — drawer sidebar, single-column cards
- Tutorial start করার সময় current viewport detect করে appropriate flow load করবে; user manual toggle ও পারবে (preview এ rendered UI change হবে না, কিন্তু caption/step instruction adjust হবে: যেমন mobile এ "উপরে hamburger menu এ ট্যাপ করুন")

## Technical approach

### Files to modify
- `src/components/AppSidebar.tsx` — client role থেকে Wallet item conditional remove
- `src/components/client/ClientDashboard.tsx` — Tutorial button → multi-tutorial modal launcher; Wallet Balance card-এ wallet সংক্ষিপ্ত info / link inline দেখানো
- `src/lib/tutorial/steps.ts` — পুরো rewrite, multiple flow হিসেবে structured:
  ```ts
  export type TutorialFlow = {
    id: string;
    title: string;          // Bangla
    description: string;    // 1-line
    icon: string;           // emoji
    steps: TutorialStep[];
  };
  export const tutorialFlows: TutorialFlow[] = [...]
  ```
- `src/components/Tutorial.tsx` — flow selector UI add, device toggle, step engine (current spotlight engine reuse)
- `src/components/client/ClientAdAccounts.tsx` — `data-tutorial` attribute add: `ad-account-row-menu` (3-dot), `ad-account-rename-item`
- `src/components/client/ClientTopUp.tsx` — `data-tutorial` attribute add: `topup-bank-type`, `topup-bank-account`, `topup-amount`, `topup-upload`, `topup-ocr-result`, `topup-submit`
- `src/components/ColorThemePicker.tsx` (or wherever theme picker lives) — `data-tutorial="theme-picker-trigger"`, `data-tutorial="theme-color-options"`
- `src/components/DashboardLayout.tsx` (top bar) — theme button selector stable

### New tutorial flows file structure
`src/lib/tutorial/flows.ts` — 6টা flow, প্রত্যেকটা ~5-10 step.

### No backend / DB changes
সব frontend। Locked flows (top-up verify, payment forward) untouched।

## Out of scope
- Real interactive tutorial (kichu submit hobe na)
- Login page-এ actual login করানো — শুধু caption "Login করে dashboard-এ আসুন"
- Tutorial recording / video

## Acceptance
- Client sidebar এ Wallet নেই
- Dashboard "Tutorial" button → modal এ ৬টা tutorial-এর list
- Ad account rename flow সঠিকভাবে 3-dot → Rename দেখায়
- Dashboard পরিচিতি tutorial সব ৭টা card cover করে
- Theme tutorial color picker সহ full flow দেখায়
- Payment Request tutorial actual UI sequence (bKash/Nagad → NPSB → bank → upload → OCR → submit) follow করে
- প্রতিটি tutorial login → dashboard → sidebar → target → action — এই pattern এ চলে
- PC / Mobile toggle কাজ করে; caption viewport-aware
