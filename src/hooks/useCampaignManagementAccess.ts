import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns whether the current user is allowed to use the in-app
 * Campaign Management (CRM Ads Manager) feature.
 *
 * - Admins / superadmins: always allowed
 * - Clients: only allowed if their profile has campaign_management_enabled = true
 */
export function useCampaignManagementAccess() {
  const { user, isAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["campaign-mgmt-access", user?.id],
    queryFn: async () => {
      if (!user) return false;
      if (isAdmin) return true;
      const { data: profile } = await supabase
        .from("profiles")
        .select("campaign_management_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      return !!(profile as any)?.campaign_management_enabled;
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  return { allowed: !!data, isLoading };
}
