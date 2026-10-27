# Pricing (delivery updated 27 October 2026)

`lib/pricing.ts` is the source of truth for bottle prices, delivery charges and subscription discounts. It is imported by the shop, basket, checkout, product schema and Stripe checkout endpoints.

## One-off orders

- Plain: £1.99 per 250ml bottle.
- Black Forest Chocolate, Strawberry and Mango: £2.09 per 250ml bottle.
- Minimum order: 3 purchased bottles, with mixed flavours allowed.
- Every purchased bottle is charged; the 7-for-6 offer has been removed.
- Delivery: £3.50 for 3–5 bottles, £4.95 for 6–13 bottles, free for 14 or more.
- Existing Stripe promotion codes remain available at secure checkout. Delivery stays a separate line so yoghurt-only coupons do not discount delivery.
- The separate YOY25 gift remains; gift bottles do not qualify an order for the minimum quantity or free delivery.

The server validates quantities and calculates prices itself, ignoring totals or order lines sent by the browser. Amounts are calculated in pence to avoid rounding drift. Fulfilment/email metadata comes from these same quantities and totals. `SMALL_DELIVERY_MAX_BOTTLES` controls the small-order cutoff in both the calculation and the shop's delivery labels/FAQ.

## Profit and POAS delivery costs

`lib/order-profit.ts` holds actual fulfilment costs, separate from what the customer pays for delivery:

| Bottles shipped (including gifts) | Actual delivery cost |
| --- | --- |
| 3–5 | £5.06 |
| 6–8 | £7.59 |
| 9–14 | £7.77 |
| 15+ | £7.95 |

The estimate uses the actual Stripe amount paid, including delivery and any discounts, minus bottle cost (50p each), actual delivery cost and estimated Stripe fees (1.5% + 20p). For five plain bottles without a discount or gift, the customer pays £13.45, estimated costs are £7.96, and estimated profit before marketing is £5.49.

Purchased quantities determine the customer delivery charge; all shipped bottles determine fulfilment costs. For example, five purchased bottles plus a free gift still charge £3.50 delivery, but the six shipped bottles cost £7.59 to deliver.

Newly processed orders after deployment use cost model `pricing-2026-10-27-delivery-bands`. Stored historical profit totals and the £12/day marketing budget are unchanged. Daily, last-seven-day and overall POAS automatically include new profits as they are recorded. This update does not backfill historical orders or reset tracking. Existing Stripe Checkout sessions retain the customer charges they were created with; a new session uses the updated £3.50 charge.

Daily and historical POAS now share the same display rounding: an exact ratio of 0.945 displays as 0.95×. This does not change stored profit or marketing spend.

## New weekly subscriptions

The existing 5%, 10%, 15% and 20% subscription discounts are retained, applied to the full quantity at the new bottle prices. There are no additional free bottles. Discounts are rounded once per weekly box, to the nearest penny.

| Bottles | Discount | Plain yoghurt | Flavoured/mixed yoghurt | Delivery | Plain weekly total | Flavoured/mixed weekly total |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 5% | £7.56 | £7.94 | £3.50 | £11.06 | £11.44 |
| 7 | 10% | £12.54 | £13.17 | £4.95 | £17.49 | £18.12 |
| 14 | 15% | £23.68 | £24.87 | Free | £23.68 | £24.87 |
| 21 | 20% | £33.43 | £35.11 | Free | £33.43 | £35.11 |

The subscription endpoint retrieves the existing configured Stripe Price only to identify its Product, then creates checkout with an inline weekly price matching this table. Keep the existing `STRIPE_PRICE_SUB_PLN_*` and `STRIPE_PRICE_SUB_FLAV_*` environment variables; no replacement Price IDs are required.

**Existing Stripe subscriptions are not repriced.** They continue with their current Stripe Price until you separately choose to change them. Previously created Stripe checkout sessions also retain their original amounts.

## Validation

```sh
npm test
npx tsc --noEmit
npm run build
```

Pricing tests exercise delivery boundaries, mixed baskets, gift bottles, large orders, invalid quantities, all subscription tiers and mocked Stripe checkout requests. The mocked tests make no payments and make no requests to Stripe.

Preview `/shop` and `/checkout` locally with `npm run dev`. The plain Astro dev server does not serve the Vercel Stripe endpoints; a complete Stripe test checkout needs a Vercel preview or a correctly configured `vercel dev` environment with test credentials.

Examples of one-off plain baskets, including delivery:

| Bottles | Total |
| --- | --- |
| 3 | £9.47 |
| 5 | £13.45 |
| 6 | £16.89 |
| 7 | £18.88 |
| 10 | £24.85 |
| 13 | £30.82 |
| 14 | £27.86 |
| 15 | £29.85 |

As requested, the free-delivery threshold is based on the total number of purchased bottles, regardless of flavour.

Prices in external dashboards, Google Business Profile products, advertising creatives or email campaigns are not changed by deploying this code.
