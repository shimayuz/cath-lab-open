import Stripe from "stripe";
import type { D1Database } from "@cloudflare/workers-types";
import { SubscriptionBilling, paidJevIntent } from "./subscription.ts";
import type { CheckoutCoordinator, PaidIdentity } from "./subscription.ts";
import {
  account,
  authRoute,
  json,
  randomToken,
  readJson,
  reserve,
} from "./hosted-auth.ts";
import type { Account } from "./hosted-auth.ts";
import { evaluateIntent, jevClient, JEV_MODEL } from "./jev.ts";
export interface HostedEnv {
  DB: D1Database;
  APP_ORIGIN: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  TYPESAFE_API_KEY?: string;
  BILLING_ENABLED?: string;
  JEV_MONTHLY_LIMIT?: string;
}
const now = () => Math.floor(Date.now() / 1000);
const month = () => new Date().toISOString().slice(0, 7);
export function billingReady(env: HostedEnv) {
  return (
    env.BILLING_ENABLED === "true" &&
    !!env.STRIPE_SECRET_KEY &&
    !!env.STRIPE_PRICE_ID &&
    !!env.STRIPE_WEBHOOK_SECRET &&
    !!env.TYPESAFE_API_KEY
  );
}
function stripeClient(env: HostedEnv) {
  if (!env.STRIPE_SECRET_KEY) throw Error("billing-not-configured");
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 5000,
    maxNetworkRetries: 1,
  });
}
function billing(env: HostedEnv) {
  return new SubscriptionBilling(stripeClient(env), {
    priceId: env.STRIPE_PRICE_ID ?? "",
    origin: env.APP_ORIGIN,
    live: /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? ""),
  });
}
function identity(user: Account): PaidIdentity {
  if (!user.customer_id) throw Error("no-customer");
  return { userId: user.id, customerId: user.customer_id };
}
async function entitled(user: Account, env: HostedEnv, force = false) {
  if (!billingReady(env) || !user.customer_id) return false;
  const cached = await env.DB.prepare(
    "SELECT active,checked_at FROM entitlements WHERE user_id=?",
  )
    .bind(user.id)
    .first<{ active: number; checked_at: number }>();
  if (!force && cached && cached.checked_at > now() - 15)
    return !!cached.active;
  const active = await billing(env).active(identity(user));
  await env.DB.prepare(
    "INSERT INTO entitlements(user_id,active,checked_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET active=excluded.active,checked_at=excluded.checked_at",
  )
    .bind(user.id, active ? 1 : 0, now())
    .run();
  return active;
}
export function coordinator(env: HostedEnv): CheckoutCoordinator {
  return async (key, task) => {
    const userId = key.split(":")[0],
      token = randomToken(),
      timestamp = now();
    const lease = await env.DB.prepare(
      "INSERT INTO checkout_leases(user_id,lock_token,lock_until,idempotency_key) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET lock_token=excluded.lock_token,lock_until=excluded.lock_until WHERE lock_until<? RETURNING idempotency_key,session_id",
    )
      .bind(userId, token, timestamp + 90, crypto.randomUUID(), timestamp)
      .first<{ idempotency_key: string; session_id: string | null }>();
    if (!lease) throw Error("checkout-busy");
    try {
      if (lease.session_id) {
        const stripe = stripeClient(env);
        const previous = await stripe.checkout.sessions.retrieve(
          lease.session_id,
        );
        const owner = await env.DB.prepare(
          "SELECT customer_id FROM users WHERE id=?",
        )
          .bind(userId)
          .first<{ customer_id: string }>();
        if (
          previous.customer !== owner?.customer_id ||
          previous.client_reference_id !== userId
        )
          throw Error("session-owner-mismatch");
        let reusable = previous.status === "expired";
        if (previous.status === "complete" && previous.subscription) {
          const id =
            typeof previous.subscription === "string"
              ? previous.subscription
              : previous.subscription.id;
          const sub = await stripe.subscriptions.retrieve(id);
          reusable = ["canceled", "incomplete_expired"].includes(sub.status);
        }
        if (reusable) {
          lease.session_id = null;
          lease.idempotency_key = crypto.randomUUID();
          await env.DB.prepare(
            "UPDATE checkout_leases SET session_id=NULL,idempotency_key=? WHERE user_id=? AND lock_token=?",
          )
            .bind(lease.idempotency_key, userId, token)
            .run();
        }
      }
      return await task({
        idempotencyKey: lease.idempotency_key,
        sessionId: lease.session_id,
        save: async (sessionId) => {
          const saved = await env.DB.prepare(
            "UPDATE checkout_leases SET session_id=? WHERE user_id=? AND lock_token=? AND lock_until>? RETURNING user_id",
          )
            .bind(sessionId, userId, token, now())
            .first();
          if (!saved) throw Error("checkout-busy");
        },
      });
    } finally {
      await env.DB.prepare(
        "UPDATE checkout_leases SET lock_until=0 WHERE user_id=? AND lock_token=?",
      )
        .bind(userId, token)
        .run();
    }
  };
}
async function customer(user: Account, env: HostedEnv) {
  if (user.customer_id) return user;
  const created = await stripeClient(env).customers.create(
    { metadata: { cathLabUserId: user.id } },
    { idempotencyKey: "customer-" + user.id },
  );
  await env.DB.prepare(
    "UPDATE users SET customer_id=? WHERE id=? AND customer_id IS NULL",
  )
    .bind(created.id, user.id)
    .run();
  const stored = await env.DB.prepare(
    "SELECT id,customer_id,recovery_confirmed,auth_epoch FROM users WHERE id=?",
  )
    .bind(user.id)
    .first<Account>();
  if (!stored) throw Error("no-account");
  return stored;
}
export async function reserveJevUsage(env: HostedEnv, userId: string) {
  const t = now(),
    limit = Math.min(
      50000,
      Math.max(1, Number(env.JEV_MONTHLY_LIMIT) || 50000),
    );
  const keys = [
    `rate:${userId}:${t}`,
    `global-rate:${Math.floor(t / 60)}`,
    `jev:${userId}:${month()}`,
    `global-budget:${month()}`,
  ];
  const reserved = await env.DB.prepare(
    `INSERT INTO jev_reservations(id,user_second,global_minute,user_month,global_month,expires_at)
 SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT count FROM quotas WHERE key=?),0)<4
 AND COALESCE((SELECT count FROM quotas WHERE key=?),0)<900
 AND COALESCE((SELECT count FROM quotas WHERE key=?),0)<?
 AND COALESCE((SELECT count FROM quotas WHERE key=?),0)<1000000 RETURNING id`,
  )
    .bind(
      crypto.randomUUID(),
      ...keys,
      t + 32 * 86400,
      keys[0],
      keys[1],
      keys[2],
      limit,
      keys[3],
    )
    .first();
  return !!reserved;
}
async function webhook(request: Request, env: HostedEnv) {
  if (request.method !== "POST") return json({ code: "method" }, 405);
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ code: "unavailable" }, 503);
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ code: "invalid-signature" }, 400);
  // Bound before parsing without changing the original signed bytes.
  const reader = request.body?.getReader();
  if (!reader) return json({ code: "invalid-request" }, 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        return json({ code: "too-large" }, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let event: Stripe.Event;
  try {
    event = await stripeClient(env).webhooks.constructEventAsync(
      new TextDecoder().decode(bytes),
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json({ code: "invalid-signature" }, 400);
  }
  if (event.livemode !== /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? ""))
    return json({ code: "wrong-mode" }, 400);
  const object = event.data.object as unknown as {
    customer?: string | { id: string };
  };
  const customerId =
    typeof object.customer === "string" ? object.customer : object.customer?.id;
  const statements = [
    env.DB.prepare(
      "INSERT OR IGNORE INTO billing_events(id,type,received_at) VALUES(?,?,?)",
    ).bind(event.id, event.type, now()),
  ];
  // Invalidate and re-fetch current Stripe state. Older/replayed events cannot restore access.
  if (customerId)
    statements.push(
      env.DB.prepare(
        "DELETE FROM entitlements WHERE user_id IN (SELECT id FROM users WHERE customer_id=?)",
      ).bind(customerId),
    );
  await env.DB.batch(statements);
  return json({ received: true });
}
export async function handleHostedApi(
  request: Request,
  env: HostedEnv,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (path === "/api/billing/webhook") return await webhook(request, env);
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return json({ code: "forbidden" }, 403);
    if (
      request.method === "POST" &&
      (request.headers.get("origin") !== env.APP_ORIGIN ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json" ||
        request.headers.get("x-cath-lab") !== "hand-intent-v1")
    )
      return json({ code: "forbidden" }, 403);
    if (path.startsWith("/api/auth/")) {
      if (request.method !== "POST") return json({ code: "method" }, 405);
      return await authRoute(request, env, path.slice("/api/auth/".length));
    }
    const user = await account(request, env);
    if (path === "/api/jev/status" && request.method === "GET") {
      if (user)
        await env.DB.prepare("DELETE FROM quotas WHERE expires_at<?")
          .bind(now())
          .run();
      let subscribed = false,
        unavailable = false;
      if (user) {
        try {
          subscribed = await entitled(user, env);
        } catch {
          unavailable = true;
        }
      }
      const usage = user
        ? await env.DB.prepare("SELECT count FROM quotas WHERE key=?")
            .bind(`jev:${user.id}:${month()}`)
            .first<{ count: number }>()
        : null;
      return json({
        mode: "hosted",
        configured: subscribed && !unavailable,
        model: JEV_MODEL,
        signedIn: !!user,
        subscribed,
        billingReady: billingReady(env),
        billingUnavailable: unavailable,
        recoveryConfirmed: !!user?.recovery_confirmed,
        hasCustomer: !!user?.customer_id,
        usage: usage?.count ?? 0,
        limit: Math.min(
          50000,
          Math.max(1, Number(env.JEV_MONTHLY_LIMIT) || 50000),
        ),
      });
    }
    if (path === "/api/jev/intent") {
      return await paidJevIntent(request, {
        origin: env.APP_ORIGIN,
        authenticate: async () => (user?.customer_id ? identity(user) : null),
        hasAccess: async () => !!user && (await entitled(user, env)),
        reserveUsage: (id) => reserveJevUsage(env, id.userId),
        evaluate: (value, signal) =>
          evaluateIntent(jevClient(env.TYPESAFE_API_KEY ?? ""), value, signal),
      });
    }
    if (!user) return json({ code: "sign-in-required" }, 401);
    if (request.method !== "POST") return json({ code: "method" }, 405);
    if (
      !(await reserve(
        env.DB,
        `billing:${user.id}:${Math.floor(now() / 60)}`,
        10,
        now() + 120,
      ))
    )
      return json({ code: "rate-limited" }, 429);
    await readJson(request, 1024);
    if (path === "/api/billing/refresh") {
      const subscribed = await entitled(user, env, true);
      return json({ subscribed });
    }
    if (path === "/api/billing/checkout") {
      if (!billingReady(env))
        return json({ code: "billing-not-configured" }, 503);
      if (!user.recovery_confirmed)
        return json({ code: "save-recovery-code" }, 409);
      const owned = await customer(user, env);
      const service = billing(env);
      const session = await service.checkout(identity(owned), coordinator(env));
      return json({ url: session.url });
    }
    if (path === "/api/billing/portal") {
      if (!env.STRIPE_SECRET_KEY || !user.customer_id)
        return json({ code: "no-subscription" }, 409);
      return json({ url: (await billing(env).portal(identity(user))).url });
    }
    return json({ code: "not-found" }, 404);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const safe = [
      "checkout-busy",
      "checkout-reconciliation-required",
      "existing-subscription-use-portal",
      "too-large",
      "invalid-input",
      "invalid-passkey",
      "challenge-expired",
    ];
    return json(
      { code: safe.includes(code) ? code : "unavailable" },
      safe.includes(code) ? 409 : 503,
    );
  }
}
