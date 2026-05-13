export type TutorialStep = {
  /** Optional centered "info screen" — no selector needed */
  info?: boolean;
  route?: string;
  selector?: string;
  title: string;
  description: string;
  /** Caption tweak for mobile view (overrides description on small screens) */
  mobileDescription?: string;
  /** wait this many ms after route change before searching for the selector */
  waitMs?: number;
  /** click animation on the target (visual only) */
  click?: boolean;
  /** optional: open mobile sidebar before highlighting */
  openSidebar?: boolean;
};

export type TutorialFlow = {
  id: string;
  title: string;
  description: string;
  icon: string;
  steps: TutorialStep[];
};

const loginIntro: TutorialStep = {
  info: true,
  title: "ধাপ ১ — Login করুন",
  description: "প্রথমে আপনার ইমেইল ও পাসওয়ার্ড দিয়ে CRM-এ Login করুন। (আপনি এখন ইতিমধ্যে login করা আছেন ✓)",
};

const dashboardLanding: TutorialStep = {
  route: "/dashboard",
  selector: "[data-tutorial='dashboard-welcome']",
  title: "ধাপ ২ — Dashboard",
  description: "Login করার পর প্রথমেই Dashboard দেখাবে। এখান থেকে আপনি সব মেনুতে যেতে পারবেন।",
};

// ───────────────────────── FLOW 1: Dashboard পরিচিতি ─────────────────────────
const dashboardTour: TutorialStep[] = [
  loginIntro,
  dashboardLanding,
  { selector: "[data-tutorial='card-wallet']", title: "১. Wallet Balance", description: "এখানে আপনার Wallet-এ কত টাকা আছে দেখাবে। Top-Up approve হলে এখানে যোগ হবে।" },
  { selector: "[data-tutorial='card-ad-accounts']", title: "২. Ad Accounts", description: "আপনার মোট কতটা Ad Account আছে।" },
  { selector: "[data-tutorial='card-remaining']", title: "৩. Remaining", description: "সব Ad Account এর মোট remaining (বাকি) spend limit।" },
  { selector: "[data-tutorial='card-today-spend']", title: "৪. Today Spend", description: "আজকের দিনে মোট কত খরচ হয়েছে।" },
  { selector: "[data-tutorial='card-today-orders']", title: "৫. Today Orders", description: "আজকের দিনে কতটা order এসেছে।" },
  { selector: "[data-tutorial='card-total-topup']", title: "৬. Total Top-Up", description: "এখন পর্যন্ত মোট কত Top-Up করেছেন।" },
  { selector: "[data-tutorial='card-total-spend']", title: "৭. Total Spend", description: "All time / নির্দিষ্ট সময়ের মোট spend। Calendar আইকন দিয়ে date range সিলেক্ট করতে পারবেন।" },
  { info: true, title: "শেষ! 🎉", description: "এই ৭টা card-ই Dashboard-এর main overview। বাকি কাজ Sidebar মেনু থেকে করবেন।" },
];

// ───────────────────────── FLOW 2: Top-Up Request দেওয়া ─────────────────────────
const topUpFlow: TutorialStep[] = [
  loginIntro,
  dashboardLanding,
  {
    openSidebar: true,
    selector: "[data-tutorial='nav-top-up']",
    title: "ধাপ ৩ — Sidebar → Top-Up Request",
    description: "বাঁদিকের Sidebar থেকে 'Top-Up Request' মেনুতে ক্লিক করুন।",
    mobileDescription: "উপরে hamburger menu (☰) ট্যাপ করে drawer খুলুন → 'Top-Up Request' এ ট্যাপ করুন।",
    click: true,
  },
  {
    route: "/top-up",
    waitMs: 700,
    selector: "[data-tutorial='topup-form']",
    title: "ধাপ ৪ — Payment Type সিলেক্ট",
    description: "প্রথমে 'Bank Transfer' অথবা 'MFS (bKash/Nagad)' সিলেক্ট করুন।",
  },
  {
    selector: "[data-tutorial='topup-form']",
    title: "ধাপ ৫ — Sub-method (NPSB / MFS→Bank)",
    description: "Bank Transfer হলে → Online Transfer → তারপর 'NPSB' অথবা 'bKash/Nagad → Bank' সিলেক্ট করুন।",
  },
  {
    selector: "[data-tutorial='topup-form']",
    title: "ধাপ ৬ — Bank Account সিলেক্ট",
    description: "যেই bank/MFS account-এ পেমেন্ট পাঠাবেন সেটা সিলেক্ট করুন।",
  },
  {
    selector: "[data-tutorial='topup-form']",
    title: "ধাপ ৭ — Amount এবং Screenshot Upload",
    description: "Amount (টাকা) লিখুন → Payment receipt/screenshot upload করুন। OCR দিয়ে sender, amount, transaction ID auto-extract হবে।",
  },
  {
    selector: "[data-tutorial='topup-form']",
    title: "ধাপ ৮ — Review & Submit",
    description: "Extract হওয়া info review করে 'Submit' করুন। Telegram SMS-এর সাথে মিলিয়ে সিস্টেম auto-approve করবে।",
  },
  { info: true, title: "শেষ! 🎉", description: "Approve হলে আপনার Wallet-এ balance যোগ হবে — Dashboard-এর Wallet Balance card-এ দেখতে পাবেন।" },
];

// ───────────────────────── FLOW 3: Ad Account এ Top-Up ─────────────────────────
const adAccountTopUp: TutorialStep[] = [
  loginIntro,
  dashboardLanding,
  {
    openSidebar: true,
    selector: "[data-tutorial='nav-ad-accounts']",
    title: "ধাপ ৩ — Sidebar → Ad Accounts",
    description: "বাঁদিকের Sidebar থেকে 'Ad Accounts' মেনুতে ক্লিক করুন।",
    mobileDescription: "Hamburger menu (☰) থেকে 'Ad Accounts' এ ট্যাপ করুন।",
    click: true,
  },
  {
    route: "/ad-accounts",
    waitMs: 800,
    selector: "[data-tutorial='ad-account-topup-btn']",
    title: "ধাপ ৪ — Top Up বাটন",
    description: "যেই Ad Account-এ Top-Up করতে চান তার পাশে নীল 'Top Up' বাটন আছে — সেটায় ক্লিক করুন।",
    click: true,
  },
  { info: true, title: "ধাপ ৫ — Amount দিন", description: "Pop-up এ amount লিখুন → Confirm ক্লিক করুন। Wallet থেকে কেটে সেই Ad Account-এর Spend Cap বাড়বে।" },
  { info: true, title: "শেষ! 🎉", description: "Top-Up successful হলে Ad Account-এর Remaining বেড়ে যাবে।" },
];

// ───────────────────────── FLOW 4: Ad Account Rename ─────────────────────────
const renameFlow: TutorialStep[] = [
  loginIntro,
  dashboardLanding,
  {
    openSidebar: true,
    selector: "[data-tutorial='nav-ad-accounts']",
    title: "ধাপ ৩ — Sidebar → Ad Accounts",
    description: "বাঁদিকের Sidebar থেকে 'Ad Accounts' মেনুতে যান।",
    mobileDescription: "Hamburger menu (☰) → 'Ad Accounts'।",
    click: true,
  },
  {
    route: "/ad-accounts",
    waitMs: 800,
    selector: "[data-tutorial='ad-account-3dot']",
    title: "ধাপ ৪ — 3-dot মেনু",
    description: "Top Up বাটনের পাশে ⋮ (three-dot) আইকন আছে — সেটায় ক্লিক করুন।",
    click: true,
  },
  {
    waitMs: 400,
    selector: "[data-tutorial='ad-account-rename']",
    title: "ধাপ ৫ — Rename অপশন",
    description: "Drop-down মেনুতে 'Rename' অপশন আসবে — সেটায় ক্লিক করুন।",
    click: true,
  },
  { info: true, title: "ধাপ ৬ — নতুন নাম", description: "Pop-up dialog-এ নতুন নাম লিখুন → Save ক্লিক করুন। Ad Account এর নাম পরিবর্তন হয়ে যাবে।" },
  { info: true, title: "শেষ! 🎉", description: "একইভাবে 'Request BM Access' বা 'Request Spend Cap Withdraw' ও এই 3-dot মেনু থেকে করতে পারবেন।" },
];

// ───────────────────────── FLOW 5: Theme / Color পরিবর্তন ─────────────────────────
const themeFlow: TutorialStep[] = [
  loginIntro,
  dashboardLanding,
  {
    selector: "[data-tutorial='theme-picker-trigger']",
    title: "ধাপ ৩ — Color Theme আইকন",
    description: "উপরে ডানদিকে 🎨 (palette) আইকন আছে — সেটায় ক্লিক করুন।",
    click: true,
  },
  {
    waitMs: 400,
    selector: "[data-tutorial='theme-picker-trigger']",
    title: "ধাপ ৪ — Color সিলেক্ট",
    description: "Drop-down মেনুতে ৩টা color option পাবেন — Blue 🔵 / Orange 🟠 / Green 🟢। যেকোনোটায় ক্লিক করুন।",
  },
  {
    info: true,
    title: "ধাপ ৫ — Dark / Light Mode",
    description: "পাশেই sun/moon আইকন আছে — সেটায় ক্লিক করে Dark অথবা Light mode toggle করতে পারবেন।",
  },
  { info: true, title: "শেষ! 🎉", description: "আপনার preferred theme সেভ হয়ে থাকবে — পরের বার login করলেও থাকবে।" },
];

// ───────────────────────── FLOW 6: BM Access / Spend Cap Withdraw Request ─────────────────────────
const requestActionsFlow: TutorialStep[] = [
  loginIntro,
  dashboardLanding,
  {
    openSidebar: true,
    selector: "[data-tutorial='nav-ad-accounts']",
    title: "ধাপ ৩ — Sidebar → Ad Accounts",
    description: "Sidebar থেকে 'Ad Accounts' এ যান।",
    mobileDescription: "Hamburger menu (☰) → 'Ad Accounts'।",
    click: true,
  },
  {
    route: "/ad-accounts",
    waitMs: 800,
    selector: "[data-tutorial='ad-account-3dot']",
    title: "ধাপ ৪ — 3-dot মেনু",
    description: "যেই account-এ request দিতে চান, তার পাশের ⋮ আইকনে ক্লিক করুন।",
    click: true,
  },
  {
    info: true,
    title: "ধাপ ৫ — অপশন বেছে নিন",
    description: "Drop-down এ পাবেন: Rename / Request BM Access / Request Spend Cap Withdraw / Auto Top-Up। যেটা দরকার সেটায় ক্লিক করুন।",
  },
  { info: true, title: "শেষ! 🎉", description: "Form fill up করে submit দিন। Admin approve করলে action নেওয়া হবে।" },
];

export const tutorialFlows: TutorialFlow[] = [
  { id: "dashboard", icon: "📊", title: "Dashboard পরিচিতি", description: "৭টা card-এর মানে কী", steps: dashboardTour },
  { id: "topup", icon: "💳", title: "Top-Up Request দেওয়া", description: "Wallet-এ টাকা যোগ করার পদ্ধতি", steps: topUpFlow },
  { id: "ad-topup", icon: "🚀", title: "Ad Account-এ Top-Up", description: "Wallet থেকে Ad Account-এ পাঠানো", steps: adAccountTopUp },
  { id: "rename", icon: "✏️", title: "Ad Account Rename", description: "Account এর নাম পরিবর্তন", steps: renameFlow },
  { id: "theme", icon: "🎨", title: "Theme / Color পরিবর্তন", description: "Blue, Orange, Green theme সিলেক্ট", steps: themeFlow },
  { id: "requests", icon: "📩", title: "BM Access / Withdraw Request", description: "3-dot menu থেকে অন্য request", steps: requestActionsFlow },
];

// Backward compatibility (Tutorial.tsx still imports clientTutorialSteps)
export const clientTutorialSteps: TutorialStep[] = topUpFlow;
