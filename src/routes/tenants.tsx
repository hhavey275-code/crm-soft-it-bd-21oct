import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tenants")({ component: TenantsLayout });

function TenantsLayout() {
  return <Outlet />;
}
