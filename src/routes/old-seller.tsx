import { createFileRoute } from "@tanstack/react-router";
import OldSellerPage from "@/components/pages/OldSellerPage";

export const Route = createFileRoute("/old-seller")({
  component: OldSellerPage,
});
