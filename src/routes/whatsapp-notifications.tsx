import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const WhatsAppNotificationsPage = lazy(() => import("@/components/pages/WhatsAppNotificationsPage"));

export const Route = createFileRoute("/whatsapp-notifications")({
  head: () => ({
    meta: [
      { title: "WhatsApp Notifications — softitbd" },
      { name: "description", content: "Configure and track WhatsApp top-up notifications sent to clients." },
      { property: "og:title", content: "WhatsApp Notifications — softitbd" },
      {
        property: "og:description",
        content: "Configure and track WhatsApp top-up notifications sent to clients.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedGuard>
      <Suspense fallback={<PageSkeleton />}>
        <WhatsAppNotificationsPage />
      </Suspense>
    </ProtectedGuard>
  ),
});
