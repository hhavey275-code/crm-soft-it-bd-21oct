import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { InvoiceMaker } from "@/components/admin/invoice-maker/InvoiceMaker";
import { PdfEditor } from "@/components/admin/invoice-maker/PdfEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function InvoiceMakerPage() {
  const { isAdmin } = useAuth();
  return (
    <DashboardLayout>
      {isAdmin ? (
        <Tabs defaultValue="invoice" className="space-y-4">
          <TabsList>
            <TabsTrigger value="invoice">Invoice maker</TabsTrigger>
            <TabsTrigger value="pdf">PDF editor</TabsTrigger>
          </TabsList>
          <TabsContent value="invoice">
            <InvoiceMaker />
          </TabsContent>
          <TabsContent value="pdf">
            <PdfEditor />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="p-6 text-sm text-muted-foreground">This page is available to admins only.</div>
      )}
    </DashboardLayout>
  );
}
