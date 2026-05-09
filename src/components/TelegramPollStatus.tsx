import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small inline indicator showing Telegram SMS polling status.
 * Reads `telegram_bot_state.updated_at` (cron updates it every minute).
 */
export function TelegramPollStatus({ className }: { className?: string }) {
  const { data } = useQuery({
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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!data?.updated_at) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Radio className="h-3 w-3" />
        <span>Polling status unknown</span>
      </div>
    );
  }

  const lastMs = new Date(data.updated_at).getTime();
  const ageSec = Math.max(0, Math.floor((now - lastMs) / 1000));
  const nextSec = Math.max(0, 60 - ageSec);

  let color = "text-muted-foreground";
  let dot = "bg-blue-500";
  let label: string;

  if (ageSec < 5) {
    color = "text-green-600 dark:text-green-400";
    dot = "bg-green-500 animate-pulse";
    label = "Polling now…";
  } else if (ageSec > 180) {
    color = "text-destructive";
    dot = "bg-destructive";
    const mins = Math.floor(ageSec / 60);
    label = `Polling stalled (${mins}m ago)`;
  } else {
    dot = "bg-blue-500";
    label = `Last poll ${ageSec}s ago · Next in ${nextSec}s`;
  }

  return (
    <div className={cn("flex items-center gap-1.5 text-xs", color, className)}>
      <span className={cn("inline-block h-2 w-2 rounded-full", dot)} />
      <Radio className="h-3 w-3 opacity-70" />
      <span>{label}</span>
    </div>
  );
}
