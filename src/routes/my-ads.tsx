import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const MyAdsPage = lazy(() => import("@/components/pages/MyAdsPage"));

export const Route = createFileRoute("/my-ads")({
  head: () => ({
    meta: [
      { title: "My Ads Manager — SoftIT BD" },
      { name: "description", content: "Create and manage campaigns, ad sets and ads for your Facebook pages." },
      { property: "og:title", content: "My Ads Manager — SoftIT BD" },
      { property: "og:description", content: "Create and manage campaigns, ad sets and ads for your Facebook pages." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <MyAdsPage />
      </Suspense>
    </ProtectedGuard>
  ),
});
