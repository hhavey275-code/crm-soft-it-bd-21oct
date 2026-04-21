import { createFileRoute } from "@tanstack/react-router";
import AgentPage from "@/components/pages/AgentPage";

export const Route = createFileRoute("/agent")({ component: AgentPage });
