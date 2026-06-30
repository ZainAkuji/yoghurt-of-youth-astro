import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

// Generate a short, readable unique code with a recognisable YOY prefix
function generateCodeString(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `YOY${suffix}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const couponId = process.env.STRIPE_FIRST_ORDER_COUPON_ID;
    if (!couponId) {
      return res.status(500).json({ error: "Missing STRIPE_FIRST_ORDER_COUPON_ID" });
    }

    // Try a few times in the rare case of a code collision
    let promo: Stripe.PromotionCode | null = null;
    let lastError: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCodeString();
      try {
        promo = await stripe.promotionCodes.create({
          promotion: {
            type: "coupon",
            coupon: couponId,
          },
          code,
          max_redemptions: 1,
        } as any);
        break; // success
      } catch (e: any) {
        // If the code already exists, Stripe errors — retry with a new code
        lastError = e;
        if (e?.code === "resource_already_exists" || e?.raw?.code === "resource_already_exists") {
          continue;
        }
        throw e; // a different error — stop
      }
    }

    if (!promo) {
      console.error("Failed to create promo code:", lastError);
      return res.status(500).json({ error: "Could not generate a code. Please try again." });
    }

    return res.status(200).json({ code: promo.code, id: promo.id });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}