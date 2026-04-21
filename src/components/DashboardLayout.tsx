import React from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ColorThemePicker } from "@/components/ColorThemePicker";
import { Zap } from "lucide-react";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { logoUrl, headerAnnouncement, announcementColor, announcementSize } = useSiteSettings();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card/80 backdrop-blur-sm px-4 sticky top-0 z-30">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <SidebarTrigger />
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="h-7 w-7 rounded object-contain flex-shrink-0" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded bg-primary flex-shrink-0">
                  <Zap className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
              )}
              {headerAnnouncement && (
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
              )}
            </div>
            <div className="flex items-center gap-2">
              <ColorThemePicker />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 p-3 md:p-6 overflow-auto">
            <div className="mx-auto max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
