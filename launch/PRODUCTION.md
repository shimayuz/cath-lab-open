# Cath Lab production rollout

Updated 2026-09-20. This is an operator record, not a published contract or a statement that sales have launched.

## Confirmed by the owner

- Merchant and intended live Stripe account: **quai, Inc**.
- Support contact: **request@quai-inc.com**.
- Existing public origin: https://cath-lab.pages.dev ; a custom domain remains undecided.
- The simulator stays free without login. Only optional hosted Jev is USD 5/month.
- The owner has not obtained additional VMR permission. The fee being for Jev does not establish that the combined service is covered by the VMR license. Ask about this precise arrangement; do not assume all commercial R&D is prohibited either.

## Verified infrastructure

- Cloudflare Pages root and /about/ are deployed with HTTPS; D1 exists in APAC and has no pending migrations.
- Production currently contains only the TypeSafe server secret. Stripe production secrets are absent.
- The Stripe connector exposes only the approved sandbox. A live server key/account connection is still needed.
- Production requires STRIPE_MODE=live and a matching server key. BILLING_ENABLED remains false during preparation.
- Sandbox Checkout/payment, monthly renewal, unpaid renewal, duplicate prevention, cancellation and Jev access were verified. The real public HTTPS return has not been verified yet.

## Next configuration steps

1. Receive the confirmed live account's server key privately in the ignored `.env.stripe-live.local`, or through provider secret storage. Prefer a restricted key with the permissions the runtime needs. Never place it in `VITE_` variables or source control. Read account identity and activation status before creating resources; do not reuse sandbox account identifiers.
2. Find or create the live Cath Lab Jev Pro product and a **USD 500 cents / month** price. Verify currency, unit amount, interval, active status and livemode. The app uses ordinary Checkout (`managed_payments.enabled=false`). Record the live price separately from the sandbox price.
3. Configure the customer portal for payment details/invoices and cancellation at the end of the paid period. Confirm the existing default configuration before changing it; other products may share the same Stripe account. Use a dedicated configuration if a shared default would be affected.
4. Create a live signed webhook at `https://cath-lab.pages.dev/api/billing/webhook`. Required lifecycle coverage: `customer.subscription.created`, `.updated`, `.deleted`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`, `checkout.session.expired`. Match the installed Stripe SDK API version. Store the endpoint's signing secret, not the temporary Stripe CLI secret.
5. Store STRIPE_SECRET_KEY, STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET as encrypted production Pages secrets. Verify presence without printing values. Keep BILLING_ENABLED=false and rebuild/redeploy the hosted app.
6. Complete model permission and customer-facing merchant/privacy/subscription terms. Facts that still need owner input include merchant address/jurisdiction, applicable seller disclosures, refund policy and data retention/deletion contact process. Do not fill them with invented details or publish an unfinished legal template.
7. Verify Checkout return/sign-in on a trusted HTTPS sandbox deployment with its own D1 and test Stripe keys, along with webhook delivery. If keeping pages.dev for launch, passkeys are bound to that origin; a later custom domain needs an account/passkey migration plan.
8. Before enabling checkout, review the concrete live price, merchant display, portal, public terms and readiness results with the owner. Do not initiate a real charge as an automated test. Enable billing only for the finalized release.

## Operational checks and recovery

- Validate free guest operations, disabled unpaid Jev, correct subscription access and signed webhook delivery after deployment.
- Watch provider error/latency, declined payments and quota use without recording secrets, recovery codes, video or raw personal data.
- If billing/Jev is unavailable, set BILLING_ENABLED=false and redeploy to disable new Checkout and hosted Jev; free operations remain available. Keep verified webhooks operational. This switch does not cancel or refund existing subscriptions; communicate and manage those separately in Stripe.
- Before changing database schema, confirm Cloudflare D1 recovery/backup capability and follow append-only migrations. Do not restore the account database casually: old sessions or entitlements could reappear.
- Current Jev latency is variable. A successful subscription or HTTP 200 does not prove real-time assist improvement; keep the existing stale-result fallback.

## Sources

- [Stripe go-live checklist](https://docs.stripe.com/get-started/checklist/go-live)
- [Stripe API keys](https://docs.stripe.com/keys)
- [VMR official license FAQ](https://vascularmodel.org/FAQs.html)
