import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AgencyBranding {
  agencyId: string | null;
  name: string | null;
  slug: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  usdRate: number | null;
  loading: boolean;
}

const AgencyBrandingContext = createContext<AgencyBranding>({
  agencyId: null, name: null, slug: null, logoUrl: null, primaryColor: null, usdRate: null, loading: true,
});

export const useAgencyBranding = () => useContext(AgencyBrandingContext);

export const AgencyBrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branding, setBranding] = useState<AgencyBranding>({
    agencyId: null, name: null, slug: null, logoUrl: null, primaryColor: null, usdRate: null, loading: true,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hostname = window.location.hostname;
    const params = new URLSearchParams(window.location.search);
    let slug: string | null = null;
    const isLovableHost = hostname.includes("lovable.app") || hostname.includes("lovableproject.com");
    const parts = hostname.split(".");
    if (!isLovableHost && parts.length >= 3 && parts[0] !== "www") {
      slug = parts[0];
    }
    if (!slug) slug = params.get("agency");
    if (!slug) {
      setBranding(prev => ({ ...prev, loading: false }));
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("agencies")
        .select("id, name, slug, logo_url, primary_color, usd_rate")
        .eq("slug", slug!)
        .eq("status", "active")
        .maybeSingle();
      if (error) {
        setBranding(prev => ({ ...prev, loading: false }));
      } else if (data) {
        setBranding({
          agencyId: data.id,
          name: data.name,
          slug: data.slug,
          logoUrl: data.logo_url,
          primaryColor: data.primary_color,
          usdRate: Number(data.usd_rate) || null,
          loading: false,
        });
      } else {
        setBranding(prev => ({ ...prev, loading: false }));
      }
    })();
  }, []);

  return (
    <AgencyBrandingContext.Provider value={branding}>
      {children}
    </AgencyBrandingContext.Provider>
  );
};
