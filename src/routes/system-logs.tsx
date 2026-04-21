import { createFileRoute } from "@tanstack/react-router";
import SystemLogsPage from "@/components/pages/SystemLogsPage";

export const Route = createFileRoute("/system-logs")({ component: SystemLogsPage });
