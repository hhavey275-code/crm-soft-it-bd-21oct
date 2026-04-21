import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck, BellRing } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "@tanstack/react-router";
import { usePushNotifications } from "@/hooks/usePushNotifications";

// Base64 encoded short notification beep (works in background tabs unlike AudioContext)
const NOTIFICATION_BEEP_DATA_URI = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgipGKdF9yq62kb1Q+XpCok3hyeqOhj2RIQWB+lZOFcXCXn5FtUUVdf5WTh3Ryn52QblNGX4CVkoh2dJ6djW1QRGB/lJOIdXWdnI1uUkVff5STiHV1nZyNblJFX3+Uk4h1dZ2cjW5SRV9/lJOIdXWdnI1uUkVff5STiHV1nZyNblJFX3+Uk4h1dZ2cjW5SRV9/lJOIdXWdnI1uUkVff5STiHV1nZyNblJF";

// Pre-create Audio element for reliable background-tab playback
let _notifAudio: HTMLAudioElement | null = null;

function getPreferredSoundSource(): string {
  return localStorage.getItem("notification_sound_url") || NOTIFICATION_BEEP_DATA_URI;
}

function getNotifAudio(src: string): HTMLAudioElement {
  if (!_notifAudio || _notifAudio.src !== src) {
    _notifAudio = new Audio(src);
    _notifAudio.volume = 0.5;
    _notifAudio.preload = "auto";
  }
  return _notifAudio;
}

function playOscillatorFallback() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = "sine";
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

function playNotificationSound() {
  if (localStorage.getItem("notification_sound") === "false") return;

  const preferredSrc = getPreferredSoundSource();
  const hasCustomSound = preferredSrc !== NOTIFICATION_BEEP_DATA_URI;

  try {
    const audio = getNotifAudio(preferredSrc);

    if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        audio.currentTime = 0;
      } catch {}
    }

    audio.play().catch(() => {
      if (hasCustomSound) {
        const fallbackAudio = getNotifAudio(NOTIFICATION_BEEP_DATA_URI);
        if (fallbackAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            fallbackAudio.currentTime = 0;
          } catch {}
        }
        fallbackAudio.play().catch(() => playOscillatorFallback());
      } else {
        playOscillatorFallback();
      }
    });
  } catch {
    playOscillatorFallback();
  }
}

export function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { isSupported, isSubscribed, permission, subscribe } = usePushNotifications();
  const lastNotifiedIdRef = useRef<string | null>(null);

  // Auto-subscribe to push on first visit if permission already granted
  useEffect(() => {
    if (isSupported && !isSubscribed && permission === "granted" && user) {
      subscribe();
    }
  }, [isSupported, isSubscribed, permission, user, subscribe]);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data as any[]) ?? [];
    },
    enabled: !!user,
    refetchInterval: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  // Polling fallback sound trigger (handles missed realtime events)
  useEffect(() => {
    if (!notifications.length) return;

    const latestId = notifications[0]?.id as string | undefined;
    if (!latestId) return;

    if (!lastNotifiedIdRef.current) {
      lastNotifiedIdRef.current = latestId;
      return;
    }

    if (latestId !== lastNotifiedIdRef.current) {
      lastNotifiedIdRef.current = latestId;
      playNotificationSound();
    }
  }, [notifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const insertedId = payload?.new?.id as string | undefined;
          if (insertedId && insertedId !== lastNotifiedIdRef.current) {
            lastNotifiedIdRef.current = insertedId;
            playNotificationSound();
          }

          queryClient.invalidateQueries({ queryKey: ["notifications", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const markAllRead = useMutation({
    mutationFn: async () => {
      await (supabase as any)
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user!.id)
        .eq("is_read", false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
    },
  });

  const handleClick = (n: any) => {
    (supabase as any)
      .from("notifications")
      .update({ is_read: true })
      .eq("id", n.id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
      });
    setOpen(false);

    // Smart routing based on notification type
    const type = n.type as string;
    if (type === "chat_message") {
      navigate("/chat");
    } else if (type === "client_status") {
      navigate("/dashboard");
    } else if (type === "new_signup") {
      navigate("/clients");
    } else {
      navigate("/top-up");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* Push notification prompt */}
        {isSupported && !isSubscribed && permission !== "denied" && (
          <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-2.5">
            <BellRing className="h-4 w-4 text-primary shrink-0" />
            <p className="text-xs text-muted-foreground flex-1">Enable push notifications to get alerts on your phone</p>
            <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => subscribe()}>
              Enable
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => markAllRead.mutate()}>
              <CheckCheck className="h-3 w-3" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No notifications</p>}
          {notifications.map((n: any) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors ${!n.is_read ? "bg-primary/5" : ""}`}
            >
              <p className="text-sm font-medium">{n.title}</p>
              {n.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
              <p className="text-xs text-muted-foreground mt-1">{format(new Date(n.created_at), "MMM d, h:mm a")}</p>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
