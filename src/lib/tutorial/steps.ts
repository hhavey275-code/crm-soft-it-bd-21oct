export type TutorialStep = {
  route?: string;
  selector: string;
  title: string;
  description: string;
  /** wait this many ms after route change before searching for the selector */
  waitMs?: number;
  /** click animation on the target (visual only) */
  click?: boolean;
  /** optional: open mobile sidebar before highlighting */
  openSidebar?: boolean;
};

export const clientTutorialSteps: TutorialStep[] = [
  {
    route: "/dashboard",
    selector: "[data-tutorial='dashboard-welcome']",
    title: "স্বাগতম! 👋",
    description: "চলুন দেখি — কীভাবে Payment request দিবেন, Wallet এ ব্যালেন্স আসবে, এবং Ad Account এ Top-Up করবেন। 'পরের' বাটনে ক্লিক করুন।",
  },
  {
    openSidebar: true,
    selector: "[data-tutorial='nav-top-up']",
    title: "ধাপ ১ — Top-Up Request",
    description: "প্রথমে সাইডবার থেকে 'Top-Up Request' মেনুতে যান।",
    click: true,
  },
  {
    route: "/top-up",
    waitMs: 600,
    selector: "[data-tutorial='topup-form']",
    title: "Payment Request ফর্ম",
    description: "এখানে আপনি Bank সিলেক্ট করবেন, Amount দিবেন, এবং Payment screenshot আপলোড করবেন। সব ঠিক থাকলে Submit করবেন।",
  },
  {
    selector: "[data-tutorial='topup-form']",
    title: "অটো ভেরিফাই",
    description: "Submit করার পর সিস্টেম স্বয়ংক্রিয়ভাবে Telegram SMS এর সাথে মিলিয়ে আপনার পেমেন্ট approve করবে।",
  },
  {
    openSidebar: true,
    selector: "[data-tutorial='nav-wallet']",
    title: "ধাপ ২ — Wallet দেখুন",
    description: "Approve হয়ে গেলে আপনার ব্যালেন্স Wallet এ চলে আসবে। চলুন দেখি।",
    click: true,
  },
  {
    route: "/wallet",
    waitMs: 600,
    selector: "[data-tutorial='wallet-balance']",
    title: "Available Balance",
    description: "এখানে আপনার মোট Wallet ব্যালেন্স দেখাবে। প্রতিটা approved Top-Up এখানে যোগ হবে।",
  },
  {
    selector: "[data-tutorial='wallet-history']",
    title: "Top-Up History",
    description: "আপনার সব পুরনো Top-Up request এর স্ট্যাটাস (pending / approved / rejected) এখানে দেখতে পারবেন।",
  },
  {
    openSidebar: true,
    selector: "[data-tutorial='nav-ad-accounts']",
    title: "ধাপ ৩ — Ad Account এ Top-Up",
    description: "এখন Wallet থেকে নির্দিষ্ট Ad Account এ ব্যালেন্স পাঠাবেন। 'Ad Accounts' মেনুতে যান।",
    click: true,
  },
  {
    route: "/ad-accounts",
    waitMs: 800,
    selector: "[data-tutorial='ad-account-card']",
    title: "Ad Account লিস্ট",
    description: "এখানে আপনার সব Ad Account দেখাচ্ছে। যেটায় Top-Up করতে চান, সেটার পাশে Top-Up বাটন পাবেন।",
  },
  {
    selector: "[data-tutorial='ad-account-topup-btn']",
    title: "Top-Up বাটন",
    description: "এই বাটনে ক্লিক করে Amount লিখুন → Confirm করুন। Wallet থেকে কেটে সেই Ad Account এর Spend Cap বাড়বে।",
    click: true,
  },
  {
    selector: "[data-tutorial='ad-account-remaining']",
    title: "Remaining Balance",
    description: "এই কলামে আপনার Ad Account এর বাকি spend limit (remaining) দেখাবে। Top-Up এর পর এটা বেড়ে যাবে।",
  },
  {
    selector: "[data-tutorial='ad-account-card']",
    title: "শেষ! 🎉",
    description: "এই হলো সম্পূর্ণ flow — Payment → Wallet → Ad Account Top-Up। কোনো সমস্যা হলে Chat Support এ মেসেজ করুন।",
  },
];
