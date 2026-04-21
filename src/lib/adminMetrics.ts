/**
 * Pure helpers to aggregate admin performance metrics from raw rows
 * fetched from system_logs / chat_messages / etc.
 */

export type SystemLogRow = {
  id: string;
  action: string;
  details: string | null;
  user_id: string | null;
  user_name: string | null;
  created_at: string;
};

export type ChatMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  created_at: string;
};

export type AdminMetric = {
  user_id: string;
  user_name: string;
  total: number;
  topupsApproved: number;
  topupsRejected: number;
  topupsOnHold: number;
  accountsAssigned: number;
  failedSolved: number;
  bmApproved: number;
  bmRejected: number;
  spendCapUpdates: number;
  withdraws: number;
  chatReplies: number;
  avgResponseSec: number | null;
};

const TOPUP_APPROVED = ["Top-Up Approved", "Auto Top-Up"];
const TOPUP_REJECTED = ["Top-Up Rejected"];
const TOPUP_ONHOLD = ["Top-Up On Hold"];
const ACCOUNTS_ASSIGNED = ["Ad Account Assigned", "Ad Account Request Approved"];
const FAILED_SOLVED = ["Failed Top-Up Retry", "Failed Top-Up Refund"];
const BM_APPROVED = ["BM Access Approved"];
const BM_REJECTED = ["BM Access Rejected"];
const SPEND_CAP = ["Spend Cap Updated"];
const WITHDRAW = ["Withdraw"];

export const ACTION_CATEGORIES = {
  topups: [...TOPUP_APPROVED, ...TOPUP_REJECTED, ...TOPUP_ONHOLD, "Top-Up Failed"],
  accounts: [
    ...ACCOUNTS_ASSIGNED,
    "Ad Account Unassigned",
    "Ad Account Deleted",
    ...SPEND_CAP,
    ...WITHDRAW,
    ...FAILED_SOLVED,
  ],
  requests: [
    "Ad Account Request Approved",
    "Ad Account Request Rejected",
    ...BM_APPROVED,
    ...BM_REJECTED,
  ],
  banks: ["Bank Added", "Bank Updated"],
};

function inc<T extends string>(map: Record<string, number>, key: T) {
  map[key] = (map[key] ?? 0) + 1;
}

export function computeAdminMetrics(
  logs: SystemLogRow[],
  chatMessages: ChatMessageRow[],
  adminIds: Set<string>,
): AdminMetric[] {
  const byAdmin: Record<string, AdminMetric> = {};

  const ensure = (id: string, name: string): AdminMetric => {
    if (!byAdmin[id]) {
      byAdmin[id] = {
        user_id: id,
        user_name: name || "Unknown",
        total: 0,
        topupsApproved: 0,
        topupsRejected: 0,
        topupsOnHold: 0,
        accountsAssigned: 0,
        failedSolved: 0,
        bmApproved: 0,
        bmRejected: 0,
        spendCapUpdates: 0,
        withdraws: 0,
        chatReplies: 0,
        avgResponseSec: null,
      };
    } else if (name && byAdmin[id].user_name === "Unknown") {
      byAdmin[id].user_name = name;
    }
    return byAdmin[id];
  };

  for (const log of logs) {
    if (!log.user_id) continue;
    if (adminIds.size > 0 && !adminIds.has(log.user_id)) continue;
    const m = ensure(log.user_id, log.user_name ?? "");
    m.total += 1;

    if (TOPUP_APPROVED.includes(log.action)) m.topupsApproved += 1;
    else if (TOPUP_REJECTED.includes(log.action)) m.topupsRejected += 1;
    else if (TOPUP_ONHOLD.includes(log.action)) m.topupsOnHold += 1;
    else if (ACCOUNTS_ASSIGNED.includes(log.action)) m.accountsAssigned += 1;
    else if (FAILED_SOLVED.includes(log.action)) m.failedSolved += 1;
    else if (BM_APPROVED.includes(log.action)) m.bmApproved += 1;
    else if (BM_REJECTED.includes(log.action)) m.bmRejected += 1;
    else if (SPEND_CAP.includes(log.action)) m.spendCapUpdates += 1;
    else if (WITHDRAW.includes(log.action)) m.withdraws += 1;
  }

  // Chat replies & avg response time
  // Group messages by conversation, sort by time, and for each admin reply,
  // measure time since the previous client message.
  const byConv: Record<string, ChatMessageRow[]> = {};
  for (const msg of chatMessages) {
    (byConv[msg.conversation_id] ||= []).push(msg);
  }

  const responseSecsByAdmin: Record<string, number[]> = {};

  for (const conv of Object.values(byConv)) {
    conv.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let lastClientAt: number | null = null;
    for (const msg of conv) {
      const isAdmin = adminIds.has(msg.sender_id);
      if (!isAdmin) {
        lastClientAt = new Date(msg.created_at).getTime();
      } else {
        const m = ensure(msg.sender_id, "");
        m.chatReplies += 1;
        if (lastClientAt !== null) {
          const diff = (new Date(msg.created_at).getTime() - lastClientAt) / 1000;
          if (diff >= 0 && diff < 60 * 60 * 24) {
            (responseSecsByAdmin[msg.sender_id] ||= []).push(diff);
          }
          lastClientAt = null; // only first admin reply counts
        }
      }
    }
  }

  for (const [id, secs] of Object.entries(responseSecsByAdmin)) {
    if (secs.length === 0) continue;
    const avg = secs.reduce((a, b) => a + b, 0) / secs.length;
    if (byAdmin[id]) byAdmin[id].avgResponseSec = avg;
  }

  return Object.values(byAdmin).sort((a, b) => b.total - a.total);
}

export function categoryBreakdown(logs: SystemLogRow[], userId?: string) {
  const filtered = userId ? logs.filter(l => l.user_id === userId) : logs;
  const counts = { topups: 0, accounts: 0, requests: 0, banks: 0, other: 0 };
  for (const l of filtered) {
    if (ACTION_CATEGORIES.topups.includes(l.action)) counts.topups += 1;
    else if (ACTION_CATEGORIES.accounts.includes(l.action)) counts.accounts += 1;
    else if (ACTION_CATEGORIES.requests.includes(l.action)) counts.requests += 1;
    else if (ACTION_CATEGORIES.banks.includes(l.action)) counts.banks += 1;
    else counts.other += 1;
  }
  return [
    { name: "Top-Ups", value: counts.topups },
    { name: "Ad Accounts", value: counts.accounts },
    { name: "Requests", value: counts.requests },
    { name: "Banks", value: counts.banks },
    { name: "Other", value: counts.other },
  ];
}

export function dailyActivity(logs: SystemLogRow[], userId?: string, days = 30) {
  const filtered = userId ? logs.filter(l => l.user_id === userId) : logs;
  const today = new Date();
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = 0;
  }
  for (const l of filtered) {
    const key = l.created_at.slice(0, 10);
    if (key in buckets) buckets[key] += 1;
  }
  return Object.entries(buckets).map(([date, count]) => ({ date: date.slice(5), count }));
}

export function formatResponseTime(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}
