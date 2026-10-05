import {
  LayoutDashboard,
  MonitorSmartphone,
  ArrowUpCircle,
  History,
  Settings,
  LogOut,
  Zap,
  Building2,
  Landmark,
  Users,
  Receipt,
  MessageCircle,
  ScrollText,
  AlertTriangle,
  FileText,
  Store,
  Shield,
  CreditCard,
  Bot,
  Megaphone,
  MessageSquareHeart,
  Trophy,
  Wallet,
  RefreshCw,
  Archive,
  FolderLock,
  Gift,
  UserCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useSidebarBadges } from "@/hooks/useSidebarBadges";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const adminNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { title: "Ad Accounts", url: "/ad-accounts", icon: MonitorSmartphone, key: "ad-accounts" },
  { title: "Failed Top-Ups", url: "/failed-topups", icon: AlertTriangle, key: "failed-topups" },
  { title: "Problem Accounts", url: "/admin/problem-accounts", icon: AlertTriangle, key: "problem-accounts" },
  { title: "Requests", url: "/requests", icon: FileText, key: "requests" },
  { title: "Billings", url: "/billings", icon: Receipt, key: "billings" },
  { title: "Business Managers", url: "/business-managers", icon: Building2, key: "business-managers" },
  { title: "External Top-Up", url: "/external-top-up", icon: Zap, key: "external-top-up" },
  { title: "Top-Up Request", url: "/top-up", icon: ArrowUpCircle, key: "top-up" },
  { title: "Clients", url: "/clients", icon: Users, key: "clients" },
  { title: "Transactions", url: "/transactions", icon: History, key: "transactions" },
  { title: "Banks", url: "/banks", icon: Landmark, key: "banks" },
  { title: "Chat Support", url: "/chat", icon: MessageCircle, key: "chat" },
  { title: "Feedback", url: "/feedback", icon: MessageSquareHeart, key: "feedback" },
  { title: "Referral", url: "/referral", icon: Gift, key: "referral" },
  { title: "Sellers", url: "/sellers", icon: Store, key: "sellers" },
  { title: "Old Seller", url: "/old-seller", icon: Archive, key: "old-seller" },
  { title: "Accounts Audit", url: "/audit", icon: Shield, key: "audit" },
  { title: "Agencies", url: "/agencies", icon: Building2, key: "agencies" },
  { title: "Spend Report", url: "/client-spend-report", icon: Receipt, key: "spend-report" },
  { title: "Tenants", url: "/tenants", icon: Building2, key: "tenants" },
  { title: "System Log", url: "/system-logs", icon: ScrollText, key: "system-logs" },
  { title: "AI Agent", url: "/agent", icon: Bot, key: "agent" },
  { title: "Announcements", url: "/announcements", icon: Megaphone, key: "announcements" },
  { title: "Admin Performance", url: "/admin/performance", icon: Trophy, key: "admin-performance" },
  { title: "Card Vault", url: "/card-vault", icon: CreditCard, key: "card-vault" },
  { title: "Profile Stock", url: "/profile-stock", icon: UserCircle, key: "profile-stock" },
  { title: "Documents Vault", url: "/documents", icon: FolderLock, key: "documents-vault" },
  { title: "Invoice Maker", url: "/invoice-maker", icon: FileText, key: "invoice-maker" },
  { title: "Settings", url: "/settings", icon: Settings, key: "settings" },
];

const clientNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { title: "Ad Accounts", url: "/ad-accounts", icon: MonitorSmartphone, key: "ad-accounts" },
  { title: "Ads Manager", url: "/ad-accounts", icon: Megaphone, key: "ads-manager" },
  { title: "My Unused Accounts", url: "/my-unused", icon: AlertTriangle, key: "my-unused" },
  { title: "Top-Up Request", url: "/top-up", icon: ArrowUpCircle, key: "top-up" },
  { title: "Failed Top-Ups", url: "/failed-topups", icon: AlertTriangle, key: "failed-topups" },
  { title: "Transactions", url: "/transactions", icon: History, key: "transactions" },
  { title: "Buy Profile", url: "/buy-profile", icon: UserCircle, key: "buy-profile" },
  { title: "Feedback", url: "/feedback", icon: MessageSquareHeart, key: "feedback" },
  { title: "Referral", url: "/referral", icon: Gift, key: "referral" },
  { title: "Settings", url: "/settings", icon: Settings, key: "settings" },
];

const sellerNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { title: "Top-Up Requests", url: "/seller-topups", icon: ArrowUpCircle, key: "seller-topups" },
  { title: "Settings", url: "/settings", icon: Settings, key: "settings" },
];

const agencyNavItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, key: "dashboard" },
  { title: "Ad Accounts", url: "/ad-accounts", icon: MonitorSmartphone, key: "ad-accounts" },
  { title: "Failed Top-Ups", url: "/failed-topups", icon: AlertTriangle, key: "failed-topups" },
  { title: "Agency Top-Up", url: "/agency-topup", icon: Zap, key: "agency-topup" },
  { title: "Top-Up Requests", url: "/top-up", icon: ArrowUpCircle, key: "top-up" },
  { title: "Clients", url: "/clients", icon: Users, key: "clients" },
  { title: "Transactions", url: "/transactions", icon: History, key: "transactions" },
  { title: "Banks", url: "/banks", icon: Landmark, key: "banks" },
  { title: "Wallet", url: "/wallet", icon: Landmark, key: "wallet" },
  { title: "Settings", url: "/settings", icon: Settings, key: "settings" },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { signOut, profile, role, isAdmin, isSuperAdmin, isSeller, isAgency, user } = useAuth();
  const { logoUrl, siteName } = useSiteSettings();
  const badges = useSidebarBadges();

  // Fetch menu permissions for admin (non-superadmin) and client users
  const { data: menuPermissions } = useQuery({
    queryKey: ["menu-permissions", user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("menu_permissions")
        .select("menu_key")
        .eq("user_id", user!.id);
      return (data as any[])?.map((p: any) => p.menu_key) ?? [];
    },
    enabled: !!user && (role === "admin" || role === "client"),
  });

  // Referral program is off globally unless site settings say otherwise
  const { data: referralGlobalOn } = useQuery({
    queryKey: ["referral-global-enabled"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "referral_enabled")
        .maybeSingle();
      return ((data as any)?.value ?? "on") !== "off";
    },
  });



  // Check if tenant mode (is_tenant flag OR test mode enabled)
  const { data: isTenantMode } = useQuery({
    queryKey: ["is-tenant-mode-sidebar"],
    queryFn: async () => {
      const { data } = await supabase
        .from("site_settings")
        .select("key, value")
        .in("key", ["is_tenant", "master_url"]);

      const config = (data ?? []).reduce<Record<string, string>>((acc, row: any) => {
        acc[row.key] = row.value ?? "";
        return acc;
      }, {});

      if (config.is_tenant === "true" || !!config.master_url) return true;

      try {
        return localStorage.getItem("tenant_test_mode") === "true";
      } catch {
        return false;
      }
    },
    initialData: (() => {
      try {
        return localStorage.getItem("tenant_test_mode") === "true";
      } catch {
        return false;
      }
    })(),
    staleTime: 5_000,
  });

  const tenantNavItems = [
    { title: "System Top-Up", url: "/system-topup", icon: Shield, key: "system-topup" },
    { title: "Subscriptions", url: "/subscriptions", icon: CreditCard, key: "subscriptions" },
  ];

  // Keys to hide in tenant mode
  const tenantHiddenKeys = ["agencies", "sellers", "spend-report", "audit", "old-seller"];

  let navItems: typeof adminNavItems;
  if (isSuperAdmin) {
    navItems = isTenantMode ? adminNavItems.filter(i => !tenantHiddenKeys.includes(i.key)) : adminNavItems;
  } else if (role === "admin") {
    let base = adminNavItems;
    if (menuPermissions && menuPermissions.length > 0) {
      base = adminNavItems.filter(item =>
        menuPermissions.includes(item.key) ||
        (item.key === "external-top-up" && menuPermissions.includes("requests"))
      );
    }
    navItems = isTenantMode ? base.filter(i => !tenantHiddenKeys.includes(i.key)) : base;
  } else if (isAgency) {
    navItems = agencyNavItems;
  } else if (isSeller) {
    navItems = sellerNavItems;
  } else {
    // Client: filter out permission-gated items like ads-manager
    const permGatedKeys = ["ads-manager"];
    // Referral menu only for clients the admin has enabled it for
    const referralOn = referralGlobalOn !== false && !!(profile as any)?.referral_enabled;
    navItems = clientNavItems.filter(item =>
      (item.key !== "referral" || referralOn) &&
      (!permGatedKeys.includes(item.key) || (menuPermissions && menuPermissions.includes(item.key)))
    );
  }

  // Documents Vault: only show for the whitelisted vault-owner email.
  const ownerEmail = "maksudurrahaman64@gmail.com";
  const isVaultOwner = (profile?.email ?? "").toLowerCase() === ownerEmail;
  if (!isVaultOwner) {
    navItems = navItems.filter(i => i.key !== "documents-vault");
  }

  // Inject tenant-only menus after Dashboard if tenant mode
  if (isAdmin && isTenantMode) {
    const dashIdx = navItems.findIndex(i => i.key === "dashboard");
    navItems = [
      ...navItems.slice(0, dashIdx + 1),
      ...tenantNavItems,
      ...navItems.slice(dashIdx + 1),
    ];
  }

  const displayName = siteName || "Meta Ad Top-Up";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 py-6 mt-4 h-auto">
            {!collapsed && (
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-12 w-12 rounded-lg object-contain" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
                    <Zap className="h-6 w-6 text-primary-foreground" />
                  </div>
                )}
                <div>
                  <p className="text-base font-semibold text-sidebar-foreground leading-tight">{displayName}</p>
                  <p className="text-xs text-sidebar-muted capitalize mt-1">{role === "client" ? ((profile as any)?.company || (profile as any)?.full_name || "Client") : (role ?? "—")}</p>
                </div>
              </div>
            )}
            {collapsed && (
              <>
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" className="h-10 w-10 rounded-lg object-contain" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                    <Zap className="h-5 w-5 text-primary-foreground" />
                  </div>
                )}
              </>
            )}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1">
              {navItems.map((item) => {
                const tutorialKey =
                  item.key === "top-up" ? "nav-top-up" :
                  item.key === "wallet" ? "nav-wallet" :
                  item.key === "ad-accounts" ? "nav-ad-accounts" :
                  item.key === "settings" ? "nav-settings" :
                  item.key === "dashboard" ? "nav-dashboard" : undefined;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/dashboard"}
                        className="hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                        data-tutorial={tutorialKey}
                      >
                        <div className="relative mr-2">
                          <item.icon className="h-4 w-4" />
                          {(badges[item.key] ?? 0) > 0 && (
                            <span className={`absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold ${item.key === "external-top-up" ? "animate-pulse bg-warning text-warning-foreground ring-2 ring-warning/25" : "bg-destructive text-destructive-foreground"}`}>
                              {badges[item.key] > 9 ? "9+" : badges[item.key]}
                            </span>
                          )}
                        </div>
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        {!collapsed && profile && (
          <div className="mb-2 rounded-md bg-sidebar-accent p-3">
            <p className="text-sm font-medium text-sidebar-foreground truncate">
              {profile.full_name || profile.email || "User"}
            </p>
            <p className="text-xs text-sidebar-muted truncate">{profile.email}</p>
          </div>
        )}
        <div className={collapsed ? "flex justify-center mb-2" : "flex items-center gap-2 mb-2"}>
          <ThemeToggle />
          {!collapsed && <span className="text-sm text-sidebar-foreground">Theme</span>}
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-primary mb-1"
          onClick={async () => {
            const t = toast.loading("Updating system...");
            try {
              // Preserve auth keys
              const preserved: Record<string, string> = {};
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const k = localStorage.key(i);
                  if (k && (k.startsWith("sb-") || k.includes("supabase.auth"))) {
                    preserved[k] = localStorage.getItem(k) || "";
                  }
                }
              } catch {}

              // Clear all caches
              if ("caches" in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }

              try { sessionStorage.clear(); } catch {}
              try {
                localStorage.clear();
                Object.entries(preserved).forEach(([k, v]) => localStorage.setItem(k, v));
              } catch {}

              // Unregister service workers
              if ("serviceWorker" in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.unregister()));
              }

              toast.success("✅ Update applied! Reloading...", { id: t });
              setTimeout(() => {
                window.location.reload();
              }, 1500);
            } catch (err: any) {
              toast.error(err?.message || "Update failed", { id: t });
            }
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {!collapsed && "Update System"}
        </Button>
        <SignOutButton signOut={signOut} collapsed={collapsed} />
      </SidebarFooter>
    </Sidebar>
  );
}

function SignOutButton({ signOut, collapsed }: { signOut: () => Promise<void>; collapsed: boolean }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={loading}
      className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-destructive"
      onClick={async () => {
        if (loading) return;
        setLoading(true);
        const t = toast.loading("Signing out...");
        try {
          await signOut();
          toast.success("Signed out", { id: t });
        } catch (e: any) {
          toast.error(e?.message || "Sign out failed", { id: t });
          setLoading(false);
        }
      }}
    >
      <LogOut className="mr-2 h-4 w-4" />
      {!collapsed && (loading ? "Signing out..." : "Sign Out")}
    </Button>
  );
}

