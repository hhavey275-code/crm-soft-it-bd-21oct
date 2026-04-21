import { createFileRoute } from "@tanstack/react-router";
import TenantDetailPage from "@/components/pages/TenantDetailPage";

export const Route = createFileRoute("/tenants/$id")({ component: TenantDetailPage });
