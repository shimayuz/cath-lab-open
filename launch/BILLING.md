# Hosted simulator and Jev Pro

Decision (2026-09-20): the public root keeps the complete simulator. 3D, fluoroscopy, manual controls, local MediaPipe hand controls and measurement exports are free without an account. Only hosted Jev requires a paid USD 5/month Stripe subscription. `/about/` is a separate product page.

## Implemented

- Cloudflare Pages Functions `/api/*`, D1 accounts and server-side sessions; static simulator assets bypass the API.
- Passkeys with user verification, browser-bound single-use challenges, hashed HttpOnly sessions, recovery codes and generation-based revocation. Save the recovery code privately. Account recovery adds a new passkey and confirms the exact new code before invalidating the old recovery code.
- Server-owned account → Stripe customer mapping. Checkout is serialized in D1 with persistent idempotency/session reuse; duplicates are refused. The customer portal manages cancellation/payment details.
- Authoritative Stripe subscription/invoice checks: matching customer, configured USD 500 monthly price and test/live mode, active automatic collection, paid latest invoice, unexpired paid period. Trials/unpaid/past-due/paused subscriptions do not unlock Jev. Period-end cancellation retains paid access until expiry.
- Signed webhook validation and event deduplication. Events invalidate the brief entitlement cache; current Stripe state determines access. No client-supplied customer or paid flag can grant access.
- Atomic allowance: 50,000 requests per UTC calendar month, 4 requests/second/account, 900/minute globally and 1,000,000/month globally. No overage billing. Failed global reservations do not consume the user's allowance.
- Jev only receives movement summaries after explicit ON, never camera frames. Auth/payment/API errors keep ordinary hand controls working.

## Current activation status

The free hosted simulator is the primary site. Production keeps `BILLING_ENABLED=false`; sandbox credentials have been configured locally, while live payment configuration remains unavailable. Account creation and local/free operation remain available. The UI states the connection status; it must not claim that payment is active.

Sandbox verification (2026-09-20) used actual Stripe test-mode objects and the local hosted app: passkey registration/recovery confirmation, USD 5 hosted Checkout with a test card, duplicate prevention, paid Jev toggle and a successful Jev API response, portal-session creation, period-end cancellation retaining access, immediate cancellation revoking access through signed webhooks, repurchase, and free controls remaining available. Monthly renewal and unpaid states are tested separately with Stripe test clocks and the production entitlement function. These are sandbox results, not live sales or clinical/real-hand validation.

The first paid Jev request timed out; a later full flow returned HTTP 200. Separate synthetic provider checks took 303–647 ms, including an answer outside the 500 ms live freshness limit. Do not interpret payment success as guaranteed real-time Jev performance. The local return URL used a development certificate and was blocked in the in-app browser; payment and account state were verified separately. A public HTTPS return and live lifecycle remain to be verified before sales.

## Operator setup

Requires Node 22.22+, Git LFS, a Cloudflare account and Stripe access. Keep all secrets in provider secret storage, never `VITE_` variables, chat or source control.

1. Create a D1 database and set its ID in `wrangler.toml`; use your own `APP_ORIGIN` in both default and production vars. Set `BILLING_ENABLED=false` initially. Production must set `STRIPE_MODE=live`; isolated sandbox deployments must explicitly set `STRIPE_MODE=test`. Missing modes or a key/mode mismatch disable Checkout, paid Jev and webhook processing. Do not change modes on an existing customer database; keep sandbox data separate.
2. Apply `npx wrangler d1 migrations apply cath-lab-accounts --remote`.
3. Create a Stripe USD 5 monthly recurring price. This integration explicitly disables Managed Payments per Checkout session and uses ordinary Stripe Checkout, independent of the account default. Configure the Stripe customer portal. Create a signed webhook at `https://YOUR_ORIGIN/api/billing/webhook` for subscription and invoice lifecycle events, plus completed/expired Checkout events. Use separate test and live keys/prices/webhook secrets.
4. Add Pages secrets: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `TYPESAFE_API_KEY`, using `npx wrangler pages secret put NAME --project-name cath-lab` or the dashboard.
5. Test in a separate Stripe test-mode deployment: successful Checkout, return/sign-in, Jev ON, renewal, payment failure, cancellation, duplicate Checkout, account recovery and webhook replay. Never enter real payment cards in automated tests.
6. Confirm business/contact, cancellation/refund, tax and data-use terms before collecting live payments. The included VMR anatomy has separate research/development terms; commercial hosting clearance has not been established. See `NOTICE.md`.
7. Set `BILLING_ENABLED=true` only after the appropriate configuration and tests; build and deploy `dist`, **not** `site`:

```sh
npm ci
npm run build:hosted
npx wrangler pages deploy dist --project-name cath-lab --branch main
```

For the concrete production rollout status and required inputs, see [PRODUCTION.md](PRODUCTION.md).

Local hosted testing (billing-disabled by default):

```sh
npx wrangler d1 migrations apply cath-lab-accounts --local
npm run build:hosted
npm run dev:hosted
# another terminal
CATH_TEST_ORIGIN=http://localhost:4198 npx playwright test tests/e2e/hosted.spec.ts
```

Local ordinary development continues to use `npm run dev` and optional `.env.local` BYOK. Its loopback-only API must not be exposed as a hosted subscription gateway. Database migrations are append-only after deployment. Preserve D1 backups and recovery procedures; do not log tokens or recovery codes.

For a billing-enabled sandbox run, explicitly override the inherited production mode with `--binding STRIPE_MODE=test` and use a separate local D1 persistence directory. The sandbox key and CLI webhook secret never belong in production.
