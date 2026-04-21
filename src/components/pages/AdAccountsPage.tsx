import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigationType } from "@/lib/router-compat";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminAdAccounts } from "@/components/admin/AdminAdAccounts";
import { ClientAdAccounts } from "@/components/client/ClientAdAccounts";
import { AdminTikTokAccounts } from "@/components/admin/AdminTikTokAccounts";
import { ClientTikTokAccounts } from "@/components/client/ClientTikTokAccounts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SESSION_KEYS = [
  "adAccountsSearch", "tiktokAccountsSearch", "adAccountsTab",
  "adAccountsSortField", "adAccountsSortDir",
  "adAccountsStatusFilter", "adAccountsCardFilter", "adAccountsActivityFilter",
  "adAccountsPage",
  "tiktokAccountsSortField", "tiktokAccountsSortDir",
  "tiktokAccountsStatusFilter", "tiktokAccountsPage",
];

export default function AdAccountsPage() {
  const { isAdmin, isAgency, loading } = useAuth();
  const showAdminView = isAdmin || isAgency;
  const navType = useNavigationType();
  const isBackNav = navType === "POP";
  const savedTab = isBackNav ? (sessionStorage.getItem("adAccountsTab") || "meta") : "meta";

  // Clear session keys on page unload (reload/close) so reload starts fresh
  useEffect(() => {
    const cleanup = () => SESSION_KEYS.forEach((k) => sessionStorage.removeItem(k));
    window.addEventListener("beforeunload", cleanup);
    return () => window.removeEventListener("beforeunload", cleanup);
  }, []);

  return (
    <DashboardLayout>
      <Tabs defaultValue={savedTab} className="w-full" onValueChange={(v) => sessionStorage.setItem("adAccountsTab", v)}>
        <TabsList className="mb-4">
          <TabsTrigger value="meta">Meta Ad Accounts</TabsTrigger>
          <TabsTrigger value="tiktok">TikTok Ad Accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="meta">
          {showAdminView ? <AdminAdAccounts /> : <ClientAdAccounts />}
        </TabsContent>
        <TabsContent value="tiktok">
          {showAdminView ? <AdminTikTokAccounts /> : <ClientTikTokAccounts />}
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}