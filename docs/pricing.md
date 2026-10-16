# Pricing from 16 October 2026

`lib/pricing.ts` is the source of truth for bottle prices, delivery charges and subscription discounts. It is imported by the shop, basket, checkout, product schema and Stripe checkout endpoints.

## One-off orders

- Plain: £1.99 per 250ml bottle.
- Black Forest Chocolate, Strawberry and Mango: £2.09 per 250ml bottle.
- Minimum order: 3 purchased bottles, with mixed flavours allowed.
- Every purchased bottle is charged; the 7-for-6 offer has been removed.
- Delivery: £3.50 for 3–4 bottles, £4.95 for 5–13 bottles, free for 14 or more.
- Existing Stripe promotion codes remain available at secure checkout. Delivery stays a separate line so yoghurt-only coupons do not discount delivery.
- The separate YOY25 gift remains; gift bottles do not qualify an order for the minimum quantity or free delivery.

The server validates quantities and calculates prices itself, ignoring totals or order lines sent by the browser. Amounts are calculated in pence to avoid rounding drift. Fulfilment/email metadata comes from these same quantities and totals. The existing profit/POAS calculations still use the actual Stripe payment and the existing cost model.

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
npm run test:pricing
npx tsc --noEmit
npm run build
```

Pricing tests exercise delivery boundaries, mixed baskets, gift bottles, large orders, invalid quantities, all subscription tiers and mocked Stripe checkout requests. The mocked tests make no payments and make no requests to Stripe.

Preview `/shop` and `/checkout` locally with `npm run dev`. The plain Astro dev server does not serve the Vercel Stripe endpoints; a complete Stripe test checkout needs a Vercel preview or a correctly configured `vercel dev` environment with test credentials.

Examples of one-off plain baskets, including delivery:

| Bottles | Total |
| --- | --- |
| 3 | £9.47 |
| 7 | £18.88 |
| 10 | £24.85 |
| 13 | £30.82 |
| 14 | £27.86 |
| 15 | £29.85 |

As requested, the free-delivery threshold is based on the total number of purchased bottles, regardless of flavour.

Prices in external dashboards, Google Business Profile products, advertising creatives or email campaigns are not changed by deploying this code.
