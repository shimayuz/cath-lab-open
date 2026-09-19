# Jev Pro: billing implementation status

Decision (2026-09-20): public GitHub source; hosted Jev API restricted to USD 5/month subscribers; Stripe billing; Product Hunt copy credits development with GPT-6-Astra. The free local simulator remains usable without Jev.

## Implemented, not live

`server/subscription.ts` supplies server-only primitives:

- Check Stripe's authoritative active subscription, customer ownership, configured price ID, live/test mode, USD 500 cents, monthly interval unexpired period, automatic collection and a paid latest invoice.
- Reject incomplete, trialing, past-due, unpaid, canceled and paused subscriptions.
- Let cancellation at period end retain access until the paid period expires.
- Checkout uses only the server-configured price/customer, through a required serialized durable lease with session reuse and an idempotency key; portal supports subscription management.
- Verify webhook signatures with Stripe's SDK and the original request body.
- Paid Jev request boundary authenticates first, checks access, validates and bounds input, reserves usage, then calls Jev. Client paid/customer flags cannot grant access. Auth/billing failures deny access.

These helpers are **not mounted to a public API**. The product page has no purchase button. The local Vite gateway remains loopback-only. A static product page cannot enforce subscriptions by itself.

## Remaining before any charge

1. Configure a production account/login flow and durable server-owned user → Stripe customer mapping. The authenticate callback must verify the session; never accept a client customer ID. Provide account recovery and deletion paths.
2. Add same-origin, authenticated Checkout and portal routes, serialize checkout per account, and reuse open sessions to prevent duplicate subscriptions. Reserve a stable idempotency key server-side.
3. Persist webhook event IDs idempotently. Handle invoice payment failures and subscription lifecycle updates. Reconcile using Stripe's current subscription rather than applying events out of order. Bound request sizes and timeouts at the HTTP server.
4. Implement atomic per-account and global usage reservations and provider budget/rate limits. Choose and disclose the included allowance before selling. Do not promise unlimited usage. Current published Jev input price is $0.042/M tokens, output free; token volume and hosting/payment costs remain to be measured.
5. Configure server-only `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` and `TYPESAFE_API_KEY`. Do not put them in browser bundles, repository files, logs or chat. Stored Stripe CLI authorization was expired during setup.
6. Resolve research-only vascular data use for paid hosting or replace the anatomy with an independently created commercial-use model.
7. Publish merchant identity/contact, privacy, cancellation/refund and applicable tax disclosures using verified business details. No merchant identity or refund promise has been invented in the product page.
8. Test Stripe test-mode checkout, required authentication, successful renewal, failed payment, cancellation, forged webhook, replayed event, duplicate checkout and revoked access end-to-end before enabling live sales.

## Sources

- https://docs.stripe.com/api/subscriptions/list
- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/webhooks/signature
- https://docs.typesafe.ai/models

The primitives' unit tests are not evidence that checkout, auth, production billing or Jev Pro is operational.
