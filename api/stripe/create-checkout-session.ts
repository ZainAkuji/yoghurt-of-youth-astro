import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { Redis } from "@upstash/redis";  // ← correct import

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

    // ---- Gift code: validate and enforce 10% discount server-side ----
    const giftCode = String(gift_code || "").trim().toUpperCase();
    const clientDiscountPercent = Number(discount_percent || 0);
    const clientGiftStrQty = Number(gift_str_qty || 0);

    // Server decides the benefit — never trust the client values
    const validDiscountPercent = giftCode === "MINUS10" ? 10 : 0;
    const validGiftStrQty = giftCode === "YOY25" ? 1 : 0;
    const giftApplies = validDiscountPercent > 0 || validGiftStrQty > 0;

    if ((clientDiscountPercent > 0 || clientGiftStrQty > 0) && !giftApplies) {
      return res.status(400).json({ error: "Invalid gift code." });
    }

    // Recalculate server-side to prevent tampering
    const merchTotal = Number(totals.merchTotal || 0);
    const deliveryFee = Number(totals.deliveryFee || 0);
    const discountAmount = validDiscountPercent > 0
      ? Math.round(merchTotal * validDiscountPercent) / 100
      : 0;
    const totalPounds = Math.max(0, merchTotal - discountAmount + deliveryFee);
    const amountPence = poundsToPence(totalPounds);

    if (amountPence < 50) {
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
      // for EmailJS template
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

      // order summary fields used by your EmailJS template
      order_lines: JSON.stringify(orderLines).slice(0, 480), // safety cap
      bottles: String(totals.qtyTotal ?? ""),
      plain_qty: String(totals.plainQty ?? ""),
      flav_qty: String(totals.flavQty ?? ""),
      plain_bundles: String(totals.plainBundles ?? ""),
      flav_bundles: String(totals.flavBundles ?? ""),
      plain_remainder: String(totals.plainRemainder ?? ""),
      flav_remainder: String(totals.flavRemainder ?? ""),
      merchandise_total: String(totals.merchTotal ?? ""),
      delivery_fee: String(totals.deliveryFee ?? ""),
      total_paid: String(totals.total ?? ""),

      // gift / discount fields
      gift_code: giftCode,
      discount_percent: String(validDiscountPercent || 0),
      discount_amount: String(discountAmount.toFixed(2)),
      gift_str_qty: String(validGiftStrQty || 0),

      // internal id you like
      order_id: orderId,
      payment_provider: "stripe",

      // if you pass this from client, include it; otherwise blank
      yoghurt_strain: String(totals.deliveryBrand || ""),
    };

    const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_DOMAIN;
    const siteUrl = normalizeSiteUrl(rawSiteUrl || "");
    if (!siteUrl) return res.status(500).json({ error: "Missing NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_DOMAIN" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",
      billing_address_collection: "required",
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ["GB"] },
      line_items: [
        {
          price_data: {
            currency: "gbp",
            product_data: { name: "Yoghurt of Youth order" },
            unit_amount: amountPence,
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
