import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ShoppingCart,
  MousePointer,
  MessageSquare,
  Users,
  Eye,
  Megaphone,
} from "lucide-react";

const objectives = [
  {
    value: "OUTCOME_SALES",
    label: "Sales",
    description: "Drive purchases on your website or app",
    icon: ShoppingCart,
  },
  {
    value: "OUTCOME_TRAFFIC",
    label: "Traffic",
    description: "Send people to your website or landing page",
    icon: MousePointer,
  },
  {
    value: "OUTCOME_ENGAGEMENT",
    label: "Engagement",
    description: "Get more likes, comments, shares, or event responses",
    icon: MessageSquare,
  },
  {
    value: "OUTCOME_LEADS",
    label: "Leads",
    description: "Collect leads through forms or Messenger",
    icon: Users,
  },
  {
    value: "OUTCOME_AWARENESS",
    label: "Awareness",
    description: "Reach people most likely to remember your ads",
    icon: Eye,
  },
  {
    value: "OUTCOME_APP_PROMOTION",
    label: "App Promotion",
    description: "Drive app installs and engagement",
    icon: Megaphone,
  },
];

interface ObjectiveSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function ObjectiveSelector({ value, onChange }: ObjectiveSelectorProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {objectives.map((obj) => (
        <Card
          key={obj.value}
          className={cn(
            "cursor-pointer transition-all hover:shadow-md",
            value === obj.value
              ? "ring-2 ring-primary border-primary bg-primary/5"
              : "hover:border-primary/50"
          )}
          onClick={() => onChange(obj.value)}
        >
          <CardContent className="p-4 flex items-start gap-3">
            <div
              className={cn(
                "rounded-lg p-2 shrink-0",
                value === obj.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <obj.icon className="h-5 w-5" />
            </div>
            <div>
              <p className="font-medium text-sm">{obj.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{obj.description}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
