import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SiteSettings {
  logoUrl: string | null;
  siteName: string | null;
  headerAnnouncement: string | null;
  welcomeTitle: string | null;
  welcomeNote: string | null;
  announcementColor: string | null;
  announcementSize: string | null;
}

async function fetchSettings(): Promise<SiteSettings> {
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["logo_url", "site_name", "header_announcement", "welcome_title", "welcome_note", "announcement_color", "announcement_size"]);

  const settings: SiteSettings = {
    logoUrl: null, siteName: null, headerAnnouncement: null,
    welcomeTitle: null, welcomeNote: null, announcementColor: null, announcementSize: null,
  };

  if (data) {
    for (const row of data) {
      if (row.key === "logo_url") settings.logoUrl = row.value;
      if (row.key === "site_name") settings.siteName = row.value;
      if (row.key === "header_announcement") settings.headerAnnouncement = row.value;
      if (row.key === "welcome_title") settings.welcomeTitle = row.value;
      if (row.key === "welcome_note") settings.welcomeNote = row.value;
      if (row.key === "announcement_color") settings.announcementColor = row.value;
      if (row.key === "announcement_size") settings.announcementSize = row.value;
    }
  }

  return settings;
}

export function useSiteSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["site-settings"],
    queryFn: fetchSettings,
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  return {
    logoUrl: data?.logoUrl ?? null,
    siteName: data?.siteName ?? null,
    headerAnnouncement: data?.headerAnnouncement ?? null,
    welcomeTitle: data?.welcomeTitle ?? null,
    welcomeNote: data?.welcomeNote ?? null,
    announcementColor: data?.announcementColor ?? null,
    announcementSize: data?.announcementSize ?? null,
    loading: isLoading,
    refetch: () => queryClient.invalidateQueries({ queryKey: ["site-settings"] }),
  };
}
