import { createFileRoute } from "@tanstack/react-router";
import ClientSpendReportPage from "@/components/pages/ClientSpendReportPage";

export const Route = createFileRoute("/client-spend-report")({ component: ClientSpendReportPage });
