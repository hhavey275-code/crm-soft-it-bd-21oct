import { supabase } from "@/integrations/supabase/client";

let schemaChecked = false;

export async function ensureSchema() {
  if (schemaChecked) return;
  schemaChecked = true;

  try {
    const { data, error } = await supabase.functions.invoke("ensure-schema");
    if (error) {
      console.warn("[ensureSchema] Error:", error.message);
      return;
    }
    if (data?.tables_created > 0) {
      console.log("[ensureSchema] Database initialized:", data.message);
    }
  } catch (e) {
    console.warn("[ensureSchema] Failed:", e);
  }
}
