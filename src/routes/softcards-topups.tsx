import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const Page = lazy(() => import("@/components/pages/SoftcardsTopupsPage"));

export const Route = createFileRoute("/softcards-topups")({
  head: () => ({
    meta: [
      { title: "SoftCards Top-Ups — softitbd" },
      { name: "description", content: "Approve or reject deposit requests coming from SoftCards." },
      { property: "og:title", content: "SoftCards Top-Ups — softitbd" },
      { property: "og:description", content: "Approve or reject deposit requests coming from SoftCards." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <Page />
      </Suspense>
    </ProtectedGuard>
  ),
});
