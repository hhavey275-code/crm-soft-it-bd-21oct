import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconBg?: string;
  iconColor?: string;
  gradientClass?: string;
  className?: string;
  size?: "xs" | "sm" | "default";
  action?: ReactNode;
}

export function MetricCard({ title, value, subtitle, icon: Icon, iconBg, iconColor, className, size = "default", action }: MetricCardProps) {
  const isXs = size === "xs";
  const isSmall = size === "sm" || isXs;

  return (
    <Card className={cn("bg-card border border-border/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_2px_6px_rgba(0,0,0,0.3)] transition-shadow duration-200", className)}>
      <CardContent className={isXs ? "p-2" : isSmall ? "p-3" : "p-5"}>
        <div className={cn("flex items-center", isXs ? "gap-2" : "gap-3")}>
          <div className={cn("flex shrink-0 items-center justify-center rounded-lg", isXs ? "h-7 w-7" : isSmall ? "h-8 w-8" : "h-10 w-10", iconBg || "bg-primary/10")}>
            <Icon className={cn(isXs ? "h-3 w-3" : isSmall ? "h-3.5 w-3.5" : "h-5 w-5", iconColor || "text-primary")} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn("font-medium text-muted-foreground truncate", isXs ? "text-[10px] leading-tight" : isSmall ? "text-xs" : "text-sm")}>{title}</p>
            <p className={cn("font-bold tracking-tight text-foreground leading-tight", isXs ? "text-sm" : isSmall ? "text-base" : "text-xl")}>{value}</p>
            {subtitle && <p className={cn("text-muted-foreground truncate", isXs ? "text-[9px]" : isSmall ? "text-[10px]" : "text-xs")}>{subtitle}</p>}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
