import { createFileRoute } from "@tanstack/react-router";
import AdminPerformancePage from "@/components/pages/AdminPerformancePage";

export const Route = createFileRoute("/performance")({ component: AdminPerformancePage });
