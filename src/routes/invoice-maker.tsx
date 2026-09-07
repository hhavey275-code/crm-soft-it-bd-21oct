import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import { PageSkeleton } from "@/components/PageSkeleton";

const InvoiceMakerPage = lazy(() => import("@/components/pages/InvoiceMakerPage"));

export const Route = createFileRoute("/invoice-maker")({
  head: () => ({
    meta: [
      { title: "Invoice Maker | Custom Client & Bank Invoices" },
      { name: "description", content: "Create custom invoices with your logo, address and bank details, then download them as PDF in multiple designs." },
      { property: "og:title", content: "Invoice Maker | Custom Client & Bank Invoices" },
      { property: "og:description", content: "Build and download branded invoices for clients and bank submission." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedGuard><Suspense fallback={<PageSkeleton />}><InvoiceMakerPage /></Suspense></ProtectedGuard>
  ),
});
