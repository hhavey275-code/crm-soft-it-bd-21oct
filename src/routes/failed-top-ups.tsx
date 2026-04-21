import { createFileRoute } from "@tanstack/react-router";
import FailedTopUpsPage from "@/components/pages/FailedTopUpsPage";

export const Route = createFileRoute("/failed-top-ups")({
  component: FailedTopUpsPage,
});
