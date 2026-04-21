import { createFileRoute } from "@tanstack/react-router";
import AdminPerformancePage from "@/components/pages/AdminPerformancePage";

export const Route = createFileRoute("/admin/performance")({ component: AdminPerformancePage });
