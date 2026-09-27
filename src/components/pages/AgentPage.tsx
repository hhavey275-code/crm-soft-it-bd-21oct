import { DashboardLayout } from "@/components/DashboardLayout";
import { AgentChat } from "@/components/agent/AgentChat";
import { MarkAssistant } from "@/components/agent/MarkAssistant";

export default function AgentPage() {
  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <AgentChat />
        </div>
        <MarkAssistant />
      </div>
    </DashboardLayout>
  );
}
