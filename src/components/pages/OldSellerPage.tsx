import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Archive } from "lucide-react";
import { fetchArchivedSellers } from "@/lib/oldSellerData";
import { OldSellerBreakdown } from "@/components/admin/OldSellerBreakdown";
import { useRole } from "@/hooks/useRole";

export default function OldSellerPage() {
  const { isAdmin, isSuperadmin } = useRole();
  const [sellerId, setSellerId] = useState<string | null>(null);

  const { data: sellers, isLoading } = useQuery({
    queryKey: ["archived-sellers"],
    queryFn: fetchArchivedSellers,
    enabled: isAdmin || isSuperadmin,
  });

  useEffect(() => {
    if (!sellerId && sellers && sellers.length > 0) setSellerId(sellers[0].seller_id);
  }, [sellers, sellerId]);

  if (!isAdmin && !isSuperadmin) {
    return (
      <DashboardLayout>
        <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">
          Admins only.
        </div>
      </DashboardLayout>
    );
  }

  const selected = sellers?.find((s) => s.seller_id === sellerId);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Archive className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Old Seller — Archive Audit</h1>
            <p className="text-sm text-muted-foreground">
              Read-only breakdown of pre-May 2026 seller transactions for manual reconciliation.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Seller</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading sellers…</div>
            ) : !sellers || sellers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No archived seller data found.</p>
            ) : (
              <Select value={sellerId ?? undefined} onValueChange={setSellerId}>
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="Pick a seller…" />
                </SelectTrigger>
                <SelectContent>
                  {sellers.map((s) => (
                    <SelectItem key={s.seller_id} value={s.seller_id}>
                      {s.seller_name} <span className="text-xs text-muted-foreground">· {s.txn_count} entries · {s.seller_email}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {sellerId && selected && (
          <OldSellerBreakdown sellerId={sellerId} sellerName={selected.seller_name} />
        )}
      </div>
    </DashboardLayout>
  );
}
