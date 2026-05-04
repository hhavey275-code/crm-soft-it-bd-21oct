import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Copy, ExternalLink, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { StripeLinkDialog } from "@/components/admin/StripeLinkDialog";

export default function StripeLinksPage() {
  const { isAdmin } = useAuth();

  const { data: links, isLoading } = useQuery({
    queryKey: ["all-stripe-links"],
    queryFn: async () => {
      const { data } = await supabase
        .from("stripe_payment_links")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      return data || [];
    },
    enabled: isAdmin,
  });

  // Fetch profile names for target users
  const userIds = Array.from(new Set((links || []).map((l: any) => l.target_user_id)));
  const { data: profiles } = useQuery({
    queryKey: ["stripe-link-profiles", userIds],
    queryFn: async () => {
      if (!userIds.length) return [];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const nameOf = (uid: string) => {
    const p = profiles?.find((p: any) => p.user_id === uid);
    return p?.full_name || p?.email || uid.slice(0, 8);
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="p-6">Admin only</div>
      </DashboardLayout>
    );
  }

  const stats = {
    total: links?.length || 0,
    paid: links?.filter((l: any) => l.status === "paid").length || 0,
    pending: links?.filter((l: any) => l.status === "pending").length || 0,
    failed: links?.filter((l: any) => l.status === "failed").length || 0,
    totalUsd: links?.filter((l: any) => l.status === "paid").reduce((s: number, l: any) => s + Number(l.amount_usd), 0) || 0,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Stripe Payment Links</h1>
            <p className="text-sm text-muted-foreground">Manual card payment links for clients (USD)</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total Links</div><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Paid</div><div className="text-2xl font-bold text-green-600">{stats.paid}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pending</div><div className="text-2xl font-bold">{stats.pending}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Collected</div><div className="text-2xl font-bold">${stats.totalUsd.toFixed(2)}</div></CardContent></Card>
        </div>

        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex gap-3 items-start">
            <AlertCircle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Setup required</p>
              <p className="text-muted-foreground">
                Add <code className="bg-muted px-1 rounded">STRIPE_SECRET_KEY</code> and <code className="bg-muted px-1 rounded">STRIPE_WEBHOOK_SECRET</code> in Supabase Edge Function secrets.
                Then create a webhook in Stripe Dashboard → Developers → Webhooks pointing to:
                <code className="block mt-1 bg-muted px-2 py-1 rounded text-xs break-all">
                  https://dhswrfzdqcavgmymllat.supabase.co/functions/v1/stripe-webhook
                </code>
                Subscribe to: <code>checkout.session.completed</code>, <code>checkout.session.expired</code>, <code>payment_intent.payment_failed</code>.
                See <code>STRIPE_RADAR_GUIDE.md</code> for fraud-tuning tips.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>All Payment Links</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Failure</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
                ) : !links?.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No payment links yet</TableCell></TableRow>
                ) : links.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{format(new Date(l.created_at), "MMM d, HH:mm")}</TableCell>
                    <TableCell>{nameOf(l.target_user_id)}</TableCell>
                    <TableCell className="font-semibold">${Number(l.amount_usd).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={
                        l.status === "paid" ? "default" :
                        l.status === "pending" ? "secondary" :
                        "destructive"
                      }>{l.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                      {l.failure_code ? `${l.failure_code}: ${l.failure_message}` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {l.status === "pending" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => copyLink(l.checkout_url)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" asChild>
                              <a href={l.checkout_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
