/** Server-only billing primitives. Not mounted until account/session storage is configured. */
import Stripe from "stripe";
import { isJevRequest } from "../src/hand/jev-contract.ts";
import type { JevRequest, JevResult } from "../src/hand/jev-contract.ts";

export const PRO_PRICE = {
  currency: "usd",
  amount: 500,
  interval: "month",
} as const;
export interface PaidIdentity {
  userId: string;
  customerId: string;
}
export interface BillingConfig {
  priceId: string;
  origin: string;
  live: boolean;
}
export interface CheckoutLease {
  idempotencyKey: string;
  sessionId: string | null;
  save: (sessionId: string) => Promise<void>;
}
// A production adapter must durably serialize by user+price, preserve the key on
// retries, and retain completed sessions until subscription reconciliation.
export type CheckoutCoordinator = <T>(
  key: string,
  task: (lease: CheckoutLease) => Promise<T>,
) => Promise<T>;
// The identity MUST come from a verified server session and a server-owned database
// mapping. Never construct it from a customerId, email, priceId or paid flag in JSON.
export function hasPaidAccess(
  subscription: Stripe.Subscription,
  identity: PaidIdentity,
  config: BillingConfig,
  now = Date.now() / 1000,
) {
  const customer =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const invoice = subscription.latest_invoice;
  return (
    customer === identity.customerId &&
    subscription.livemode === config.live &&
    subscription.status === "active" &&
    subscription.collection_method === "charge_automatically" &&
    !!invoice &&
    typeof invoice !== "string" &&
    invoice.status === "paid" &&
    invoice.amount_paid > 0 &&
    invoice.currency === "usd" &&
    invoice.livemode === config.live &&
    (typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id) === identity.customerId &&
    !subscription.pause_collection &&
    subscription.items.data.some(
      (item) =>
        item.price.id === config.priceId &&
        item.price.currency === PRO_PRICE.currency &&
        item.price.unit_amount === PRO_PRICE.amount &&
        item.price.recurring?.interval === PRO_PRICE.interval &&
        item.price.recurring.interval_count === 1 &&
        item.current_period_end > now &&
        (item.quantity ?? 0) > 0,
    )
  );
}
export class SubscriptionBilling {
  constructor(
    readonly stripe: Stripe,
    readonly config: BillingConfig,
  ) {
    if (!/^price_[A-Za-z0-9]+$/.test(config.priceId))
      throw new Error("price-not-configured");
    const origin = new URL(config.origin);
    if (origin.protocol !== "https:" || origin.origin !== config.origin)
      throw new Error("https-origin-required");
  }
  async active(identity: PaidIdentity) {
    // Stripe is the authority; do not trust Checkout's success redirect or a client flag.
    const list = await this.stripe.subscriptions.list({
      customer: identity.customerId,
      price: this.config.priceId,
      status: "active",
      limit: 100,
      expand: ["data.latest_invoice"],
    });
    return list.data.some((subscription) =>
      hasPaidAccess(subscription, identity, this.config),
    );
  }
  async checkout(identity: PaidIdentity, coordinate: CheckoutCoordinator) {
    return coordinate(
      `${identity.userId}:${this.config.priceId}`,
      async (lease) => {
        // Loss of Jev access does not mean the Stripe subscription ended.
        // Delinquent or incomplete subscriptions must be repaired, not duplicated.
        const existing = await this.stripe.subscriptions.list({
          customer: identity.customerId,
          price: this.config.priceId,
          status: "all",
          limit: 100,
        });
        if (
          existing.has_more ||
          existing.data.some(
            (s) => !["canceled", "incomplete_expired"].includes(s.status),
          )
        )
          throw new Error("existing-subscription-use-portal");
        if (lease.sessionId) {
          const session = await this.stripe.checkout.sessions.retrieve(
            lease.sessionId,
          );
          if (
            session.customer !== identity.customerId ||
            session.client_reference_id !== identity.userId
          )
            throw new Error("session-owner-mismatch");
          if (session.status === "open") return session;
          // Completed/expired sessions require server reconciliation and an explicit
          // lease reset. Never silently create another payable subscription.
          throw new Error("checkout-reconciliation-required");
        }
        const price = await this.stripe.prices.retrieve(this.config.priceId);
        if (
          !price.active ||
          price.livemode !== this.config.live ||
          price.currency !== "usd" ||
          price.unit_amount !== 500 ||
          price.recurring?.interval !== "month" ||
          price.recurring.interval_count !== 1
        )
          throw new Error("invalid-price");
        const session = await this.stripe.checkout.sessions.create(
          {
            mode: "subscription",
            customer: identity.customerId,
            client_reference_id: identity.userId,
            line_items: [{ price: this.config.priceId, quantity: 1 }],
            success_url: `${this.config.origin}/account?checkout=complete`,
            cancel_url: `${this.config.origin}/account?checkout=cancelled`,
            subscription_data: { metadata: { userId: identity.userId } },
          },
          { idempotencyKey: lease.idempotencyKey },
        );
        await lease.save(session.id);
        return session;
      },
    );
  }
  async portal(identity: PaidIdentity) {
    return this.stripe.billingPortal.sessions.create({
      customer: identity.customerId,
      return_url: `${this.config.origin}/account`,
    });
  }
  webhook(raw: string | Buffer, signature: string, secret: string) {
    // Caller must use the original body, bound its size, and durably deduplicate event.id.
    if (!secret) throw new Error("webhook-not-configured");
    return this.stripe.webhooks.constructEvent(raw, signature, secret);
  }
}
export interface PaidJevDependencies {
  origin: string;
  authenticate: (request: Request) => Promise<PaidIdentity | null>;
  hasAccess: (identity: PaidIdentity) => Promise<boolean>;
  // Atomically enforce per-account AND global rate/budget limits in durable storage.
  reserveUsage: (identity: PaidIdentity) => Promise<boolean>;
  evaluate: (request: JevRequest, signal: AbortSignal) => Promise<JevResult>;
}
export async function paidJevIntent(
  request: Request,
  deps: PaidJevDependencies,
): Promise<Response> {
  const send = (status: number, code: string) =>
    Response.json(
      { code },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  if (request.method !== "POST") return send(405, "method");
  // Strict same-origin even for authenticated cookies; no cross-site API charging.
  if (
    request.headers.get("origin") !== deps.origin ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json" ||
    request.headers.get("x-cath-lab") !== "hand-intent-v1"
  )
    return send(403, "forbidden");
  try {
    const identity = await deps.authenticate(request);
    if (!identity) return send(401, "sign-in-required");
    if (!(await deps.hasAccess(identity)))
      return send(402, "subscription-required");
    // Bound the streamed body before parsing. Content-Length alone is not trustworthy.
    const reader = request.body?.getReader();
    if (!reader) return send(400, "invalid-request");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return send(413, "too-large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const joined = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      joined.set(chunk, at);
      at += chunk.byteLength;
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(joined));
    } catch {
      return send(400, "invalid-request");
    }
    if (!isJevRequest(body)) return send(400, "invalid-request");
    if (!(await deps.reserveUsage(identity))) return send(429, "rate-limited");
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(1200)]);
    const result = await deps.evaluate(body, signal);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Billing/auth outages fail closed and never expose provider errors or secrets.
    return send(503, "unavailable");
  }
}
