import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { computeTotals, isValidCart, SUB_PRICING, subscriptionWeeklyPence } from "../lib/pricing.js";

// Dummy credentials only. Every Stripe method used here is mocked below.
process.env.STRIPE_SECRET_KEY = "sk_test_pricing_tests_only";
process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
for (const group of ["PLN", "FLAV"]) {
  for (const tier of [4, 7, 14, 21]) {
    process.env[`STRIPE_PRICE_SUB_${group}_${tier}`] = `price_old_${group}_${tier}`;
  }
}
const { default: checkout } = await import("../api/stripe/create-checkout-session.js");
const { default: subscribe } = await import("../api/stripe/create-subscription-session.js");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sessionsPrototype = Object.getPrototypeOf(stripe.checkout.sessions);
const pricesPrototype = Object.getPrototypeOf(stripe.prices);

async function invoke(handler: typeof checkout, body: unknown) {
  let status = 200;
  let json: any;
  const response = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { json = value; return this; },
  };
  await handler({ method: "POST", body } as VercelRequest, response as VercelResponse);
  return { status, json };
}

const cases = [
  // Quantity, merchandise pence, delivery pence; all plain.
  [0, 0, 0], [3, 597, 350], [4, 796, 350], [5, 995, 495],
  [7, 1393, 495], [10, 1990, 495], [13, 2587, 495],
  [14, 2786, 0], [15, 2985, 0], [21, 4179, 0], [35, 6965, 0],
];
for (const [qty, merchandise, delivery] of cases) {
  test(`${qty} plain bottles: correct price and delivery, with no bundle discount`, () => {
    const result = computeTotals({ PLN: qty });
    assert.equal(result.merchPence, merchandise);
    assert.equal(result.deliveryPence, delivery);
    assert.equal(result.total, (merchandise + delivery) / 100);
    assert.equal(result.bottles, qty);
  });
}

test("all three flavours cost 209p; mixed quantities qualify together", () => {
  for (const id of ["BFC", "STR", "MNG"]) {
    assert.equal(computeTotals({ [id]: 7 }).merchPence, 1463);
  }
  const mixed = computeTotals({ PLN: 5, BFC: 3, STR: 4, MNG: 2 });
  assert.equal(mixed.merchPence, 2876);
  assert.equal(mixed.deliveryPence, 0);
  assert.equal(mixed.qtyTotal, 14);
  assert.equal(computeTotals({ PLN: 5, BFC: 3, STR: 3, MNG: 2 }).deliveryPence, 495);
});

test("a gift bottle counts for fulfilment but does not unlock free delivery", () => {
  const result = computeTotals({ PLN: 13 }, 1);
  assert.equal(result.qtyTotal, 14);
  assert.equal(result.bottles, 13);
  assert.equal(result.merchPence, 2587);
  assert.equal(result.deliveryPence, 495);
});

test("subscription totals retain percentage savings, without free bottles", () => {
  const expected = [
    // Tier, plain merchandise pence, flavoured merchandise pence, delivery pence.
    [4, 756, 794, 350], [7, 1254, 1317, 495],
    [14, 2368, 2487, 0], [21, 3343, 3511, 0],
  ];
  for (const [tier, plain, flavoured, delivery] of expected) {
    assert.equal(SUB_PRICING[tier].plnNow, plain / 100);
    assert.equal(SUB_PRICING[tier].flavNow, flavoured / 100);
    assert.equal(subscriptionWeeklyPence("PLN", String(tier)), plain + delivery);
    for (const flavour of ["BFC", "STR", "MNG", "MIX"]) {
      assert.equal(subscriptionWeeklyPence(flavour, String(tier)), flavoured + delivery);
    }
  }
  assert.throws(() => subscriptionWeeklyPence("PLN", "10"));
  assert.throws(() => subscriptionWeeklyPence("UNKNOWN", "7"));
});

test("checkout charges the shared prices and derives email/profit metadata from quantities", async (t) => {
  const sent: Stripe.Checkout.SessionCreateParams[] = [];
  t.mock.method(sessionsPrototype, "create", async (params: Stripe.Checkout.SessionCreateParams) => {
    sent.push(params);
    return { id: "cs_test", url: "https://example.test/checkout" };
  });
  for (const [qty, merchandise, delivery] of cases.filter(([qty]) => qty >= 3)) {
    const result = await invoke(checkout, {
      cart: { PLN: qty },
      // Deliberately wrong/stale totals and lines must never control the charge.
      totals: { merchTotal: 0.01, deliveryFee: 0, qtyTotal: 1, total: 0.01 },
      lines: ["Incorrect free bottles"],
      customer: { name: "Test buyer" },
    });
    assert.equal(result.status, 200);
    const params = sent.at(-1)!;
    assert.equal(params.line_items?.[0].price_data?.unit_amount, merchandise);
    assert.equal(params.line_items?.[1].price_data?.unit_amount, delivery);
    assert.equal(params.metadata?.bottles, String(qty));
    assert.equal(params.metadata?.total_paid, String((merchandise + delivery) / 100));
    assert.equal(params.metadata?.merchandise_total, String(merchandise / 100));
    assert.equal(params.metadata?.order_lines, JSON.stringify([`PLN × ${qty}`]));
    assert.equal(params.allow_promotion_codes, true);
    assert.equal(params.line_items?.[0].price_data?.product, "prod_Uo4XG1pLRRdGwC");
  }
  await invoke(checkout, { cart: { PLN: 13 }, gift_code: "YOY25" });
  const gift = sent.at(-1)!;
  assert.equal(gift.metadata?.bottles, "14");
  assert.equal(gift.metadata?.gift_str_qty, "1");
  assert.equal(gift.metadata?.delivery_fee, "4.95");
  assert.match(String(gift.metadata?.order_lines), /STR × 1/);
});

test("invalid quantities and orders below the minimum never reach Stripe", async (t) => {
  const create = t.mock.method(sessionsPrototype, "create", () => { throw new Error("Must not reach Stripe"); });
  for (const cart of [null, [], { PLN: -3 }, { PLN: 3.5 }, { PLN: "3" }, { UNKNOWN: 14 }]) {
    assert.equal(isValidCart(cart), false);
    assert.equal((await invoke(checkout, { cart })).status, 400);
  }
  for (const cart of [{}, { PLN: 2 }, { PLN: Number.MAX_SAFE_INTEGER }]) {
    assert.equal((await invoke(checkout, { cart, gift_code: "YOY25" })).status, 400);
  }
  assert.equal(create.mock.callCount(), 0);
});

test("new Stripe subscriptions use the displayed weekly price and keep fulfilment metadata", async (t) => {
  const sent: Stripe.Checkout.SessionCreateParams[] = [];
  t.mock.method(pricesPrototype, "retrieve", async (id: string) => {
    // An old, expensive Price is used only to locate its existing Product.
    return { id, product: "prod_subscription", unit_amount: 9999 };
  });
  t.mock.method(sessionsPrototype, "create", async (params: Stripe.Checkout.SessionCreateParams) => {
    sent.push(params);
    return { id: "cs_test_subscription", url: "https://example.test/subscribe" };
  });
  const update = t.mock.method(Object.getPrototypeOf(stripe.subscriptions), "update", () => {
    throw new Error("Existing subscriptions must not be changed");
  });
  for (const tier of ["4", "7", "14", "21"]) {
    for (const planKey of ["PLN", "BFC", "STR", "MNG", "MIX"]) {
      const result = await invoke(subscribe, { planKey, tier });
      assert.equal(result.status, 200);
      const params = sent.at(-1)!;
      assert.equal(params.line_items?.length, 1);
      const price = params.line_items?.[0].price_data!;
      assert.equal(price.unit_amount, subscriptionWeeklyPence(planKey, tier));
      assert.equal(price.product, "prod_subscription");
      assert.deepEqual(price.recurring, { interval: "week", interval_count: 1 });
      assert.equal(params.subscription_data?.metadata?.tier, tier);
      assert.equal(params.subscription_data?.metadata?.planKey, planKey);
      assert.ok(Number(params.subscription_data?.trial_end) > Date.now() / 1000);
    }
  }
  assert.equal(update.mock.callCount(), 0);
  assert.equal((await invoke(subscribe, { planKey: "PLN", tier: "10" })).status, 400);
  assert.equal((await invoke(subscribe, { planKey: "UNKNOWN", tier: "7" })).status, 400);
});
