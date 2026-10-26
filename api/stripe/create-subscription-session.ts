import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { subscriptionWeeklyPence } from "../../lib/pricing.js";

import { subscriptionSchedule, formatDispatchDate } from "../../lib/dispatch.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

const TIERS = ["4", "7", "14", "21"] as const;
const FLAVOURS = ["PLN", "BFC", "STR", "MNG", "MIX"] as const;

function getPriceId(planKey: string, tier: string) {
  const group = planKey === "PLN" ? "PLN" : "FLAV";
  const map: Record<string, string | undefined> = {
    PLN_4:   process.env.STRIPE_PRICE_SUB_PLN_4,
    PLN_7:   process.env.STRIPE_PRICE_SUB_PLN_7,
    PLN_14:  process.env.STRIPE_PRICE_SUB_PLN_14,
    PLN_21:  process.env.STRIPE_PRICE_SUB_PLN_21,
    FLAV_4:  process.env.STRIPE_PRICE_SUB_FLAV_4,
    FLAV_7:  process.env.STRIPE_PRICE_SUB_FLAV_7,
    FLAV_14: process.env.STRIPE_PRICE_SUB_FLAV_14,
    FLAV_21: process.env.STRIPE_PRICE_SUB_FLAV_21,
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
  "21": "6 BFC, 9 STR, 6 MNG",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { planKey, tier, customer, note, expected_dispatch_iso } = req.body || {};
    if (!planKey) return res.status(400).json({ error: "Missing planKey" });

    const tierStr = String(tier || "7");
    if (!TIERS.includes(tierStr as any)) return res.status(400).json({ error: "Invalid tier" });
    if (!FLAVOURS.includes(String(planKey) as any)) return res.status(400).json({ error: "Invalid plan" });

    // Reuse the existing subscription Product, but price NEW subscriptions
    // from the same rules as the shop. Existing subscriptions keep their Price.
    const previousPrice = await stripe.prices.retrieve(getPriceId(String(planKey), tierStr));
    const product = typeof previousPrice.product === "string"
      ? previousPrice.product
      : previousPrice.product.id;
    const weeklyPence = subscriptionWeeklyPence(String(planKey), tierStr);
    
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

    const schedule = subscriptionSchedule();
    if (expected_dispatch_iso && expected_dispatch_iso !== schedule.dispatchISO) {
      return res.status(409).json({ error: `The order cutoff has passed. Please review your new first dispatch: ${formatDispatchDate(schedule.dispatchISO)}.`, dispatch_iso: schedule.dispatchISO });
    }
    const scheduleMetadata = {
      first_dispatch_iso: schedule.dispatchISO,
      dispatch_weekday: schedule.weekday,
      schedule_version: "uk-cutoff-v2",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      metadata: scheduleMetadata,
      // Hold this dispatch slot for a short checkout session, not a full day.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      custom_text: { submit: { message: `First dispatch: ${formatDispatchDate(schedule.dispatchISO)}. Then dispatched and billed every ${schedule.weekday}; delivery is normally the following day. Bank holidays may shift dispatch.` } },
      line_items: [{
        price_data: {
          currency: "gbp",
          product,
          unit_amount: weeklyPence,
          recurring: { interval: "week", interval_count: 1 },
        },
        quantity: 1,
      }],
      phone_number_collection: { enabled: true },
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["GB"] },

      subscription_data: {
        // ✅ first charge occurs at trial_end; repeats weekly because Price is weekly
        trial_end: schedule.trialEnd,
        metadata: {
          ...scheduleMetadata,
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

    return res.status(200).json({ url: session.url, dispatch_iso: schedule.dispatchISO, dispatch_weekday: schedule.weekday });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
