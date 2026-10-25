import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const BusinessManagersPage = lazy(() => import("@/components/pages/BusinessManagersPage"));

export const Route = createFileRoute("/business-managers")({
  head: () => ({ meta: [
    { title: "Business Managers & Page Import — SoftIT BD" },
    { name: "description", content: "Manage Meta businesses and import approved Facebook Pages into client accounts." },
    { property: "og:title", content: "Business Managers & Page Import — SoftIT BD" },
    { property: "og:description", content: "Manage Meta businesses and import approved Facebook Pages into client accounts." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><BusinessManagersPage /></Suspense></ProtectedGuard>
  ),
});
