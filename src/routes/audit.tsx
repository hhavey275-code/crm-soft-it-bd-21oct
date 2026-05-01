import { createFileRoute } from "@tanstack/react-router";
import AuditPage from "@/components/pages/AuditPage";

export const Route = createFileRoute("/audit")({ component: AuditPage });