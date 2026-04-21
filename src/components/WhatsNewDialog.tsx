import { useEffect, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Announcement = {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  created_at: string;
  target_type: string;
  target_user_ids: string[] | null;
  active: boolean;
  expires_at: string | null;
};

const sessionKey = (userId: string) => `ann-shown-session:${userId}`;

export function WhatsNewDialog() {
  const { user } = useAuth();
  const [skippedIds, setSkippedIds] = useState<string[]>(() => {
    if (!user) return [];
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey(user.id)) ?? "[]");
    } catch {
      return [];
    }
  });

  const { data: announcements } = useQuery({
    queryKey: ["pending-announcements", user?.id],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data: anns, error } = await (supabase as any)
        .from("announcements")
        .select("id, title, body, image_url, created_at, target_type, target_user_ids, active, expires_at")
        .eq("active", true)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const { data: dismissals } = await (supabase as any)
        .from("announcement_dismissals")
        .select("announcement_id, dismissed_permanently")
        .eq("user_id", user!.id)
        .eq("dismissed_permanently", true);

      const dismissedIds = new Set(
        (dismissals ?? []).map((d: any) => d.announcement_id),
      );

      return ((anns ?? []) as Announcement[]).filter((a) => {
        if (dismissedIds.has(a.id)) return false;
        if (a.expires_at && a.expires_at < nowIso) return false;
        // Targeting check — only show to intended user(s)
        if (a.target_type === "specific") {
          const ids = a.target_user_ids ?? [];
          if (!ids.includes(user!.id)) return false;
        }
        return true;
      });
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const queue = useMemo(
    () => (announcements ?? []).filter((a) => !skippedIds.includes(a.id)),
    [announcements, skippedIds],
  );

  const current = queue[0];
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (current) {
      const t = setTimeout(() => setOpen(true), 500);
      return () => clearTimeout(t);
    }
    setOpen(false);
  }, [current?.id]);

  if (!user || !current || !open) return null;

  const dismiss = async (permanent: boolean) => {
    if (permanent) {
      try {
        await (supabase as any)
          .from("announcement_dismissals")
          .upsert(
            {
              announcement_id: current.id,
              user_id: user.id,
              dismissed_permanently: true,
            },
            { onConflict: "announcement_id,user_id" },
          );
      } catch {
        // fall back to session-only skip
      }
    }
    const next = [...skippedIds, current.id];
    setSkippedIds(next);
    try {
      sessionStorage.setItem(sessionKey(user.id), JSON.stringify(next));
    } catch {}
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in"
      onClick={() => dismiss(false)}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border bg-background shadow-2xl animate-in zoom-in-95 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => dismiss(false)}
          className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1.5 text-muted-foreground backdrop-blur hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="overflow-y-auto px-5 pt-5 pb-3">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-lg">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="text-center text-lg font-semibold leading-tight">{current.title}</h2>
          {current.body && (
            <p className="mt-2 whitespace-pre-wrap text-center text-sm text-muted-foreground">
              {current.body}
            </p>
          )}

          {current.image_url && (
            <div className="mt-3 overflow-hidden rounded-lg border bg-muted">
              <img
                src={current.image_url}
                alt={current.title}
                className="mx-auto block max-h-[35vh] w-auto max-w-full object-contain"
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t bg-muted/30 px-5 py-3 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dismiss(true)}
            className="w-full sm:w-auto"
          >
            Never show again
          </Button>
          <Button
            size="sm"
            onClick={() => dismiss(false)}
            className="w-full sm:w-auto"
          >
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}
