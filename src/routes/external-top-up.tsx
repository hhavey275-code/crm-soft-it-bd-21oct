import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const ExternalTopUpPage = lazy(() => import("@/components/pages/ExternalTopUpPage"));

export const Route = createFileRoute("/external-top-up")({
  head: () => ({
    meta: [
      { title: "External Top-Up Requests — softitbd" },
      { name: "description", content: "Review and process pending external CRM top-up requests." },
      { property: "og:title", content: "External Top-Up Requests — softitbd" },
      { property: "og:description", content: "Review and process pending external CRM top-up requests." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <ExternalTopUpPage />
      </Suspense>
    </ProtectedGuard>
  ),
});
