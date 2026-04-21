import { createFileRoute } from "@tanstack/react-router";
import { ProtectedGuard } from "@/components/ProtectedGuard";
import SettingsPage from "@/components/settings/SettingsContent";

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  return (
    <ProtectedGuard>
      <SettingsPage />
    </ProtectedGuard>
  );
}
