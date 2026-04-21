import { cn } from "@/lib/utils";

const statusConfig: Record<string, { color: string; label: string }> = {
  active: { color: "bg-green-500", label: "Active" },
  approved: { color: "bg-green-500", label: "Approved" },
  pending: { color: "bg-amber-500", label: "Pending" },
  hold: { color: "bg-orange-500", label: "On Hold" },
  rejected: { color: "bg-red-500", label: "Rejected" },
  failed: { color: "bg-red-500", label: "Failed" },
  disabled: { color: "bg-red-500", label: "Disabled" },
  unsettled: { color: "bg-amber-500", label: "Unsettled" },
  inactive: { color: "bg-muted-foreground", label: "Inactive" },
};

export function StatusBadge({ status }: { status?: string | null }) {
  const key = String(status || "inactive").trim().toLowerCase();
  const config = statusConfig[key] ?? statusConfig.inactive;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn("h-2 w-2 rounded-full", config.color)} />
      {config.label}
    </span>
  );
}