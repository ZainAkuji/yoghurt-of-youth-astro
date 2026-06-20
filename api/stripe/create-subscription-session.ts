import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

function getPriceId(planKey: string) {
  const map: Record<string, string | undefined> = {
    PLN: process.env.STRIPE_PRICE_SUB_PLN,
    BFC: process.env.STRIPE_PRICE_SUB_BFC,
    STR: process.env.STRIPE_PRICE_SUB_STR,
    MNG: process.env.STRIPE_PRICE_SUB_MNG,
    MIX: process.env.STRIPE_PRICE_SUB_MIX,
  };
  const id = map[String(planKey)];
  if (!id) throw new Error("Missing Stripe price for plan: " + planKey);
  return id;
}

// Next Monday 21:00 (server local time). If that's < 48h away, push to the Monday after.
function nextMonday2100With48hRuleUnix(): number {
  const now = new Date();

  const d = new Date(now);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay(); // 0..6 (Sun..Sat)
  let addDays = (8 - day) % 7;
  if (addDays === 0) addDays = 7; // always "coming" Monday
  d.setDate(d.getDate() + addDays);

  // Monday 21:00
  d.setHours(21, 0, 0, 0);

  let trialEnd = Math.floor(d.getTime() / 1000);

  // Stripe requires trial_end at least 48h in the future
  const nowUnix = Math.floor(now.getTime() / 1000);
  const MIN_SECONDS = 48 * 60 * 60;

  if (trialEnd - nowUnix < MIN_SECONDS) {
    trialEnd += 7 * 24 * 60 * 60; // push one week
  }

  return trialEnd;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { planKey, customer, note } = req.body || {};
    if (!planKey) return res.status(400).json({ error: "Missing planKey" });

    const price = getPriceId(String(planKey));
    
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const trialEnd = nextMonday2100With48hRuleUnix();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      phone_number_collection: { enabled: true },
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["GB"] },

      subscription_data: {
        // ✅ first charge occurs at trial_end; repeats weekly because Price is weekly
        trial_end: trialEnd,
        metadata: {
          kind: "weekly_gut_punch",
          planKey: String(planKey),
          name: String(customer.name || ""),
          phone: String(customer.phone || ""),
          address: String(customer.address || ""),
          note: String(note || ""),
        },
      },

      success_url: `${siteUrl}/success?provider=stripe_sub&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/shop?pay=cancel&provider=stripe_sub`,
    });

    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
