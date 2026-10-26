# Weekly subscriptions and shared dispatch dates

The shop, checkout, both Stripe endpoints, order confirmation and subscription
emails use the shared rules in `lib/dispatch.ts`. `src/config/dispatch.ts` re-exports
them for older component imports.

## Customer behaviour

All cutoff times are Europe/London, including British Summer Time:

| Checkout is opened | First dispatch / subsequent weekly subscription day |
| --- | --- |
| Saturday 9pm up to Tuesday 9pm | Thursday |
| Tuesday 9pm up to Saturday 9pm | Monday |

At exactly 9pm the next slot applies. These are dispatch days; arrival is normally
the next day. One-off orders and new subscriptions share the same first date.
The weekday is fixed for that subscription, not recalculated each week.

Blocked dispatch dates are skipped for both order types. If a holiday moves the
first dispatch to another weekday, that actual weekday becomes the subscription's
weekly day. The shop explains the delay. Maintain the blocked-date list annually.

Existing Stripe subscriptions are not migrated. Their prices, billing and weekday
continue as configured in Stripe. For later holidays, existing subscriptions still
need manual fulfilment arrangements / Stripe adjustments if appropriate. This
patch does not add automated holiday pauses, credits or schedule migrations.

## Checkout and billing

- The API derives dates itself. `expected_dispatch_iso` lets a current browser
  detect that the cutoff passed while opening checkout; the API returns 409 with
  the revised date so the customer reviews it before continuing.
- The page refreshes the date at the cutoff and on focus. Astro serializes the
  initial shop date so hydration still works when serving older static HTML.
- A Stripe Checkout session reserves its date when created. Its lifetime is about
  30 minutes (31 minutes to leave API latency margin above Stripe's 30-minute
  minimum), including a short grace period if the cutoff passes during checkout.
  Starting a new checkout after the cutoff always selects the next slot.
- Billing still uses the existing delayed-first-payment approach: a weekly Price
  and `subscription_data.trial_end`. No immediate first payment was added.
- The first bill is scheduled for 21:00 UTC on the dispatch date (9pm GMT / 10pm
  BST). In the final minute before a winter cutoff it may be scheduled up to a
  minute later to satisfy Stripe's minimum 48-hour lead time. Stripe controls the
  actual invoice/payment processing and retry time.
- Recurrence uses weekly Stripe billing. Its UTC evening time stays on the same
  London weekday across clock changes. Dispatch does not wait for evening payment;
  this preserves the previous fulfilment/payment arrangement.
- Both the Checkout Session and Subscription store `first_dispatch_iso` and
  `dispatch_weekday`. Emails and the verified confirmation use these saved values.
- Older subscription checkout events without new metadata infer the weekday from
  their actual trial end or billing anchor, instead of assuming Monday.
- The weekly strain calculation uses calendar days, shared with one-off metadata.
  Monday and Thursday in the same week retain the same strain rotation.

## Validation

`npm test` covers pricing, cutoff boundaries, summer/winter UK time, holidays,
weekly recurrence, server metadata, stale dates, verification, review pagination,
filtering, sorting and signed webhook emails. Stripe/Google/Redis/email services
are mocked. No live subscriptions are created and no real messages are sent.

`npm run build` and `npx tsc --noEmit` check the full project. A separate local
browser check covered desktop/mobile review controls, fallback/empty states,
review text escaping, expansion and the live UK cutoff with a US browser timezone.

For a real payment-flow check, use Stripe test mode with Vercel dev or a separate
preview environment configured with test keys and a test webhook endpoint. Plain
`npm run dev` previews Astro and the Google reviews integration; it does not serve
the Vercel `/api/stripe/*` functions. Do not treat a local layout preview as a live
Stripe or email delivery test.
