import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import DocumentsVaultPage from "@/components/pages/DocumentsVaultPage";

export const Route = createFileRoute("/documents")({
  component: DocumentsRoute,
});

function DocumentsRoute() {
  return (
    <ProtectedGuard>
      <DocumentsVaultPage />
    </ProtectedGuard>
  );
}