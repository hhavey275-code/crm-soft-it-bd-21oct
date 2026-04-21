import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function friendlyEdgeError(err: any): string {
  const msg = err?.message || String(err ?? "");

  const jsonStart = msg.indexOf("{");
  const jsonEnd = msg.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(msg.slice(jsonStart, jsonEnd + 1));
      if (parsed?.error) {
        if (parsed?.is_rate_limit && parsed?.retry_after_seconds) {
          const mins = Math.max(1, Math.ceil(Number(parsed.retry_after_seconds) / 60));
          return `${parsed.error} Retry after ~${mins} minute(s).`;
        }
        return parsed.error;
      }
    } catch {
      // Ignore parse error and fallback below
    }
  }

  if (msg.includes("non-2xx")) {
    return "Request failed. Please try again.";
  }

  return msg;
}
