import { nextDispatchISO, formatDateUK, formatDispatchDate, strainForDispatch } from "../../lib/dispatch.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { computeTotals, isValidCart, MIN_ORDER_BOTTLES } from "../../lib/pricing.js";

// Persistent Stripe Product for the yoghurt (coupons' applies_to targets this)
const YOGHURT_PRODUCT_ID = "prod_Uo4XG1pLRRdGwC";

// Ensure URLs always include protocol (Stripe redirects behave better this way)
function normalizeSiteUrl(url: string) {
  const u = String(url || "").trim();
  if (!u) return u;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `https://${u}`;
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { cart, customer = {}, delivery_window, note, gift_code, expected_dispatch_iso } = (req.body || {}) as {
      cart: Record<string, number>;
      totals: any;
      customer?: { name?: string; email?: string; phone?: string; address?: string };
      delivery_date: string;
      expected_dispatch_iso?: string;
      delivery_window: string;
      note?: string;
      lines?: string[];
      gift_code?: string;
      discount_percent?: number;
      gift_str_qty?: number;
      delivery_method?: "delivery";
    };

    if (!isValidCart(cart)) {
      return res.status(400).json({ error: "Invalid basket. Please refresh the shop and try again." });
    }

    // ---- Gift code (client-side codes only: YOY25 free bottle). ----
    // NOTE: percentage discounts (MINUS10, first-order codes) are now handled
    // natively by Stripe promotion codes at checkout, NOT here.
    const giftCode = String(gift_code || "").trim().toUpperCase();
    const validGiftStrQty = giftCode === "YOY25" ? 1 : 0;

    // Always price the quantities on the server. Browser totals may be stale
    // (for example, a tab left open before a price change) or altered.
    const totals = computeTotals(cart, validGiftStrQty);
    const { merchPence, deliveryPence, totalPence } = totals;

    if (totals.bottles < MIN_ORDER_BOTTLES || !Number.isSafeInteger(totalPence) || totalPence > 99_999_999) {
      return res.status(400).json({ error: "Please order at least 3 bottles and check your quantities." });
    }

    const orderLines = totals.items.map(({ name, qty }) => `${name} × ${qty}`);
    if (validGiftStrQty) orderLines.push(`STR × 1 (FREE — ${giftCode})`);

    const dispatchISO = nextDispatchISO();
    if (expected_dispatch_iso && expected_dispatch_iso !== dispatchISO) {
      return res.status(409).json({ error: `The order cutoff has passed. Please review your new dispatch: ${formatDispatchDate(dispatchISO)}.`, dispatch_iso: dispatchISO });
    }

    const orderId = `YOY-${Date.now().toString().slice(-6)}`;

    // ✅ Keep metadata small (Stripe metadata values are short strings)
    const metadata: Stripe.MetadataParam = {
      brand: "Yoghurt of Youth",

      customer_name: customer.name || "",
      customer_email: customer.email || "",
      customer_phone: customer.phone || "",
      customer_address: customer.address || "",

      delivery_date: formatDateUK(dispatchISO),
      dispatch_iso: dispatchISO,
      delivery_window: delivery_window || "",
      note: note || "",

      delivery_method: "delivery",
      delivery_label: "Delivery",

      order_lines: JSON.stringify(orderLines).slice(0, 480),
      bottles: String(totals.qtyTotal ?? ""),
      plain_qty: String(totals.plainQty ?? ""),
      flav_qty: String(totals.flavQty ?? ""),
      plain_bundles: "0",
      flav_bundles: "0",
      plain_remainder: String(totals.plainQty),
      flav_remainder: String(totals.flavQty),
      merchandise_total: String(totals.merchTotal ?? ""),
      delivery_fee: String(totals.deliveryFee ?? ""),
      // NOTE: pre-discount total. Actual paid amount is read from the
      // completed session in the webhook (session.amount_total).
      total_paid: String(totals.total ?? ""),

      gift_code: giftCode,
      gift_str_qty: String(validGiftStrQty || 0),

      order_id: orderId,
      payment_provider: "stripe",
      yoghurt_strain: strainForDispatch(dispatchISO),
    };

    const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const siteUrl = normalizeSiteUrl(rawSiteUrl || "");
    if (!siteUrl) return res.status(500).json({ error: "Missing NEXT_PUBLIC_SITE_URL" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      custom_text: { submit: { message: `Dispatch: ${formatDispatchDate(dispatchISO)}. Chilled next-day delivery.` } },
      customer_creation: "always",
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ["GB"] },
      allow_promotion_codes: true,
      line_items: [
        {
          // Yoghurt line — tied to the Product so coupons' applies_to targets it.
          price_data: {
            currency: "gbp",
            product: YOGHURT_PRODUCT_ID,
            unit_amount: merchPence,
          },
          quantity: 1,
        },
        {
          // Delivery line — separate, NOT tied to the yoghurt product, so
          // promo codes (restricted to yoghurt) never discount it.
          price_data: {
            currency: "gbp",
            product_data: { name: "Chilled Next-Day Delivery" },
            unit_amount: deliveryPence,
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/shop?pay=cancel&provider=stripe`,
      metadata,
    });

    return res.status(200).json({ url: session.url, id: session.id, dispatch_iso: dispatchISO });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
