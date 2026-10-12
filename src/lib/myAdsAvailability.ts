export type AccountAvailability = {
  canCreate: boolean;
  status: number | null;
  title: string;
  instruction: string;
};

export function myAdsAvailability(summary?: { status?: unknown; error?: string } | null, requestError?: string): AccountAvailability {
  const status = summary?.status == null ? null : Number(summary.status);
  if (summary?.error || requestError) return {
    canCreate: false, status: null,
    title: "এই ad account-এর Facebook status যাচাই করা যায়নি",
    instruction: "Account Disabled কি না নিশ্চিত হওয়া যায়নি। Facebook-এ account-এর access ও Billing দেখুন অথবা Admin-কে জানান, তারপর Refresh দিন।",
  };
  if (status === 1) return { canCreate: true, status, title: "", instruction: "" };
  if (status === 2) return {
    canCreate: false, status, title: "এই ad account Facebook-এ Disabled",
    instruction: "Facebook এই account বন্ধ করে দিয়েছে, তাই এখানে নতুন ad বানানো যাবে না। অন্য account বেছে নিন বা Admin-কে জানান।",
  };
  if (status === 3) return {
    canCreate: false, status, title: "এই ad account Unsettled (বকেয়া আছে)",
    instruction: "Facebook-এ পেমেন্ট ফেইল হয়েছে। Billing-এ গিয়ে বকেয়া পরিশোধ (Pay now) করুন, তারপর Refresh দিন।",
  };
  if (status === 100 || status === 101) return {
    canCreate: false, status, title: "এই ad account বন্ধ (Closed)",
    instruction: "এই account-এ নতুন ad বানানো যাবে না। অন্য account বেছে নিন।",
  };
  if (status != null && Number.isFinite(status)) return {
    canCreate: false, status, title: "এই ad account এখন ad চালানোর জন্য প্রস্তুত নয়",
    instruction: "Facebook-এর Account Quality ও Billing দেখুন অথবা Admin-কে জানান, তারপর Refresh দিন।",
  };
  return {
    canCreate: false, status: null, title: "Ad account-এর status যাচাই হচ্ছে",
    instruction: "Facebook-এ account চালু আছে নিশ্চিত হলে Create বাটন সক্রিয় হবে। যাচাই শেষ না হলে Refresh দিন।",
  };
}