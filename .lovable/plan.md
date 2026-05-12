## Goal

Client dashboard e ekta **"Tutorial dekhun"** button thakbe. Click korle ekta animated mouse cursor screen er upor ghure ghure step-by-step dekhabe — kivabe payment request dite hoy, approve hole wallet e balance ashe, sekhan theke ad account e top-up hoy, ebong remaining balance kothay dekha jay. Sob caption Bangla te.

## Flow ja dekhabo (step-by-step)

1. **Dashboard** — Welcome + "Wallet e taka load korar process dekhi"
2. **Sidebar → Top-Up** menu te cursor click → Top-Up page e jabe
3. **Top-Up page**:
   - "Amount likhun" field highlight
   - "Bank select korun" highlight
   - "Payment screenshot upload korun" highlight
   - "Submit" button click animation
   - Caption: "Submit korar por admin/auto-verify approve korbe"
4. **Sidebar → Wallet** menu click → Wallet page
   - "Available Balance" card highlight: "Approve hole ekhane balance dekhben"
   - Top-Up History row highlight: "Sob purono request er status ekhane"
5. **Sidebar → Ad Accounts** click → Ad Accounts page
   - Ekta ad account card e cursor jabe
   - "Top-Up" button highlight + click animation
   - Dialog open hole "Amount likhe Confirm korun" highlight
   - Caption: "Wallet theke amount kete ad account er spend cap baribe"
6. **Ad Account Detail** (or remaining column highlight on list):
   - "Remaining" / "Spend Cap" column highlight: "Ekhane remaining limit dekhben"
7. **Finish** — "Ei holo full flow! Kono problem hole support e message korun."

Pratyek step e:
- Target element er charpashe **highlight ring** (spotlight)
- Ekta floating **animated mouse cursor SVG** target e slide kore jabe, click effect (ripple) dekhabe
- Niche/upore **Bangla tooltip** with "Pichone", "Porer", "Skip" buttons
- Auto-advance off; user "Porer" click korle next step (nav step gulo auto navigate korbe)

## Technical approach

**Library**: [Driver.js](https://driverjs.com) (lightweight, ~5kb, popup+spotlight built-in, supports custom HTML, route navigation between steps via `onNextClick` callback). Bun add `driver.js`.

**Custom animated cursor**: Driver.js spotlight er sathe ekta nijer banano `<TutorialCursor />` overlay component — ekta `motion`/CSS-animated SVG cursor je current target er coordinate te `transform: translate()` diye slide kore jay, click hole scale pulse + ripple. Position calculate korbo `getBoundingClientRect()` diye, target change hole re-position.

**Files to create**:
- `src/lib/tutorial/steps.ts` — Bangla step definitions: `{ route, selector, title, description }[]`
- `src/lib/tutorial/TutorialCursor.tsx` — animated cursor overlay (portal, z-index top)
- `src/hooks/useTutorial.ts` — Driver.js instance manager + route navigation (uses `useNavigate` from `@tanstack/react-router`), tracks current step, moves cursor
- `src/components/TutorialButton.tsx` — "📺 Tutorial dekhun" button (added to ClientDashboard header area)

**Files to edit**:
- `src/components/client/ClientDashboard.tsx` — top e TutorialButton add
- Target elements e `data-tutorial="topup-amount"`, `data-tutorial="topup-bank"`, etc. attribute add korte hobe (selector stability er jonno):
  - `ClientTopUp.tsx` (amount, bank, upload, submit)
  - `ClientWallet.tsx` (balance card, history table)
  - `ClientAdAccounts.tsx` (first card, top-up button)
  - `AppSidebar.tsx` (Top-Up, Wallet, Ad Accounts nav items)

**Route navigation between steps**: Step config e `route: "/wallet"` thakle `onNextClick` te first navigate, then 400ms wait kore next highlight (target render hoyar somoy).

**Mobile vs Desktop**: User mobile (384px) e ase. Sidebar mobile e drawer, kaajei sidebar-nav step gulo te age sidebar trigger button click korbe (auto, programmatically), then nav item highlight. Tooltip position bottom e auto-fit korbe.

**No backend / DB changes**. Pure frontend. Locked flows (top-up verify, forwarding) untouched.

## Out of scope
- Real submission kora — tutorial te kichu submit hobe na, sudhu UI walkthrough
- Video file generation
- Auto-trigger on first login (manual button only, jemon tumi bolecho)

## Acceptance
- Client dashboard e "Tutorial dekhun" button drishyo
- Button click → cursor animation start, Bangla tooltips show
- Cursor automatic Top-Up → Wallet → Ad Accounts page e navigate kore highlight kore
- "Skip" e bondho hoy, "Pichone"/"Porer" diye step nav kora jay
- Mobile (384px) o desktop dutotei kaj kore
