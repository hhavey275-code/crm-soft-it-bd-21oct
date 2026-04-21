import { supabase } from "@/integrations/supabase/client";

export async function logSystemAction(
  action: string,
  details: string,
  userId?: string | null,
  userName?: string | null
) {
  try {
    await (supabase as any).from("system_logs").insert({
      action,
      details,
      user_id: userId || null,
      user_name: userName || null,
    });
  } catch (err) {
    console.error("Failed to write system log:", err);
  }
}
