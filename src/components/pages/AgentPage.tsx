import { DashboardLayout } from "@/components/DashboardLayout";
import { AgentChat } from "@/components/agent/AgentChat";

export default function AgentPage() {
  return (
    <DashboardLayout>
      <AgentChat />
    </DashboardLayout>
  );
}
