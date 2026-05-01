// netlify/functions/gumroad-webhook.js
//
// Gumroad → Debrief webhook.
// Configure in Gumroad: Settings → Advanced → Ping URL
//   https://getdebriefs.com/api/gumroad-webhook
// Resource: sale (and optionally cancellation, refund)
//
// Required Netlify env vars:
//   SUPABASE_URL          (your Supabase project URL)
//   SUPABASE_SERVICE_KEY  (the service_role key, NOT the anon key)
//   GUMROAD_PING_TOKEN    (any string you choose; pass it as ?token=... in the Ping URL)

const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  // Optional shared-secret check (Gumroad passes ?token=... if added to ping URL)
  const queryToken = event.queryStringParameters?.token;
  const expectedToken = process.env.GUMROAD_PING_TOKEN;
  if (expectedToken && queryToken !== expectedToken) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  // Gumroad sends form-encoded data
  const params = new URLSearchParams(event.body || "");
  const email = params.get("email");
  const resourceName = params.get("resource_name") || "sale"; // "sale" | "subscription_ended" | "refund"
  const productPermalink = params.get("permalink") || "";
  const productName = params.get("product_name") || "";
  const recurrence = params.get("recurrence") || "";

  if (!email) {
    return { statusCode: 400, body: "Missing email" };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Find the user by email (auth.users → profiles)
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (profileError) {
    console.error("Profile lookup error:", profileError);
    return { statusCode: 500, body: "Lookup failed" };
  }

  if (!profile) {
    // User hasn't signed up yet. Log it; they'll get flagged when they sign up later
    // (you can also build a "pending payments" table here)
    console.warn(`Gumroad webhook: no Debrief account for email ${email}`);
    return { statusCode: 200, body: "OK (no user found)" };
  }

  // Determine new paid status
  let isPaid = true;
  if (resourceName === "refund" || resourceName === "subscription_ended" || resourceName === "cancelled") {
    isPaid = false;
  }

  const update = {
    is_paid: isPaid,
    paid_plan: productName || productPermalink,
    paid_at: isPaid ? new Date().toISOString() : null,
  };

  const { error: updateError } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", profile.id);

  if (updateError) {
    console.error("Profile update error:", updateError);
    return { statusCode: 500, body: "Update failed" };
  }

  console.log(`Gumroad webhook: ${email} → is_paid=${isPaid} (${resourceName})`);
  return { statusCode: 200, body: "OK" };
};
