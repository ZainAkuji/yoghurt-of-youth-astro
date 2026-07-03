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

async function createUniqueCode(): Promise<string | null> {
  const couponId = process.env.STRIPE_FIRST_ORDER_COUPON_ID;
  if (!couponId) throw new Error("Missing STRIPE_FIRST_ORDER_COUPON_ID");

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCodeString();
    try {
      const promo = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: couponId },
        code,
        max_redemptions: 1,
      } as any);
      return promo.code;
    } catch (e: any) {
      if (e?.code === "resource_already_exists" || e?.raw?.code === "resource_already_exists") {
        continue; // collision, retry
      }
      throw e;
    }
  }
  return null;
}

function buildWelcomeHtml(code: string) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#333;padding:16px;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:auto;background-color:#fff;border-top:6px solid #1e293b;">
    <div style="padding:16px;background-color:#f9fafb;border-bottom:1px solid #e2e8f0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tbody><tr>
        <td style="vertical-align:middle;"><img src="https://yoghurtofyouth.co.uk/logo.png" alt="Yoghurt of Youth" height="32" style="display:block;"></td>
        <td style="vertical-align:middle;padding-left:8px;font-size:18px;font-weight:700;">Yoghurt of Youth</td>
      </tr></tbody></table>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 14px;">Welcome to <strong>Yoghurt of Youth</strong>!</p>
      <p style="margin:0 0 14px;">Thanks for joining us. Here's <strong>10% off your first order</strong> as a welcome gift.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:18px;margin:0 0 16px;text-align:center;">
        <div style="font-size:13px;color:#555;margin-bottom:6px;">Your code</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:2px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#1e293b;">${code}</div>
      </div>
      <p style="margin:0 0 14px;">To use it, add your yoghurt to the basket, head to the secure checkout, and enter this code in the <strong>promotion code</strong> box. Your 10% discount will apply to your yoghurt.</p>
      <p style="margin:0 0 14px;color:#555;font-size:14px;">Please note: this code is valid for <strong>one use only</strong>, on your first order.</p>
      <div style="text-align:center;margin:22px 0;">
        <a href="https://yoghurtofyouth.co.uk/shop" style="display:inline-block;background:#fbbf24;padding:12px 28px;border-radius:10px;text-decoration:none;"><span style="color:#1a1a2e !important;font-weight:700;font-family:Arial,sans-serif;font-size:16px;text-decoration:none;">Shop now</span></a>
      </div>
      <p style="margin:16px 0 0;"><strong>– The Yoghurt of Youth Team</strong></p>
    </div>
    <div style="border-top:1px solid #e2e8f0;margin:0 20px;"></div>
    <div style="padding:16px;text-align:center;background-color:#f9fafb;">
      <p style="margin:0 0 8px;"><a href="https://www.instagram.com/yoghurtofyouth" style="color:#0ea5e9;font-weight:600;text-decoration:none;">📸 Follow us on Instagram</a></p>
    </div>
    <div style="padding:12px;text-align:center;font-size:12px;color:#777;border-top:1px solid #e2e8f0;">
      Yoghurt of Youth · Blackburn, Lancashire
    </div>
  </div>
</div>`;
}

async function sendResend(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Missing RESEND_API_KEY");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Yoghurt of Youth <support@yoghurtofyouth.co.uk>",
      to,
      subject,
      html,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Resend failed: ${r.status} ${text}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  // --- Shared-secret guard ---
  const secret = process.env.WELCOME_CODE_SECRET;
  const provided = req.headers["x-welcome-secret"];
  if (!secret || provided !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { email } = req.body as { email?: string };
    const to = String(email || "").trim();
    if (!to || !to.includes("@")) {
      return res.status(400).json({ error: "Valid email required." });
    }

    const code = await createUniqueCode();
    if (!code) {
      return res.status(500).json({ error: "Could not generate a code. Please try again." });
    }

    await sendResend(to, "Your 10% welcome code", buildWelcomeHtml(code));

    return res.status(200).json({ ok: true, code });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}