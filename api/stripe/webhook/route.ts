import Stripe from "stripe";

export const runtime = "nodejs"; // important for Stripe lib
export const dynamic = "force-dynamic";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

async function sendEmailJS(templateParams: Record<string, any>) {
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: process.env.EMAILJS_SERVICE_ID,
      template_id: process.env.EMAILJS_TEMPLATE_ID,
      user_id: process.env.EMAILJS_PUBLIC_KEY,
      accessToken: process.env.EMAILJS_PRIVATE_KEY, // EmailJS private key
      template_params: templateParams,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS failed: ${res.status} ${text}`);
  }
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig as string,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const md = session.metadata || {};

    // Build the same fields you used in the browser EmailJS call
    const orderId = session.id; // or your own if you stored one
    const subjectBase = `${md.brand || "Yoghurt of Youth"} order – ${md.delivery_date || ""} – ${md.customer_name || ""}`;
    const subjectWithId = `${subjectBase} – ${orderId}`;

    const orderLines = (() => {
      try {
        const arr = JSON.parse(md.order_lines || "[]");
        return Array.isArray(arr) ? arr.join("\n") : String(md.order_lines || "");
      } catch {
        return String(md.order_lines || "");
      }
    })();

    // send EmailJS
    try {
      await sendEmailJS({
        brand: md.brand || "Yoghurt of Youth",
        owner_email: process.env.OWNER_EMAIL || "support@yoghurtofyouth.co.uk",

        customer_name: md.customer_name,
        customer_email: md.customer_email,
        customer_phone: md.customer_phone,

        delivery_date: md.delivery_date,
        delivery_window: md.delivery_window,
        customer_address: md.customer_address,

        order_lines: orderLines,
        bottles: Number(md.bottles || 0),

        yoghurt_strain: md.yoghurt_strain || "",

        plain_qty: Number(md.plain_qty || 0),
        flav_qty: Number(md.flav_qty || 0),
        plain_bundles: Number(md.plain_bundles || 0),
        flav_bundles: Number(md.flav_bundles || 0),
        plain_remainder: Number(md.plain_remainder || 0),
        flav_remainder: Number(md.flav_remainder || 0),

        // you were formatting in GBP in the browser; here just send strings like "£12.00"
        merchandise_total: `£${Number(md.merchandise_total || 0).toFixed(2)}`,
        delivery_fee: `£${Number(md.delivery_fee || 0).toFixed(2)}`,
        total_paid: `£${Number(md.total_paid || 0).toFixed(2)}`,

        payment_method: "Stripe",
        note: md.note || "",

        order_id: orderId,
        subject: subjectWithId,
      });
    } catch (e) {
      console.error("EmailJS send failed:", e);
      // You can still return 200 to avoid Stripe retry storms,
      // but better is: log + alert yourself.
    }
  }

  return new Response("ok", { status: 200 });
}
