import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

function safeJoinAddress(addr: any) {
  if (!addr || typeof addr !== "object") return "";
  return [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country]
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .join(", ");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session_id = String(req.query.session_id || "");
  if (!session_id) return res.status(400).json({ error: "Missing session_id" });
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    const paid =
      session.payment_status === "paid" ||
      session.mode === "subscription";

    const order_id =
      session.metadata?.orderId ||
      session.metadata?.order_id ||
      session.id;

    const cd = (session.customer_details || {}) as any;
    const shippingAddr =
      (session as any).shipping_details?.address ||
      (session as any).collected_information?.shipping_details?.address ||
      null;

    const shipName =
      (session as any).shipping_details?.name ||
      (session as any).collected_information?.shipping_details?.name ||
      "";
    const customer_name = String(cd.name || shipName || "");
    const customer_address = safeJoinAddress(shippingAddr) || safeJoinAddress(cd.address) || "";

    return res.status(200).json({ paid, order_id, customer_name, customer_address });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Stripe verify failed" });
  }
}
