import { createFileRoute } from "@tanstack/react-router";
import TenantsPage from "@/components/pages/TenantsPage";

export const Route = createFileRoute("/tenants/")({ component: TenantsPage });