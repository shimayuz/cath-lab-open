import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  hasPaidAccess,
  paidJevIntent,
  SubscriptionBilling,
} from "../server/subscription";
import type { PaidJevDependencies } from "../server/subscription";
const identity = { userId: "user1", customerId: "cus_owner" };
const config = {
  priceId: "price_Pro5",
  origin: "https://cath-lab.example",
  live: true,
};
const subscription = () =>
  ({
    customer: "cus_owner",
    status: "active",
    collection_method: "charge_automatically",
    latest_invoice: {
      status: "paid",
      amount_paid: 500,
      currency: "usd",
      livemode: true,
      customer: "cus_owner",
    },
    livemode: true,
    pause_collection: null,
    items: {
      data: [
        {
          price: {
            id: config.priceId,
            currency: "usd",
            unit_amount: 500,
            recurring: { interval: "month", interval_count: 1 },
          },
          current_period_end: Date.now() / 1000 + 3600,
          quantity: 1,
        },
      ],
    },
  }) as Stripe.Subscription;
describe("Jev Pro entitlement", () => {
  it("allows the owner's active $5 monthly subscription, including cancellation at period end", () => {
    const sub = subscription();
    sub.cancel_at_period_end = true;
    expect(hasPaidAccess(sub, identity, config)).toBe(true);
  });
  it.each([
    "past_due",
    "unpaid",
    "canceled",
    "incomplete",
    "trialing",
    "paused",
  ])("rejects %s", (status) => {
    const sub = subscription();
    sub.status = status as Stripe.Subscription.Status;
    expect(hasPaidAccess(sub, identity, config)).toBe(false);
  });
  it("rejects another customer, test mode, wrong price, annual plan, expiry and paused collection", () => {
    const variants = [
      subscription(),
      subscription(),
      subscription(),
      subscription(),
      subscription(),
      subscription(),
      subscription(),
    ];
    variants[0].customer = "cus_other";
    variants[1].livemode = false;
    variants[2].items.data[0].price.id = "price_other";
    variants[3].items.data[0].price.recurring!.interval = "year";
    variants[4].items.data[0].current_period_end = 1;
    variants[5].pause_collection = { behavior: "void", resumes_at: null };
    variants[6].items.data[0].price.unit_amount = 100;
    for (const sub of variants)
      expect(hasPaidAccess(sub, identity, config)).toBe(false);
  });
});
it("rejects active but unpaid/manual or unexpanded invoices", () => {
  const sub = subscription();
  sub.collection_method = "send_invoice";
  expect(hasPaidAccess(sub, identity, config)).toBe(false);
  sub.collection_method = "charge_automatically";
  (sub.latest_invoice as Stripe.Invoice).status = "open";
  expect(hasPaidAccess(sub, identity, config)).toBe(false);
  sub.latest_invoice = "in_unexpanded";
  expect(hasPaidAccess(sub, identity, config)).toBe(false);
});
function request(
  body = '{"paid":true,"customerId":"cus_owner"}',
  origin = config.origin,
) {
  return new Request(config.origin + "/api/jev/intent", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-cath-lab": "hand-intent-v1",
    },
    body,
  });
}
function dependencies(): PaidJevDependencies {
  return {
    origin: config.origin,
    authenticate: vi.fn(async () => identity),
    hasAccess: vi.fn(async () => false),
    reserveUsage: vi.fn(async () => true),
    evaluate: vi.fn(),
  };
}
describe("paid Jev request boundary", () => {
  it("does not call Jev when a client claims to be paid", async () => {
    const deps = dependencies();
    expect((await paidJevIntent(request(), deps)).status).toBe(402);
    expect(deps.evaluate).not.toHaveBeenCalled();
    expect(deps.reserveUsage).not.toHaveBeenCalled();
  });
  it("requires server authentication", async () => {
    const deps = dependencies();
    deps.authenticate = vi.fn(async () => null);
    expect((await paidJevIntent(request(), deps)).status).toBe(401);
    expect(deps.hasAccess).not.toHaveBeenCalled();
  });
  it("rejects foreign origin before account lookup", async () => {
    const deps = dependencies();
    expect(
      (await paidJevIntent(request("{}", "https://evil.example"), deps)).status,
    ).toBe(403);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });
  it("fails closed on billing outage", async () => {
    const deps = dependencies();
    deps.hasAccess = vi.fn(async () => {
      throw Error("provider secret");
    });
    const response = await paidJevIntent(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(deps.evaluate).not.toHaveBeenCalled();
  });
  it("bounds bodies and rejects malformed intent before upstream use", async () => {
    const deps = dependencies();
    deps.hasAccess = vi.fn(async () => true);
    expect((await paidJevIntent(request("x".repeat(4097)), deps)).status).toBe(
      413,
    );
    expect((await paidJevIntent(request(), deps)).status).toBe(400);
    expect(deps.evaluate).not.toHaveBeenCalled();
  });
});
describe("Stripe webhook signature", () => {
  it("verifies original signed bodies and rejects tampering", () => {
    const stripe = new Stripe("sk_test_fixture_only");
    const billing = new SubscriptionBilling(stripe, config);
    const raw = JSON.stringify({
      id: "evt_fixture",
      type: "customer.subscription.deleted",
    });
    const secret = "whsec_fixture_only";
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret,
    });
    expect(billing.webhook(raw, signature, secret).id).toBe("evt_fixture");
    expect(() => billing.webhook(raw + " ", signature, secret)).toThrow();
  });
});
it("reuses a checkout under a serialized durable-lease contract", async () => {
  const stripe = new Stripe("sk_test_fixture_only");
  const billing = new SubscriptionBilling(stripe, config);
  vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({
    data: [],
    has_more: false,
  } as unknown as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);
  vi.spyOn(stripe.prices, "retrieve").mockResolvedValue({
    active: true,
    livemode: true,
    currency: "usd",
    unit_amount: 500,
    recurring: { interval: "month", interval_count: 1 },
  } as Stripe.Response<Stripe.Price>);
  const session = {
    id: "cs_one",
    status: "open",
    customer: identity.customerId,
    client_reference_id: identity.userId,
  } as Stripe.Response<Stripe.Checkout.Session>;
  const create = vi
    .spyOn(stripe.checkout.sessions, "create")
    .mockResolvedValue(session);
  vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(session);
  let sessionId: string | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const coordinate: import("../server/subscription").CheckoutCoordinator = (
    _key,
    task,
  ) => {
    const current = tail.then(() =>
      task({
        idempotencyKey: "server-reserved-key",
        sessionId,
        save: async (id) => {
          sessionId = id;
        },
      }),
    );
    tail = current.catch(() => {});
    return current;
  };
  const results = await Promise.all([
    billing.checkout(identity, coordinate),
    billing.checkout(identity, coordinate),
  ]);
  expect(results.map((x) => x.id)).toEqual(["cs_one", "cs_one"]);
  expect(create).toHaveBeenCalledTimes(1);
});
it("evaluates valid paid intent only after usage reservation; denies exhausted quota", async () => {
  const deps = dependencies();
  deps.hasAccess = vi.fn(async () => true);
  const body = JSON.stringify({
    id: 1,
    instrument: "catheter",
    recent: [
      {
        push: { grip: "gripped", movement: "push", returning: false },
        rotation: { grip: "gripped", movement: "still" },
      },
    ],
  });
  deps.evaluate = vi.fn(async () => ({
    id: 1,
    model: "jev-1.13.0",
    elapsedMs: 25,
    push: { choice: "push" as const, confidence: 1, probability: 1 },
    rotation: { choice: "hold" as const, confidence: 1, probability: 1 },
  }));
  expect((await paidJevIntent(request(body), deps)).status).toBe(200);
  expect(deps.evaluate).toHaveBeenCalledTimes(1);
  deps.reserveUsage = vi.fn(async () => false);
  expect((await paidJevIntent(request(body), deps)).status).toBe(429);
  expect(deps.evaluate).toHaveBeenCalledTimes(1);
});
it.each([null, "cs_old"])(
  "does not sell another plan while an unpaid subscription exists (lease %s)",
  async (sessionId) => {
    const stripe = new Stripe("sk_test_fixture_only");
    const billing = new SubscriptionBilling(stripe, config);
    const sub = subscription();
    sub.status = "past_due";
    vi.spyOn(stripe.subscriptions, "list").mockResolvedValue({
      data: [sub],
      has_more: false,
    } as unknown as Stripe.Response<Stripe.ApiList<Stripe.Subscription>>);
    const create = vi.spyOn(stripe.checkout.sessions, "create");
    const retrieve = vi.spyOn(stripe.checkout.sessions, "retrieve");
    await expect(
      billing.checkout(identity, (_key, task) =>
        task({ idempotencyKey: "lease-key", sessionId, save: async () => {} }),
      ),
    ).rejects.toThrow("existing-subscription-use-portal");
    expect(create).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  },
);
