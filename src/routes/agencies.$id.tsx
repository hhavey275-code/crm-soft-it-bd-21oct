import { createFileRoute } from "@tanstack/react-router";
import AgencyDetailPage from "@/components/pages/AgencyDetailPage";

export const Route = createFileRoute("/agencies/$id")({ component: AgencyDetailPage });
