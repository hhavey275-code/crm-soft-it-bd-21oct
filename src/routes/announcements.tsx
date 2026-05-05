import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const AnnouncementsPage = lazy(() => import("@/components/pages/AnnouncementsPage"));

export const Route = createFileRoute("/announcements")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><AnnouncementsPage /></Suspense>
  ),
});
