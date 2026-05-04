// Admin-only: Create Stripe Checkout Session for manual payment links
// Designed to MINIMIZE Stripe Radar declines via:
//  - Persistent Customer objects (reused per client)
//  - Required billing address collection
//  - Rich metadata + descriptor
//  - 3D Secure preferred via automatic_payment_methods
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return json({ error: "STRIPE_SECRET_KEY not configured. Add it in Supabase Edge Function secrets." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin/superadmin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: roles } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isAdmin = roles?.some((r: any) => r.role === "admin" || r.role === "superadmin");
    if (!isAdmin) return json({ error: "Admin only" }, 403);

    const body = await req.json();
    const { target_user_id, amount_usd, description } = body;
    if (!target_user_id || !amount_usd || amount_usd <= 0) {
      return json({ error: "target_user_id and amount_usd required" }, 400);
    }

    // Get target user profile
    const { data: profile } = await adminClient
      .from("profiles")
      .select("user_id, email, full_name, company, phone, stripe_customer_id")
      .eq("user_id", target_user_id)
      .single();
    if (!profile) return json({ error: "Target user not found" }, 404);

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    // Get or create persistent Stripe Customer (key Radar trust signal)
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email || undefined,
        name: profile.full_name || undefined,
        phone: profile.phone || undefined,
        description: profile.company || undefined,
        metadata: {
          internal_user_id: target_user_id,
          source: "admin_manual_topup",
        },
      });
      customerId = customer.id;
      await adminClient
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", target_user_id);
    }

    const origin = req.headers.get("origin") || "https://example.com";
    const amountCents = Math.round(Number(amount_usd) * 100);

    // Create Checkout Session — Radar-friendly settings
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      payment_method_types: ["card"],
      billing_address_collection: "required", // helps AVS match → reduces Radar decline
      phone_number_collection: { enabled: true },
      customer_update: {
        address: "auto",
        name: "auto",
        shipping: "auto",
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: description || `Wallet Top-up`,
              description: `Top-up for ${profile.full_name || profile.email}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        description: `Manual top-up — ${profile.full_name || profile.email}`,
        statement_descriptor_suffix: "TOPUP",
        metadata: {
          internal_user_id: target_user_id,
          created_by_admin: userData.user.id,
          purpose: "wallet_topup",
        },
      },
      metadata: {
        internal_user_id: target_user_id,
        created_by_admin: userData.user.id,
        purpose: "wallet_topup",
        amount_usd: String(amount_usd),
      },
      success_url: `${origin}/admin/stripe-links?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/admin/stripe-links?status=cancel`,
      expires_at: Math.floor(Date.now() / 1000) + 23 * 60 * 60, // 23h (Stripe max 24h)
    });

    // Persist link
    const { data: link, error: insertErr } = await adminClient
      .from("stripe_payment_links")
      .insert({
        target_user_id,
        created_by: userData.user.id,
        amount_usd,
        currency: "usd",
        stripe_session_id: session.id,
        stripe_customer_id: customerId,
        checkout_url: session.url!,
        status: "pending",
        expires_at: new Date((session.expires_at as number) * 1000).toISOString(),
        metadata: { description: description || null },
      })
      .select()
      .single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    return json({ url: session.url, session_id: session.id, link });
  } catch (e: any) {
    console.error("create-stripe-checkout error", e);
    return json({ error: e.message || String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
