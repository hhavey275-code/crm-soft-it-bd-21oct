import { createFileRoute } from "@tanstack/react-router";
import SystemTopUpPage from "@/components/pages/SystemTopUpPage";

export const Route = createFileRoute("/system-top-up")({
  component: SystemTopUpPage,
});
