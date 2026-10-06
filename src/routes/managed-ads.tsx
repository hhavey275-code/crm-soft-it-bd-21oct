import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const ManagedAdsPage = lazy(() => import("@/components/pages/ManagedAdsPage"));

export const Route = createFileRoute("/managed-ads")({
  head: () => ({
    meta: [
      { title: "Managed Ads Control — SoftIT BD" },
      { name: "description", content: "Assign client Facebook pages to shared ad accounts." },
      { property: "og:title", content: "Managed Ads Control — SoftIT BD" },
      { property: "og:description", content: "Assign client Facebook pages to shared ad accounts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <ManagedAdsPage />
      </Suspense>
    </ProtectedGuard>
  ),
});
