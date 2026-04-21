import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { ClientWallet } from "@/components/client/ClientWallet";
import { AgencyWallet } from "@/components/agency/AgencyWallet";

export const Route = createFileRoute("/wallet")({
  component: WalletPage,
});

function WalletPage() {
  return (
    <ProtectedGuard>
      <DashboardLayout>
        <WalletContent />
      </DashboardLayout>
    </ProtectedGuard>
  );
}

function WalletContent() {
  const { isAgency } = useAuth();
  return isAgency ? <AgencyWallet /> : <ClientWallet />;
}
