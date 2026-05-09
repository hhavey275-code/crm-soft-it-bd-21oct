import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Radio, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small inline indicator showing Telegram SMS polling status.
 * - `telegram_bot_state.updated_at` → cron heartbeat (every 1 min)
 * - latest `telegram_messages.created_at` → actual SMS ingestion
 *
 * If cron is alive but no SMS ingested for >10 min, shows a warning —
 * this catches "polling alive but receiving 0 messages" silent failures
 * (e.g. SMS forwarder app dead, bot kicked from channel, allowed_updates
 * filter broken).
 */
export function TelegramPollStatus({ className }: { className?: string }) {
  const { data: heartbeat } = useQuery({
    queryKey: ["telegram-bot-state"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("telegram_bot_state")
        .select("updated_at")
        .eq("id", 1)
        .maybeSingle();
      return data as { updated_at: string } | null;
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const { data: lastMsg } = useQuery({
    queryKey: ["telegram-last-message"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("telegram_messages")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { created_at: string } | null;
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!heartbeat?.updated_at) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Radio className="h-3 w-3" />
        <span>Polling status unknown</span>
      </div>
    );
  }

  const lastPollMs = new Date(heartbeat.updated_at).getTime();
  const pollAgeSec = Math.max(0, Math.floor((now - lastPollMs) / 1000));
  const nextSec = Math.max(0, 60 - pollAgeSec);

  const lastMsgMs = lastMsg?.created_at ? new Date(lastMsg.created_at).getTime() : 0;
  const msgAgeSec = lastMsgMs ? Math.max(0, Math.floor((now - lastMsgMs) / 1000)) : Infinity;
  const msgAgeMin = Math.floor(msgAgeSec / 60);

  // Critical: polling cron itself is dead
  if (pollAgeSec > 180) {
    const mins = Math.floor(pollAgeSec / 60);
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-destructive", className)}>
        <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
        <Radio className="h-3 w-3 opacity-70" />
        <span>Polling cron stalled ({mins}m ago)</span>
      </div>
    );
  }

  // Warning: cron alive but no SMS ingested for a long time
  // (forwarder app dead, bot kicked, channel_post not delivered, etc.)
  // Only check when we actually have message read access (admins).
  if (lastMsgMs && msgAgeSec > 600) {
    return (
      <div className={cn("flex flex-col gap-0.5 text-xs", className)}>
        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" />
          <span className="font-medium">
            Polling alive but no SMS for {msgAgeMin}m — check forwarder app / bot channel access
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Radio className="h-3 w-3 opacity-70" />
          <span>
            Last poll {pollAgeSec}s ago · Last SMS {msgAgeMin}m ago
          </span>
        </div>
      </div>
    );
  }

  // Healthy: polling now
  if (pollAgeSec < 5) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400", className)}>
        <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <Radio className="h-3 w-3 opacity-70" />
        <span>
          Polling now…
          {lastMsgMs ? ` · Last SMS ${msgAgeMin < 1 ? `${msgAgeSec}s` : `${msgAgeMin}m`} ago` : ""}
        </span>
      </div>
    );
  }

  // Healthy: countdown to next poll
  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
      <Radio className="h-3 w-3 opacity-70" />
      <span>
        Last poll {pollAgeSec}s ago · Next in {nextSec}s
        {lastMsgMs ? ` · Last SMS ${msgAgeMin < 1 ? `${msgAgeSec}s` : `${msgAgeMin}m`} ago` : ""}
      </span>
    </div>
  );
}
