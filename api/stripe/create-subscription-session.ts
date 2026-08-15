import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

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

// Next Thursday 21:00 (server local time). If that's < 48h away, push to the Thursday after.
function nextThursday2100With48hRuleUnix(): number {
  const now = new Date();

  const d = new Date(now);
  d.setHours(0, 0, 0, 0);

  const day = d.getDay(); // 0..6 (Sun..Sat), Thursday = 4
  let addDays = (4 - day + 7) % 7;
  if (addDays === 0) addDays = 7; // always the "coming" Thursday
  d.setDate(d.getDate() + addDays);

  // Thursday 21:00
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

    const { planKey, tier, customer, note } = req.body || {};
    if (!planKey) return res.status(400).json({ error: "Missing planKey" });

    const tierStr = String(tier || "7");
    if (!TIERS.includes(tierStr as any)) return res.status(400).json({ error: "Invalid tier" });
    if (!FLAVOURS.includes(String(planKey) as any)) return res.status(400).json({ error: "Invalid plan" });

    const price = getPriceId(String(planKey), tierStr);
    
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const trialEnd = nextThursday2100With48hRuleUnix();

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
