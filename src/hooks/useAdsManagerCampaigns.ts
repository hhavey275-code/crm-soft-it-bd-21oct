import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdsManagerCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time: string;
  insights?: {
    spend?: string;
    impressions?: string;
    clicks?: string;
    cpc?: string;
    ctr?: string;
    cpm?: string;
    actions?: Array<{ action_type: string; value: string }>;
  };
}

interface FetchCampaignsResponse {
  campaigns: AdsManagerCampaign[];
  fetchedAt: string;
  proxyIp: string | null;
  via: "proxy" | "direct";
}

export function useAdsManagerCampaigns(params: {
  accountId: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
}) {
  const [data, setData] = useState<FetchCampaignsResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data: result, error: fnError } = await supabase.functions.invoke(
        "ads-manager-campaigns",
        { body: params },
      );
      if (fnError) {
        const msg =
          (fnError as any)?.context?.body?.error ||
          (fnError as any)?.message ||
          "Failed to fetch campaigns";
        throw new Error(msg);
      }
      if ((result as any)?.error) {
        throw new Error((result as any).error);
      }
      return result as FetchCampaignsResponse;
    },
    onMutate: () => {
      setError(null);
    },
    onSuccess: (result) => {
      setData(result);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err : new Error("Failed to fetch campaigns"));
    },
  });

  return {
    campaigns: data?.campaigns ?? [],
    dataUpdatedAt: data?.fetchedAt ? new Date(data.fetchedAt).getTime() : 0,
    via: data?.via ?? null,
    proxyIp: data?.proxyIp ?? null,
    hasFetched: !!data,
    isLoading: mutation.isPending,
    isError: !!error,
    error,
    fetchCampaigns: () => mutation.mutateAsync(),
  };
}