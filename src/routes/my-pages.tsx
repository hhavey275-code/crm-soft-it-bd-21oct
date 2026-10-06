import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const MyPagesPage = lazy(() => import("@/components/pages/MyPagesPage"));

export const Route = createFileRoute("/my-pages")({
  head: () => ({
    meta: [
      { title: "My Facebook Pages — SoftIT BD" },
      { name: "description", content: "Connect your Facebook page to run ads from SoftIT BD." },
      { property: "og:title", content: "My Facebook Pages — SoftIT BD" },
      { property: "og:description", content: "Connect your Facebook page to run ads from SoftIT BD." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <MyPagesPage />
      </Suspense>
    </ProtectedGuard>
  ),
});
