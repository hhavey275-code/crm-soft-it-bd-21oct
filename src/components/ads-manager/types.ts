export interface PageOption {
  id: string;
  name: string;
  category?: string;
  picture?: { data?: { url?: string }; url?: string } | null;
  picture_url?: string;
}

export interface PixelOption {
  id: string;
  name: string;
}

export interface ExistingPostPreviewData {
  id: string;
  message?: string;
  imageUrl?: string;
  permalinkUrl?: string;
  ctaType?: string;
  ctaLabel?: string;
  link?: string;
  headline?: string;
  description?: string;
}

export const CTA_NO_URL = new Set(["MESSAGE_PAGE", "SEND_MESSAGE", "WHATSAPP_MESSAGE", "CALL_NOW", "GET_DIRECTIONS", "LIKE_PAGE"]);

export function ctaRequiresUrl(cta?: string) {
  return !cta || !CTA_NO_URL.has(cta);
}

export const CONVERSION_EVENT_OPTIONS = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "INITIATE_CHECKOUT", label: "Initiate Checkout" },
  { value: "ADD_TO_CART", label: "Add To Cart" },
  { value: "VIEW_CONTENT", label: "View Content" },
  { value: "LEAD", label: "Lead" },
  { value: "COMPLETE_REGISTRATION", label: "Complete Registration" },
];

// =====================================================================
// Destination / Performance Goal options per Objective
// Each maps directly to Meta's API parameters (optimization_goal, destination_type, CTA)
// =====================================================================

export interface DestinationOption {
  value: string;            // internal id, sent to backend
  label: string;            // English label
  bangla: string;           // Bangla helper
  cta: string;              // default CTA button
  needsPixel?: boolean;     // requires pixel_id
  needsWhatsapp?: boolean;  // requires whatsapp number
  needsLink?: boolean;      // requires website URL
}

export const DESTINATION_OPTIONS: Record<string, DestinationOption[]> = {
  OUTCOME_SALES: [
    {
      value: "WEBSITE_PURCHASE",
      label: "Website Purchase (Pixel)",
      bangla: "Website-এ purchase track করতে — Pixel লাগবে। সবচেয়ে accurate sales tracking.",
      cta: "SHOP_NOW",
      needsPixel: true,
      needsLink: true,
    },
    {
      value: "MESSENGER_SALES",
      label: "Messenger Sales (Click-to-Message)",
      bangla: "Customer Messenger-এ message করে order করবে। Pixel লাগবে না।",
      cta: "SEND_MESSAGE",
    },
    {
      value: "WHATSAPP_SALES",
      label: "WhatsApp Sales (Click-to-WhatsApp)",
      bangla: "Customer WhatsApp-এ direct চ্যাট করবে। WhatsApp number দিতে হবে।",
      cta: "WHATSAPP_MESSAGE",
      needsWhatsapp: true,
    },
  ],
  OUTCOME_TRAFFIC: [
    {
      value: "WEBSITE_TRAFFIC",
      label: "Website Visits",
      bangla: "Website-এ link click বাড়ানোর জন্য — সবচেয়ে common.",
      cta: "LEARN_MORE",
      needsLink: true,
    },
    {
      value: "LANDING_PAGE_VIEWS",
      label: "Landing Page Views",
      bangla: "যারা পুরো landing page load হওয়া পর্যন্ত wait করে শুধু তাদের target করবে।",
      cta: "LEARN_MORE",
      needsLink: true,
    },
    {
      value: "MESSENGER_TRAFFIC",
      label: "Messenger Conversations",
      bangla: "Messenger-এ conversation শুরু করানোর জন্য।",
      cta: "SEND_MESSAGE",
    },
    {
      value: "WHATSAPP_TRAFFIC",
      label: "WhatsApp Conversations",
      bangla: "WhatsApp চ্যাট শুরু করানোর জন্য।",
      cta: "WHATSAPP_MESSAGE",
      needsWhatsapp: true,
    },
  ],
  OUTCOME_ENGAGEMENT: [
    {
      value: "MESSENGER_MESSAGES",
      label: "Messenger Messages",
      bangla: "Click-to-Messenger ad — customer Page-এ Messenger message পাঠাবে।",
      cta: "SEND_MESSAGE",
    },
    {
      value: "WHATSAPP_MESSAGES",
      label: "WhatsApp Messages",
      bangla: "Click-to-WhatsApp ad — Page-এ WhatsApp number setup থাকতে হবে।",
      cta: "WHATSAPP_MESSAGE",
      needsWhatsapp: true,
    },
    {
      value: "POST_ENGAGEMENT",
      label: "Post Engagement (Likes / Comments / Shares)",
      bangla: "Post-এ যত বেশি like, comment, share পাওয়া যায় সেদিকে optimize করবে।",
      cta: "LIKE_PAGE",
    },
    {
      value: "VIDEO_VIEWS",
      label: "Video Views",
      bangla: "Video post-এর জন্য — যারা ভিডিও দেখবে তাদের target করবে। Existing video post select করুন।",
      cta: "WATCH_MORE",
    },
  ],
  OUTCOME_LEADS: [
    {
      value: "WEBSITE_LEADS",
      label: "Website Leads (Pixel)",
      bangla: "Website-এ form fill করানোর জন্য — Pixel-এ Lead event লাগবে।",
      cta: "SIGN_UP",
      needsPixel: true,
      needsLink: true,
    },
    {
      value: "MESSENGER_LEADS",
      label: "Messenger Leads",
      bangla: "Messenger-এ inquiry / lead collect করানোর জন্য।",
      cta: "SEND_MESSAGE",
    },
    {
      value: "WHATSAPP_LEADS",
      label: "WhatsApp Leads",
      bangla: "WhatsApp-এ lead generate করানোর জন্য।",
      cta: "WHATSAPP_MESSAGE",
      needsWhatsapp: true,
    },
  ],
  OUTCOME_AWARENESS: [
    {
      value: "REACH",
      label: "Reach (Maximize Unique People)",
      bangla: "যত বেশি সম্ভব unique মানুষকে দেখানো হবে — সবচেয়ে common awareness goal.",
      cta: "LEARN_MORE",
    },
    {
      value: "BRAND_AWARENESS",
      label: "Brand Awareness (Ad Recall Lift)",
      bangla: "যারা ad-টা মনে রাখবে এমন মানুষদের target করবে — brand recognition build করতে।",
      cta: "LEARN_MORE",
    },
    {
      value: "IMPRESSIONS",
      label: "Impressions (Maximum Views)",
      bangla: "সবচেয়ে cheap — যত বেশি বার দেখানো যায় ততবার দেখাবে (একই ব্যক্তি অনেকবার দেখতে পারে).",
      cta: "LEARN_MORE",
    },
    {
      value: "VIDEO_VIEWS",
      label: "Video Views (ThruPlay)",
      bangla: "Video awareness-এর জন্য — যারা পুরো video দেখবে তাদের target করবে।",
      cta: "WATCH_MORE",
    },
  ],
  OUTCOME_APP_PROMOTION: [
    {
      value: "APP_INSTALLS",
      label: "App Installs",
      bangla: "নতুন user-দের app install করানো (App Store / Play Store URL দরকার).",
      cta: "DOWNLOAD",
      needsLink: true,
    },
  ],
};

export function getDestinationsForObjective(objective: string): DestinationOption[] {
  return DESTINATION_OPTIONS[objective] || [];
}

export function getDestinationOption(objective: string, value: string): DestinationOption | undefined {
  return getDestinationsForObjective(objective).find((d) => d.value === value);
}

export function requiresPixelForObjective(objective?: string, destination?: string) {
  if (!objective) return false;
  const opt = destination ? getDestinationOption(objective, destination) : getDestinationsForObjective(objective)[0];
  return !!opt?.needsPixel;
}

export function getPagePictureUrl(page?: PageOption | null) {
  if (!page) return undefined;
  return page.picture_url || page.picture?.data?.url || page.picture?.url;
}

// =====================================================================
// Campaign status badge config — mapped from Meta's effective_status values
// =====================================================================
export interface StatusBadgeConfig {
  label: string;
  className: string;
  pulse?: boolean;
  icon?: "check" | "pause" | "clock" | "x" | "alert" | "archive";
}

export const CAMPAIGN_STATUS_CONFIG: Record<string, StatusBadgeConfig> = {
  ACTIVE: {
    label: "Active",
    className: "bg-green-500/10 text-green-600 border-green-500/30 dark:text-green-400",
    pulse: true,
    icon: "check",
  },
  PAUSED: {
    label: "Paused",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:text-yellow-400",
    icon: "pause",
  },
  CAMPAIGN_PAUSED: {
    label: "Campaign Paused",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:text-yellow-400",
    icon: "pause",
  },
  ADSET_PAUSED: {
    label: "Adset Paused",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30 dark:text-yellow-400",
    icon: "pause",
  },
  IN_PROCESS: {
    label: "In Review",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
    pulse: true,
    icon: "clock",
  },
  PENDING_REVIEW: {
    label: "Pending Review",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
    pulse: true,
    icon: "clock",
  },
  PENDING_BILLING_INFO: {
    label: "Pending Billing",
    className: "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400",
    icon: "alert",
  },
  WITH_ISSUES: {
    label: "With Issues",
    className: "bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400",
    icon: "alert",
  },
  DISAPPROVED: {
    label: "Disapproved",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: "x",
  },
  PREAPPROVED: {
    label: "Pre-Approved",
    className: "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:text-blue-400",
    icon: "clock",
  },
  DELETED: {
    label: "Deleted",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: "x",
  },
  ARCHIVED: {
    label: "Archived",
    className: "bg-muted text-muted-foreground border-muted-foreground/20",
    icon: "archive",
  },
};

export function getCampaignStatusConfig(status?: string): StatusBadgeConfig {
  const key = (status || "").toUpperCase();
  return (
    CAMPAIGN_STATUS_CONFIG[key] || {
      label: status || "Unknown",
      className: "bg-muted text-muted-foreground border-muted-foreground/20",
    }
  );
}

export type RuleType = "spend_cap" | "cost_per_result";
export type TargetLevel = "account" | "campaign" | "adset" | "ad";
export type ResultEvent = "purchase" | "lead" | "add_to_cart" | "complete_registration";

export const RESULT_EVENT_OPTIONS: { value: ResultEvent; label: string; bangla: string }[] = [
  { value: "purchase", label: "Purchase", bangla: "Pixel-এ purchase event track হলে" },
  { value: "lead", label: "Lead", bangla: "Lead form / inquiry submit হলে" },
  { value: "add_to_cart", label: "Add to Cart", bangla: "Cart-এ add করলে" },
  { value: "complete_registration", label: "Complete Registration", bangla: "Registration complete হলে" },
];

export interface CampaignRule {
  id: string;
  account_id: string;
  campaign_id: string | null;       // null = account-wide
  campaign_name: string | null;
  max_spend: number | null;
  enabled: boolean;
  check_interval_minutes: number;
  last_checked_at: string | null;
  last_triggered_at: string | null;
  last_action: string | null;
  // CPR rule fields
  rule_type: RuleType;
  target_level: TargetLevel;
  max_cost_per_result: number | null;
  result_event: ResultEvent | null;
  min_results_required: number;
  min_spend_required: number;
  target_id: string | null;
  target_name: string | null;
}

export const CHECK_INTERVAL_OPTIONS = [
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every 1 hour" },
  { value: "120", label: "Every 2 hours" },
  { value: "180", label: "Every 3 hours" },
  { value: "240", label: "Every 4 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Every 24 hours" },
];
