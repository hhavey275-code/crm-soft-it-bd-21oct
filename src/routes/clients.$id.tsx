import { createFileRoute } from "@tanstack/react-router";
import ClientDetailPage from "@/components/pages/ClientDetailPage";

export const Route = createFileRoute("/clients/$id")({ component: ClientDetailPage });
