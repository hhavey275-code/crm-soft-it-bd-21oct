import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Attach the signed-in user's token to every server function call.
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
}));
