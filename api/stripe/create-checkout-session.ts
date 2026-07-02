import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

// Persistent Stripe Product for the yoghurt (coupons' applies_to targets this)
const YOGHURT_PRODUCT_ID = "prod_Uo4XG1pLRRdGwC";

// If your totals are in GBP pounds (e.g. 12.50), convert to pence (1250)
function poundsToPence(amount: number) {
  return Math.round(Number(amount || 0) * 100);
}

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
    const { cart, totals, customer, delivery_method, delivery_date, delivery_window, note, lines, gift_code, discount_percent, gift_str_qty } = req.body as {
      cart: Record<string, number>;
      totals: any;
      customer: { name: string; email: string; phone: string; address: string };
      delivery_date: string;
      delivery_window: string;
      note?: string;
      lines?: string[];
      gift_code?: string;
      discount_percent?: number;
      gift_str_qty?: number;
      delivery_method?: "delivery";
    };

    if (!cart || !totals) {
      return res.status(400).json({ error: "Missing required checkout data." });
    }

    // ---- Gift code (client-side codes only: YOY25 free bottle). ----
    // NOTE: percentage discounts (MINUS10, first-order codes) are now handled
    // natively by Stripe promotion codes at checkout, NOT here.
    const giftCode = String(gift_code || "").trim().toUpperCase();
    const validGiftStrQty = giftCode === "YOY25" ? 1 : 0;

    // Amounts. merchTotal already includes 7-for-6 bundle pricing (pre-code-discount).
    const merchTotal = Number(totals.merchTotal || 0);
    const deliveryFee = Number(totals.deliveryFee || 0);
    const merchPence = poundsToPence(merchTotal);
    const deliveryPence = poundsToPence(deliveryFee);

    if (merchPence < 50) {
      return res.status(400).json({ error: "Total too small." });
    }

    // Lines: either provided from client (preferred), or fallback to ids
    const orderLines: string[] =
      Array.isArray(lines) && lines.length
        ? lines
        : Object.entries(cart).map(([id, qty]) => `${id} × ${qty}`);

    const orderId = `YOY-${Date.now().toString().slice(-6)}`;

    // ✅ Keep metadata small (Stripe metadata values are short strings)
    const metadata: Stripe.MetadataParam = {
      brand: "Yoghurt of Youth",

      customer_name: customer.name || "",
      customer_email: customer.email || "",
      customer_phone: customer.phone || "",
      customer_address: customer.address || "",

      delivery_date: delivery_date || "",
      delivery_window: delivery_window || "",
      note: note || "",

      delivery_method: "delivery",
      delivery_label: "Delivery",

      order_lines: JSON.stringify(orderLines).slice(0, 480),
      bottles: String(totals.qtyTotal ?? ""),
      plain_qty: String(totals.plainQty ?? ""),
      flav_qty: String(totals.flavQty ?? ""),
      plain_bundles: String(totals.plainBundles ?? ""),
      flav_bundles: String(totals.flavBundles ?? ""),
      plain_remainder: String(totals.plainRemainder ?? ""),
      flav_remainder: String(totals.flavRemainder ?? ""),
      merchandise_total: String(totals.merchTotal ?? ""),
      delivery_fee: String(totals.deliveryFee ?? ""),
      // NOTE: pre-discount total. Actual paid amount is read from the
      // completed session in the webhook (session.amount_total).
      total_paid: String(totals.total ?? ""),

      gift_code: giftCode,
      gift_str_qty: String(validGiftStrQty || 0),

      order_id: orderId,
      payment_provider: "stripe",
      yoghurt_strain: String(totals.deliveryBrand || ""),
    };

    const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const siteUrl = normalizeSiteUrl(rawSiteUrl || "");
    if (!siteUrl) return res.status(500).json({ error: "Missing NEXT_PUBLIC_SITE_URL" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
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

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}