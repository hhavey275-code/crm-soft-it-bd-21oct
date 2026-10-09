import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { KastOtpCard } from "@/components/admin/KastOtpCard";

export const Route = createFileRoute("/kast-otp")({
  head: () => ({
    meta: [
      { title: "KAST OTP — SoftIT BD" },
      { name: "description", content: "Live KAST bank OTP and card alerts for admins." },
      { property: "og:title", content: "KAST OTP — SoftIT BD" },
      { property: "og:description", content: "Live KAST bank OTP and card alerts for admins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl p-4">
        <KastOtpCard />
      </div>
    </DashboardLayout>
  ),
});
