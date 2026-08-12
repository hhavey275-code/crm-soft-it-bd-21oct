// Stripe webhook → auto-credit wallet on successful payment
// Public endpoint. Verifies Stripe signature.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (e: any) {
    console.error("Signature verification failed:", e.message);
    return new Response(`Webhook Error: ${e.message}`, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCompleted(supabase, session);
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await supabase
        .from("stripe_payment_links")
        .update({ status: "expired" })
        .eq("stripe_session_id", session.id)
        .eq("status", "pending");
    } else if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const reason = pi.last_payment_error;
      // Try to find by payment_intent or via customer + recent pending
      await supabase
        .from("stripe_payment_links")
        .update({
          status: "failed",
          failure_code: reason?.code || reason?.decline_code || "unknown",
          failure_message: reason?.message || "Payment failed",
          stripe_payment_intent_id: pi.id,
        })
        .eq("stripe_payment_intent_id", pi.id);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Webhook handler error:", e);
    return new Response(`Handler Error: ${e.message}`, { status: 500 });
  }
});

async function handleCompleted(supabase: any, session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return;

  // Find the link
  const { data: link } = await supabase
    .from("stripe_payment_links")
    .select("*")
    .eq("stripe_session_id", session.id)
    .single();
  if (!link) {
    console.warn("No link found for session", session.id);
    return;
  }
  if (link.status === "paid") {
    console.log("Already credited", session.id);
    return;
  }

  const userId = link.target_user_id;
  const amount = Number(link.amount_usd);

  // Mark link paid first (idempotency guard)
  const { data: updated, error: updErr } = await supabase
    .from("stripe_payment_links")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_payment_intent_id: session.payment_intent as string,
    })
    .eq("id", link.id)
    .eq("status", "pending")
    .select("id");
  if (updErr || !updated?.length) {
    console.log("Link already processed or update failed", updErr);
    return;
  }

  // Credit wallet — atomic RPC writes the ledger row AND the balance in one
  // transaction. Never read-then-write a balance: a stale read can inflate it.
  const { data: creditRes, error: creditErr } = await supabase.rpc("credit_wallet_for_payment", {
    p_user_id: userId,
    p_amount: amount,
    p_wallet_kind: "primary",
    p_reference_id: link.id,
    p_description: `Stripe payment (session ${session.id})`,
    p_processed_by: link.created_by,
  });
  if (creditErr || (creditRes as any)?.success === false) {
    console.error("Stripe wallet credit failed", creditErr || creditRes);
    throw new Error((creditErr as any)?.message || (creditRes as any)?.error || "wallet credit failed");
  }



  console.log(`Credited $${amount} to user ${userId}`);
}
