import { useState } from "react";
import { useParams, useNavigate } from "@/lib/router-compat";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Megaphone, Plus, Lock } from "lucide-react";
import { CampaignList } from "@/components/ads-manager/CampaignList";
import { CreateCampaignWizard } from "@/components/ads-manager/CreateCampaignWizard";
import { useCampaignManagementAccess } from "@/hooks/useCampaignManagementAccess";

export default function AdsManagerPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const [showWizard, setShowWizard] = useState(false);
  const { allowed, isLoading: accessLoading } = useCampaignManagementAccess();

  const { data: account } = useQuery({
    queryKey: ["ad-account-for-ads-mgr", accountId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ad_accounts")
        .select("id, account_name, account_id, platform")
        .eq("id", accountId!)
        .single();
      return data;
    },
    enabled: !!accountId,
  });

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-primary" />
                Ads Manager
              </h1>
              {account && (
                <p className="text-sm text-muted-foreground">
                  {account.account_name} ({account.account_id})
                </p>
              )}
            </div>
          </div>
          {!showWizard && account?.platform === "meta" && allowed && (
            <Button onClick={() => setShowWizard(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Create Campaign</span>
              <span className="sm:hidden">Create</span>
            </Button>
          )}
        </div>

        {!accessLoading && !allowed ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground space-y-3">
              <Lock className="h-8 w-8 mx-auto text-muted-foreground/60" />
              <p className="text-sm">Campaign Management is not enabled for your account.</p>
              <p className="text-xs">Please contact your administrator to request access.</p>
            </CardContent>
          </Card>
        ) : account?.platform !== "meta" ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Ads Manager is currently only available for Meta ad accounts.
            </CardContent>
          </Card>
        ) : showWizard ? (
          <CreateCampaignWizard
            accountId={accountId!}
            onClose={() => setShowWizard(false)}
            onSuccess={() => setShowWizard(false)}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Campaigns</CardTitle>
            </CardHeader>
            <CardContent>
              {accountId && <CampaignList accountId={accountId} />}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
