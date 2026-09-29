// Costs from YoY Finances.xlsx, Pricing tab.
// Money is calculated in pence: 1200 = £12.

import { marketingSpend } from "./poas-history.js";
export const COST_MODEL = "pricing-2026-09-28-15plus";

export function estimateOrderProfit(
  paidPence: number,
  bottles: number
) {
  // Accept any positive whole bottle count.
  if (
    !Number.isSafeInteger(paidPence) ||
    paidPence < 0 ||
    !Number.isSafeInteger(bottles) ||
    bottles < 1
  ) {
    return null;
  }

  const bottleCostPence = bottles * 50;
  const deliveryCostPence = bottles <= 4 ? 523 : bottles <= 14 ? 815 : 850;

  // Estimated Stripe fee from your spreadsheet.
  const stripeFeePence =
    paidPence === 0
      ? 0
      : Math.round(paidPence * 0.015 + 20);

  const totalCostPence =
    bottleCostPence +
    deliveryCostPence +
    stripeFeePence;

  return {
    bottleCostPence,
    deliveryCostPence,
    stripeFeePence,
    totalCostPence,
    profitPence: paidPence - totalCostPence,
  };
}

// Groups orders by UK calendar day, including daylight saving.
export function londonDay(unixSeconds: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(unixSeconds * 1000));

  const part = (type: string) =>
    parts.find((p) => p.type === type)!.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
}

// Redis runs this as one operation.
// Repeated notifications for the same session on the same day
// cannot increase the totals twice.
export const RECORD_PROFIT_LUA = `
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  redis.call('HINCRBY', KEYS[1], 'orders', 1)
  redis.call('HINCRBY', KEYS[1], 'profit', ARGV[3])
  redis.call('HINCRBY', KEYS[1], 'unknown', ARGV[4])
end

return {
  redis.call('HGET', KEYS[1], 'orders'),
  redis.call('HGET', KEYS[1], 'profit'),
  redis.call('HGET', KEYS[1], 'unknown')
}
`;

const gbp = (pence: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);

// Builds the extra section for the owner's email.
export function profitEmailHtml(
  estimate: ReturnType<typeof estimateOrderProfit>,
  day: string,
  totals: number[]
) {
  const [orders, profit, unknown] = totals;
  const spend = marketingSpend(day);
  const complete = unknown === 0;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0">${label}</td>
      <td style="padding:6px 0">
        <strong>${value}</strong>
      </td>
    </tr>
  `;

  return `
    <h4>Estimated one-off profit</h4>

    <table role="presentation" style="width:100%">
      <tbody>
        ${
          estimate
            ? row("Bottle cost", gbp(estimate.bottleCostPence)) +
              row("Delivery cost", gbp(estimate.deliveryCostPence)) +
              row(
                "Stripe fee",
                gbp(estimate.stripeFeePence)
              ) +
              row(
                "Total cost",
                gbp(estimate.totalCostPence)
              ) +
              row(
                "Profit",
                gbp(estimate.profitPence)
              )
            : row(
                "This order",
                "Cost estimate unavailable: check bottle quantity."
              )
        }

        ${row(
          `One-off orders today`,
          String(orders)
        )}

        ${row(
          complete
            ? "Today's running profit"
            : "Known profit subtotal (incomplete)",
          gbp(profit)
        )}

        ${row(
          "Daily ad spend",
          gbp(spend)
        )}

        ${row(
          "Today’s running POAS",
          complete
            ? (spend === 0 ? "N/A: no marketing spend" : `${(profit / spend).toFixed(2)}×`)
            : "Unavailable: missing cost estimates"
        )}

        ${row(
          "Today’s profit after daily ad spend",
          complete
            ? gbp(profit - spend)
            : "Unavailable"
        )}
      </tbody>
    </table>

    <p style="font-size:12px;color:#555">
      ${
        unknown
          ? `${unknown} order(s) need a cost estimate. `
          : ""
      }
      Estimated using £0.50 per bottle and Stripe fees of 1.5% + 20p.
    </p>
  `;
}
