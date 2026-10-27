import test from "node:test";
import assert from "node:assert/strict";
import { estimateOrderProfit, profitEmailHtml } from "../lib/order-profit.js";
import { formatPoas, periodPoas } from "../lib/poas-history.js";
import { computeTotals } from "../lib/pricing.js";

// Independent expected delivery costs at every boundary, including large orders.
for (const [bottles, deliveryCostPence] of [
  [3, 506], [4, 506], [5, 506], [6, 759], [8, 759],
  [9, 777], [14, 777], [15, 795], [21, 795], [35, 795],
]) {
  test(`${bottles} bottles use the correct fulfilment cost, even with free customer delivery`, () => {
    assert.equal(estimateOrderProfit(3000, bottles)?.deliveryCostPence, deliveryCostPence);
  });
}

test("five plain bottles cost the customer £13.45 and yield £5.49 estimated profit", () => {
  const totals = computeTotals({ PLN: 5 });
  assert.equal(totals.totalPence, 1345);
  assert.deepEqual(estimateOrderProfit(totals.totalPence, totals.qtyTotal), {
    bottleCostPence: 250,
    deliveryCostPence: 506,
    stripeFeePence: 40,
    totalCostPence: 796,
    profitPence: 549,
  });
  // A Stripe discount reduces actual revenue and fees, without reducing shipping cost.
  assert.deepEqual(estimateOrderProfit(1245, 5), {
    bottleCostPence: 250, deliveryCostPence: 506, stripeFeePence: 39,
    totalCostPence: 795, profitPence: 450,
  });
});

test("gift bottles affect actual delivery costs, not customer delivery bands", () => {
  for (const [purchased, customerCharge, shippingCost] of [[5, 350, 759], [8, 495, 777], [14, 0, 795]]) {
    const totals = computeTotals({ PLN: purchased }, 1);
    const estimate = estimateOrderProfit(totals.totalPence, totals.qtyTotal)!;
    assert.equal(totals.deliveryPence, customerCharge);
    assert.equal(estimate.deliveryCostPence, shippingCost);
    assert.equal(estimate.bottleCostPence, (purchased + 1) * 50);
  }
});

test("owner email and daily POAS use the revised costs and preserve historical profit inputs", () => {
  const five = estimateOrderProfit(1345, 5)!;
  const six = estimateOrderProfit(1689, 6)!;
  assert.equal(six.profitPence, 585);
  const html = profitEmailHtml(five, "2026-10-27", [2, five.profitPence + six.profitPence, 0]);
  assert.match(html, /Delivery cost[\s\S]*?£5\.06/);
  assert.match(html, /Total cost[\s\S]*?£7\.96/);
  assert.match(html, /Today's running profit[\s\S]*?£11\.34/);
  assert.match(html, /running POAS[\s\S]*?0\.95×/);
  assert.match(html, /profit after daily ad spend[\s\S]*?-£0\.66/);
  const days = [
    { day: "2026-10-26", profit: 800, unknown: 0 },
    { day: "2026-10-27", profit: five.profitPence, unknown: 0 },
  ];
  assert.equal(periodPoas(days), "0.56×");
  assert.equal(days[0].profit, 800);
});

test("POAS display rounds halfway values consistently for daily and historical figures", () => {
  assert.equal(formatPoas(1134, 1200), "0.95×");
  assert.equal(formatPoas(-1134, 1200), "-0.95×");
  assert.equal(formatPoas(0, 1200), "0.00×");
  assert.equal(formatPoas(549, 0), "N/A: no marketing spend");
  assert.equal(periodPoas([{ day: "2026-10-27", profit: 1134, unknown: 0 }]), "0.95×");
});

test("invalid profit inputs remain unavailable, while a fully discounted order retains its costs", () => {
  for (const [paid, qty] of [[-1, 5], [1345.5, 5], [1345, 0], [1345, 5.5], [NaN, 5]]) {
    assert.equal(estimateOrderProfit(paid, qty), null);
  }
  assert.deepEqual(estimateOrderProfit(0, 5), {
    bottleCostPence: 250, deliveryCostPence: 506, stripeFeePence: 0,
    totalCostPence: 756, profitPence: -756,
  });
});
