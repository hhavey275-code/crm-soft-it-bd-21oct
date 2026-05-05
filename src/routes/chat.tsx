import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";

const ChatPage = lazy(() => import("@/components/pages/ChatPage"));

export const Route = createFileRoute("/chat")({
  component: () => (
    <Suspense fallback={<PageSkeleton />}><ChatPage /></Suspense>
  ),
});
