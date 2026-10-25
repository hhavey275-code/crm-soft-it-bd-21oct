import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminBusinessManagers } from "@/components/admin/AdminBusinessManagers";
import { AdminTikTokBusinessCenters } from "@/components/admin/AdminTikTokBusinessCenters";
import { BmPagesImport } from "@/components/admin/BmPagesImport";
import { Navigate } from "@/lib/router-compat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";

const TAB_KEY = "bmPageTab";

export default function BusinessManagersPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState(() => sessionStorage.getItem(TAB_KEY) || "meta");

  useEffect(() => {
    sessionStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <DashboardLayout>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="meta">Meta Business</TabsTrigger>
          <TabsTrigger value="tiktok">TikTok Business Centre</TabsTrigger>
        </TabsList>
        <TabsContent value="meta">
          <BmPagesImport />
          <AdminBusinessManagers />
        </TabsContent>
        <TabsContent value="tiktok">
          <AdminTikTokBusinessCenters />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
