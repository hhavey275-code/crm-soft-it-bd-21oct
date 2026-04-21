import { createFileRoute } from "@tanstack/react-router";
import BanksPage from "@/components/pages/BanksPage";

export const Route = createFileRoute("/banks")({
  component: BanksPage,
});
