import { createFileRoute } from "@tanstack/react-router";
import AgenciesPage from "@/components/pages/AgenciesPage";

export const Route = createFileRoute("/agencies")({ component: AgenciesPage });
