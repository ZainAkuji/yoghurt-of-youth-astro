import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

// MUST MATCH src/config/dispatch.ts
const SUBSCRIPTION_DAY = 4; // Thursday

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// MUST MATCH BLOCKED_DISPATCH in src/config/dispatch.ts — refresh annually
const BLOCKED_DISPATCH = new Set([
  "2026-12-24", "2026-12-28", "2026-12-31",
  "2027-03-25", "2027-03-29",
  "2027-05-03", "2027-05-31", "2027-08-30",
  "2027-12-27", "2028-01-03",
  "2028-04-13", "2028-04-17",
  "2028-05-01", "2028-05-29", "2028-08-28",
  "2028-12-25", "2029-01-01",
]);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const TIERS = ["4", "7", "14"] as const;
const FLAVOURS = ["PLN", "BFC", "STR", "MNG", "MIX"] as const;

function getPriceId(planKey: string, tier: string) {
  const group = planKey === "PLN" ? "PLN" : "FLAV";
  const map: Record<string, string | undefined> = {
    PLN_4:   process.env.STRIPE_PRICE_SUB_PLN_4,
    PLN_7:   process.env.STRIPE_PRICE_SUB_PLN_7,
    PLN_14:  process.env.STRIPE_PRICE_SUB_PLN_14,
    FLAV_4:  process.env.STRIPE_PRICE_SUB_FLAV_4,
    FLAV_7:  process.env.STRIPE_PRICE_SUB_FLAV_7,
    FLAV_14: process.env.STRIPE_PRICE_SUB_FLAV_14,
  };
  const key = `${group}_${tier}`;
  const id = map[key];
  if (!id) throw new Error("Missing Stripe price for: " + key);
  return id;
}

const MIX_CONTENTS: Record<string, string> = {
  "4": "1 BFC, 2 STR, 1 MNG",
  "7": "2 BFC, 3 STR, 2 MNG",
  "14": "4 BFC, 6 STR, 4 MNG",
};

// Next subscription dispatch day at 21:00, skipping blocked dates and
// respecting Stripe's 48-hour minimum for trial_end.
function nextSubscriptionTrialEnd(): number {
  const now = new Date();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);

  let guard = 0;
  while (guard++ < 60) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== SUBSCRIPTION_DAY) continue;
    if (BLOCKED_DISPATCH.has(toISODate(d))) continue;

    const charge = new Date(d);
    charge.setHours(21, 0, 0, 0);
    const trialEnd = Math.floor(charge.getTime() / 1000);
    if (trialEnd - Math.floor(now.getTime() / 1000) >= 48 * 60 * 60) return trialEnd;
  }
  throw new Error("Could not find a valid subscription dispatch date");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { planKey, tier, customer, note } = req.body || {};
    if (!planKey) return res.status(400).json({ error: "Missing planKey" });

    const tierStr = String(tier || "7");
    if (!TIERS.includes(tierStr as any)) return res.status(400).json({ error: "Invalid tier" });
    if (!FLAVOURS.includes(String(planKey) as any)) return res.status(400).json({ error: "Invalid plan" });

    const price = getPriceId(String(planKey), tierStr);
    
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

        const trialEnd = nextSubscriptionTrialEnd();

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
          kind: "weekly_subscription",
          planKey: String(planKey),
          tier: tierStr,
          bottles: tierStr,
          contents: planKey === "MIX" ? MIX_CONTENTS[tierStr] : `${tierStr} × ${planKey}`,
          name: String(customer?.name || ""),
          phone: String(customer?.phone || ""),
          address: String(customer?.address || ""),
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
