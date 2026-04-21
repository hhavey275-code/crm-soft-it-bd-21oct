import { createFileRoute, useParams } from "@tanstack/react-router";
import ClientDetailPage from "@/components/pages/ClientDetailPage";

function ClientDetailRoute() {
  const { id } = useParams({ from: "/clients/$id" });
  // Bridge: the legacy ClientDetailPage reads `userId` from useParams.
  // Make it available by exposing a window flag isn't ideal — simpler: render and let
  // useParams (strict:false) return all params. The legacy code uses { userId }, so we
  // mirror $id → userId via a context-less wrapper using URL rewrite is overkill.
  // Instead, use router-compat's useParams which returns ALL params; ensure key exists.
  if (typeof window !== "undefined") {
    (window as any).__lovable_route_params = { userId: id, id };
  }
  return <ClientDetailPage />;
}

export const Route = createFileRoute("/clients/$id")({ component: ClientDetailRoute });
