import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, Wallet, Receipt, ArrowUpFromLine, Settings, LogOut,
  Building2, CreditCard, Users, FileText, MessageSquare, AlertCircle,
  ScrollText, Megaphone, MessageCircle, Building, Activity, BarChart3, Bot,
  ListChecks, Briefcase, Banknote, Sparkles, ShoppingBag, Vault,
} from "lucide-react";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { Button } from "@/components/ui/button";

const clientItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Ad Accounts", url: "/ad-accounts", icon: Wallet },
  { title: "Top Up", url: "/top-up", icon: ArrowUpFromLine },
  { title: "Transactions", url: "/transactions", icon: Receipt },
  { title: "My Unused", url: "/my-unused-accounts", icon: AlertCircle },
  { title: "Settings", url: "/settings", icon: Settings },
];

const adminItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Ad Accounts", url: "/ad-accounts", icon: Wallet },
  { title: "Business Managers", url: "/business-managers", icon: Building2 },
  { title: "Banks", url: "/banks", icon: Banknote },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "Billings", url: "/billings", icon: FileText },
  { title: "Requests", url: "/requests", icon: ListChecks },
  { title: "Sellers", url: "/sellers", icon: ShoppingBag },
  { title: "Card Vault", url: "/card-vault", icon: Vault },
  { title: "Failed Top-Ups", url: "/failed-topups", icon: AlertCircle },
  { title: "Wallet Balances", url: "/wallet-balances", icon: CreditCard },
  { title: "Spend Report", url: "/client-spend-report", icon: BarChart3 },
  { title: "Performance", url: "/admin-performance", icon: Activity },
  { title: "Announcements", url: "/announcements", icon: Megaphone },
  { title: "Feedback", url: "/feedback", icon: MessageCircle },
  { title: "Chat", url: "/chat", icon: MessageSquare },
  { title: "System Logs", url: "/system-logs", icon: ScrollText },
  { title: "Settings", url: "/settings", icon: Settings },
];

const superadminItems = [
  ...adminItems,
  { title: "Tenants", url: "/tenants", icon: Building },
  { title: "Subscriptions", url: "/subscriptions", icon: Sparkles },
  { title: "Agencies", url: "/agencies", icon: Briefcase },
  { title: "System Top-Up", url: "/system-topup", icon: ArrowUpFromLine },
  { title: "Agent", url: "/agent", icon: Bot },
];

const agencyItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Wallet", url: "/agency-wallet", icon: Wallet },
  { title: "Payments", url: "/agency-payments", icon: Receipt },
  { title: "Settings", url: "/settings", icon: Settings },
];

const sellerItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Transactions", url: "/transactions", icon: Receipt },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { isAdmin, isSuperAdmin, isSeller, isAgency, signOut, user } = useAuth();
  const { logoUrl, siteName } = useSiteSettings();
  const location = useLocation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const items = isSuperAdmin
    ? superadminItems
    : isAdmin
    ? adminItems
    : isAgency
    ? agencyItems
    : isSeller
    ? sellerItems
    : clientItems;

  const isActive = (url: string) => location.pathname === url || location.pathname.startsWith(url + "/");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-2">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-7 w-7 rounded object-contain flex-shrink-0" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground text-xs font-bold">
              {(siteName || "CRM").slice(0, 2).toUpperCase()}
            </div>
          )}
          {!collapsed && (
            <span className="font-semibold text-sm truncate">{siteName || "CRM"}</span>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t">
        {!collapsed && user?.email && (
          <div className="px-2 py-1 text-xs text-muted-foreground truncate">{user.email}</div>
        )}
        <Button variant="ghost" size="sm" onClick={signOut} className="justify-start gap-2">
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sign Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
