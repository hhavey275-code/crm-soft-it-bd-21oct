import { DashboardLayout } from "@/components/DashboardLayout";
import { TenantSystemTopUp } from "@/components/tenant/TenantSystemTopUp";
import { TenantUsageLog } from "@/components/tenant/TenantUsageLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUpCircle, Activity } from "lucide-react";

export default function SystemTopUpPage() {
  return (
    <DashboardLayout>
      <Tabs defaultValue="topup" className="space-y-4">
        <TabsList className="grid w-full sm:w-auto grid-cols-2 sm:inline-grid">
          <TabsTrigger value="topup" className="gap-1.5">
            <ArrowUpCircle className="h-4 w-4" />
            <span className="text-xs sm:text-sm">Top-Up</span>
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-1.5">
            <Activity className="h-4 w-4" />
            <span className="text-xs sm:text-sm">Usage Log</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="topup">
          <TenantSystemTopUp />
        </TabsContent>
        <TabsContent value="log">
          <TenantUsageLog />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
