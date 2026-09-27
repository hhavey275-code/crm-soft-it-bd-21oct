import { Outlet, createRootRoute, HeadContent, Scripts, Link, useLocation } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SiteVoiceAssistant } from "@/components/SiteVoiceAssistant";
import { ColorThemeProvider } from "@/contexts/ColorThemeContext";
import { AgencyBrandingProvider } from "@/contexts/AgencyBrandingContext";
import { TutorialProvider } from "@/components/TutorialProvider";
import { useEffect, useState } from "react";
import { installAppRecovery, recoverFromStaleAssets } from "@/lib/app-recovery";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function RootErrorComponent({ error }: { error: Error }) {
  console.error(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The app failed to load. This usually means your browser is holding an old cached
          version. Tap the button below to clear it and reload.
        </p>
        <button
          onClick={() => void recoverFromStaleAssets()}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Clear cache & reload
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "softitbd" },
      { name: "description", content: "Ad Account Management CRM" },
      { property: "og:title", content: "softitbd" },
      { name: "twitter:title", content: "softitbd" },
      { property: "og:description", content: "Ad Account Management CRM" },
      { name: "twitter:description", content: "Ad Account Management CRM" },
      { property: "og:image", content: "/favicon.png?v=2" },
      { name: "twitter:image", content: "/favicon.png?v=2" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png?v=2" },
      { rel: "shortcut icon", type: "image/png", href: "/favicon.png?v=2" },
      { rel: "apple-touch-icon", href: "/favicon.png?v=2" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: RootErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    installAppRecovery();
    try {
      localStorage.removeItem("app-rq-cache");
      localStorage.removeItem("site_settings_cache_v2");
    } catch (error) {
      console.warn("Legacy cache cleanup skipped", error);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ColorThemeProvider>
          <AgencyBrandingProvider>
            <AuthProvider>
              <TooltipProvider>
                <TutorialProvider>
                  <Toaster />
                  <Outlet />
                  <PublicVoiceAssistant />
                </TutorialProvider>
              </TooltipProvider>
            </AuthProvider>
          </AgencyBrandingProvider>
        </ColorThemeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function PublicVoiceAssistant() {
  const { isAdmin } = useAuth();
  const location = useLocation();
  if (isAdmin) return null;
  return <SiteVoiceAssistant showInvitation={location.pathname === "/signup" || location.pathname === "/auth"} />;
}
