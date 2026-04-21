import { createFileRoute } from "@tanstack/react-router";
import TopUpPage from "@/components/pages/TopUpPage";

export const Route = createFileRoute("/top-up")({
  component: TopUpPage,
});
