import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import Stripe from "stripe";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// All Stripe, Redis and email calls are intercepted. No live credentials/data.
process.env.STRIPE_SECRET_KEY = "sk_test_schedule_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_schedule_only";
process.env.STRIPE_PRICE_SUB_PLN_7 = "price_test";
process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
process.env.RESEND_API_KEY = "test_only";
process.env.OWNER_EMAIL = "owner@example.test";
process.env.STORAGE2_KV_REST_API_URL = "https://redis.example.test";
process.env.STORAGE2_KV_REST_API_TOKEN = "test_only";
process.env.META_CAPI_ACCESS_TOKEN = "";
const { default: subscribe } = await import("../api/stripe/create-subscription-session.js");
const { default: checkout } = await import("../api/stripe/create-checkout-session.js");
const { default: verify } = await import("../api/stripe/verify-session.js");
const { default: webhook } = await import("../api/stripe/webhook.js");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sessions = Object.getPrototypeOf(stripe.checkout.sessions);
const subscriptions = Object.getPrototypeOf(stripe.subscriptions);
const prices = Object.getPrototypeOf(stripe.prices);
function response() {
  return { code: 200, data: undefined as any,
    status(code: number) { this.code = code; return this; },
    json(data: any) { this.data = data; return this; },
    send(data: any) { this.data = data; return this; },
  };
}

test("checkout saves the selected weekday; stale dates require review; no existing subscriptions are edited", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-24T20:00:01Z") });
  const sent: Stripe.Checkout.SessionCreateParams[] = [];
  t.mock.method(prices, "retrieve", async () => ({ product: "prod_test" }));
  t.mock.method(sessions, "create", async (p: Stripe.Checkout.SessionCreateParams) => { sent.push(p); return { id: "cs_test", url: "https://example.test" }; });
  const update = t.mock.method(subscriptions, "update", () => { throw new Error("Must not migrate existing subscriptions"); });
  const run = async (handler: typeof subscribe, body: any) => {
    const res = response(); await handler({ method: "POST", body } as VercelRequest, res as unknown as VercelResponse); return res;
  };
  let res = await run(subscribe, { planKey: "PLN", tier: "7", expected_dispatch_iso: "2026-10-26" });
  assert.equal(res.code, 409);
  assert.equal(sent.length, 0);
  res = await run(subscribe, { planKey: "PLN", tier: "7", expected_dispatch_iso: "2026-10-29" });
  assert.equal(res.code, 200);
  assert.equal(res.data.dispatch_weekday, "Thursday");
  const params = sent[0];
  assert.equal(params.metadata?.first_dispatch_iso, "2026-10-29");
  assert.equal(params.subscription_data?.metadata?.dispatch_weekday, "Thursday");
  assert.equal(params.subscription_data?.trial_end, Date.parse("2026-10-29T21:00:00Z") / 1000);
  assert.match(JSON.stringify(params.custom_text), /29\/10\/2026.*Thursday/);
  res = await run(checkout, { cart: { PLN: 7 }, delivery_date: "26/10/2026", expected_dispatch_iso: "2026-10-26" });
  assert.equal(res.code, 409);
  res = await run(checkout, { cart: { PLN: 7 }, delivery_date: "01/01/2000", expected_dispatch_iso: "2026-10-29" });
  assert.equal(res.code, 200);
  assert.equal(sent[1].metadata?.delivery_date, "29/10/2026");
  t.mock.timers.setTime(new Date("2026-10-27T21:00:00Z").getTime());
  res = await run(subscribe, { planKey: "PLN", tier: "7" });
  assert.equal(res.data.dispatch_iso, "2026-11-02");
  assert.equal(res.data.dispatch_weekday, "Monday");
  assert.equal(update.mock.callCount(), 0);
});

test("verification uses saved scheduling and never confirms an incomplete subscription checkout", async t => {
  let session: any = { id: "cs_test", mode: "subscription", status: "open", metadata: {} };
  t.mock.method(sessions, "retrieve", async () => session);
  let res = response();
  await verify({ query: { session_id: "cs_test" } } as unknown as VercelRequest, res as unknown as VercelResponse);
  assert.equal(res.data.paid, false);
  session = { ...session, status: "complete", metadata: { first_dispatch_iso: "2026-10-29", dispatch_weekday: "Thursday" } };
  res = response();
  await verify({ query: { session_id: "cs_test" } } as unknown as VercelRequest, res as unknown as VercelResponse);
  assert.equal(res.data.paid, true);
  assert.equal(res.data.dispatch_iso, "2026-10-29");
  assert.equal(res.data.dispatch_weekday, "Thursday");
});

test("signed checkout webhook sends both confirmation emails with each subscriber's weekday", async t => {
  let sub: any;
  const mails: any[] = [];
  t.mock.method(subscriptions, "retrieve", async () => sub);
  t.mock.method(sessions, "listLineItems", async () => ({ data: [{ price: { unit_amount: 1749, currency: "gbp" } }] }));
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.resend.com/emails") {
      mails.push(JSON.parse(String(options?.body)));
      return new Response('{"id":"email_test"}', { status: 200 });
    }
    if (url.startsWith("https://redis.example.test")) {
      const body = JSON.parse(String(options?.body));
      return new Response(JSON.stringify(Array.isArray(body[0]) ? body.map(() => ({ result: null })) : { result: null }), { status: 200 });
    }
    throw new Error(`Unexpected external request: ${url}`);
  });
  for (const [iso, weekday, legacy] of [["2026-10-29", "Thursday", false], ["2026-11-02", "Monday", false], ["2026-10-29", "Thursday", true]] as const) {
    sub = { id: "sub_test", metadata: { planKey: "PLN", tier: "7", ...(legacy ? {} : { first_dispatch_iso: iso, dispatch_weekday: weekday }) }, trial_end: Date.parse(`${iso}T21:00:00Z`) / 1000 };
    const event = { id: `evt_${weekday}_${legacy}`, type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { id: "cs_test", mode: "subscription", subscription: "sub_test", customer_details: { name: "Test Customer", email: "customer@example.test" } } } };
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    const req = Readable.from([Buffer.from(payload)]) as unknown as VercelRequest;
    req.method = "POST"; req.headers = { "stripe-signature": signature };
    const res = response();
    const before = mails.length;
    await webhook(req, res as unknown as VercelResponse);
    assert.equal(res.code, 200);
    assert.equal(mails.length - before, 2);
    const [owner, customer] = mails.slice(before);
    assert.equal(owner.to, "owner@example.test");
    assert.equal(customer.to, "customer@example.test");
    for (const email of [owner, customer]) {
      assert.ok(email.html.includes(iso.split("-").reverse().join("/")));
      assert.ok(email.html.includes(weekday));
      assert.ok(!email.html.includes(weekday === "Thursday" ? "Monday" : "Thursday"));
      assert.ok(email.html.includes("£17.49"));
    }
  }
});
