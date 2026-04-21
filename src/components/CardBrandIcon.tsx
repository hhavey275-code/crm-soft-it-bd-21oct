export function CardBrandIcon({ displayString, size = "sm" }: { displayString: string; size?: "sm" | "xs" }) {
  const lower = displayString?.toLowerCase() ?? "";
  const isXs = size === "xs";
  
  if (lower.includes("visa")) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded font-bold tracking-wider text-white ${isXs ? "px-1 py-px text-[8px]" : "px-1.5 py-0.5 text-[10px]"}`}
        style={{ background: "linear-gradient(135deg, #1a1f71, #2566af)" }}
      >
        VISA
      </span>
    );
  }
  if (lower.includes("master")) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded">
        <span className={`rounded-full bg-[#eb001b] inline-block opacity-90 ${isXs ? "h-3 w-3 -mr-1" : "h-3.5 w-3.5 -mr-1.5"}`} />
        <span className={`rounded-full bg-[#f79e1b] inline-block opacity-90 ${isXs ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
      </span>
    );
  }
  if (lower.includes("amex") || lower.includes("american")) {
    return (
      <span className={`inline-flex items-center justify-center rounded font-bold text-white bg-[#2e77bc] ${isXs ? "px-1 py-px text-[8px]" : "px-1.5 py-0.5 text-[10px]"}`}>
        AMEX
      </span>
    );
  }
  // Available funds / generic
  return (
    <span className={`inline-flex items-center justify-center rounded bg-emerald-500 text-white ${isXs ? "px-1 py-px" : "px-1.5 py-0.5"}`}>
      <svg className={isXs ? "h-3 w-3" : "h-3.5 w-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
    </span>
  );
}
