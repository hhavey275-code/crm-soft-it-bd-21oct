import React, { lazy, Suspense, useEffect, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatWidget } from "@/components/ChatWidget";
import { ColorThemePicker } from "@/components/ColorThemePicker";
import { WhatsNewDialog } from "@/components/WhatsNewDialog";
import { useAuth } from "@/contexts/AuthContext";
import { Zap } from "lucide-react";

const TechBackground = lazy(() => import("@/components/TechBackground"));

function useShouldRenderTechBg() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Skip on small screens — pure decoration, wastes battery
    if (window.matchMedia("(max-width: 767px)").matches) return;
    const ric: any = (window as any).requestIdleCallback || ((cb: any) => setTimeout(cb, 1000));
    const id = ric(() => setShow(true));
    return () => {
      const cic: any = (window as any).cancelIdleCallback;
      if (cic && typeof id === "number") cic(id);
    };
  }, []);
  return show;
}

export function DashboardLayout({ children, fullBleed = false, hideChat = false }: { children: React.ReactNode; fullBleed?: boolean; hideChat?: boolean }) {
  const { logoUrl, headerAnnouncement, announcementColor, announcementSize } = useSiteSettings();
  const { isAdmin } = useAuth();
  const showTechBg = useShouldRenderTechBg();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full relative">
        {showTechBg ? (
          <div className="fixed inset-0 w-screen h-screen opacity-60 pointer-events-none" style={{ zIndex: 0 }}>
            <Suspense fallback={null}>
              <TechBackground />
            </Suspense>
          </div>
        ) : null}

        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 relative z-10">
          <header className="h-14 flex items-center justify-between border-b bg-card/80 backdrop-blur-sm px-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <SidebarTrigger />
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-7 w-7 rounded object-contain flex-shrink-0" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded bg-primary flex-shrink-0">
                  <Zap className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
              )}
              {headerAnnouncement ? (
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="announcement-ticker">
                    <span
                      className={`${announcementSize || "text-sm"} font-medium whitespace-nowrap`}
                      style={{ color: announcementColor || undefined }}
                    >
                      {headerAnnouncement}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <ColorThemePicker />
              <ThemeToggle />
              <NotificationBell />
            </div>
          </header>
          <main className={fullBleed ? "flex-1 overflow-hidden" : "flex-1 p-3 md:p-6 overflow-auto"}>
            {fullBleed ? children : <div className="mx-auto max-w-[1400px]">{children}</div>}
          </main>
        </div>
      </div>
      {!isAdmin && !hideChat && <ChatWidget />}
      <WhatsNewDialog />
    </SidebarProvider>
  );
}
