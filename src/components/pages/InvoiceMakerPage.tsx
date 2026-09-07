import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { InvoiceMaker } from "@/components/admin/invoice-maker/InvoiceMaker";

export default function InvoiceMakerPage() {
  const { isAdmin } = useAuth();
  return (
    <DashboardLayout>
      {isAdmin ? (
        <InvoiceMaker />
      ) : (
        <div className="p-6 text-sm text-muted-foreground">This page is available to admins only.</div>
      )}
    </DashboardLayout>
  );
}
