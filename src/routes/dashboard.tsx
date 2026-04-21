import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { LayoutDashboard, Wallet, Users, Receipt } from "lucide-react";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <ProtectedGuard>
      <DashboardLayout>
        <DashboardContent />
      </DashboardLayout>
    </ProtectedGuard>
  );
}

function DashboardContent() {
  const { user, role, profile, isAdmin } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Welcome back, {profile?.full_name || user?.email} ({role || "user"})
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Phase 1 Complete ✅</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p>Auth, layout, sidebar, theme system — all working.</p>
          <p className="font-semibold text-foreground">Phase 2 e ami port korbo: Real Dashboard metrics + Profile/Settings page.</p>
          <p>Phase 3: Ad Accounts + Business Managers</p>
          <p>Phase 4: Top-Up + Wallet + Transactions</p>
          <p>Phase 5+: Admin (Clients, Banks, Billings), Agencies, Sellers, Tenants</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Spend", value: "—", icon: Wallet },
          { label: "Active Accounts", value: "—", icon: LayoutDashboard },
          { label: isAdmin ? "Total Clients" : "My Balance", value: "—", icon: Users },
          { label: "Transactions", value: "—", icon: Receipt },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
                <div className="text-xl font-bold">{stat.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
