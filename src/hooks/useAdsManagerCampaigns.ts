import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

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
  const { session } = useAuth();
  const [data, setData] = useState<FetchCampaignsResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!session?.access_token) {
        throw new Error("Please sign in again and retry.");
      }

      const res = await fetch("/api/ads-manager/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(params),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Failed to fetch campaigns");
      }

      return json as FetchCampaignsResponse;
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