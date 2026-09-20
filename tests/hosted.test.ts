import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "./support/d1";
import {
  account,
  digest,
  issueSession,
  randomToken,
} from "../server/hosted-auth";
import {
  handleHostedApi,
  reserveJevUsage,
  coordinator,
  billingReady,
} from "../server/hosted";
import type { HostedEnv } from "../server/hosted";
import Stripe from "stripe";
let store: ReturnType<typeof testDatabase>, env: HostedEnv;
const origin = "https://cath-lab.pages.dev";
beforeEach(() => {
  store = testDatabase();
  env = { DB: store.db, APP_ORIGIN: origin };
});
afterEach(() => {
  store.sqlite.close();
  vi.restoreAllMocks();
});
function req(
  path: string,
  data: unknown = {},
  cookie = "",
  requestOrigin = origin,
) {
  return new Request(origin + "/api/" + path, {
    method: "POST",
    headers: {
      origin: requestOrigin,
      "content-type": "application/json",
      "x-cath-lab": "hand-intent-v1",
      cookie,
    },
    body: JSON.stringify(data),
  });
}
async function user() {
  const recovery = randomToken();
  await env.DB.prepare(
    "INSERT INTO users(id,recovery_hash,created_at) VALUES(?,?,?)",
  )
    .bind("user1", await digest(recovery), Date.now() / 1000)
    .run();
  return { recovery, cookie: await issueSession(env, "user1", 0) };
}
describe("hosted access boundary", () => {
  it("serves guest status without enabling Jev or requiring a paid plan for the simulator", async () => {
    const response = await handleHostedApi(
      new Request(origin + "/api/jev/status"),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "hosted",
      configured: false,
      signedIn: false,
      billingReady: false,
    });
  });
  it("rejects unpaid/anonymous intents and forged claims", async () => {
    const { cookie } = await user();
    for (const c of ["", cookie])
      expect(
        (
          await handleHostedApi(
            req("jev/intent", { paid: true, customerId: "cus_other" }, c),
            env,
          )
        ).status,
      ).toBe(401);
  });
  it("denies cross-origin mutation before auth or billing", async () => {
    expect(
      (
        await handleHostedApi(
          req("auth/register/options", {}, "", "https://evil.example"),
          env,
        )
      ).status,
    ).toBe(403);
  });
  it("requires live configuration and a saved recovery code before checkout", async () => {
    const { cookie } = await user();
    expect(
      (await handleHostedApi(req("billing/checkout", {}, cookie), env)).status,
    ).toBe(503);
    expect(
      store.sqlite.prepare("SELECT customer_id FROM users").get(),
    ).toMatchObject({ customer_id: null });
  });
  it("revokes logout sessions server-side", async () => {
    const { cookie } = await user();
    expect(await account(req("noop", {}, cookie), env)).not.toBeNull();
    expect(
      (await handleHostedApi(req("auth/logout", {}, cookie), env)).status,
    ).toBe(200);
    expect(await account(req("noop", {}, cookie), env)).toBeNull();
  });
  it("binds single-use passkey challenges to an HttpOnly browser cookie", async () => {
    const result = await handleHostedApi(req("auth/login/options"), env);
    expect(result.status).toBe(200);
    const cookie = result.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    const challenge = ((await result.json()) as { challenge: string })
      .challenge;
    expect(challenge.length).toBeGreaterThan(20);
    const failed = await handleHostedApi(
      req("auth/login/verify", { id: "fake" }, cookie),
      env,
    );
    expect(failed.status).toBe(400);
    const replay = await handleHostedApi(
      req("auth/login/verify", { id: "fake" }, cookie),
      env,
    );
    expect(await replay.json()).toEqual({ code: "challenge-expired" });
  });
});
describe("recovery and auth epoch", () => {
  it("lets the old recovery code recover again after a lost response until a new passkey and code are confirmed", async () => {
    const { recovery, cookie } = await user();
    const first = await handleHostedApi(req("auth/recover", { recovery }), env);
    expect(first.status).toBe(200);
    expect(await account(req("noop", {}, cookie), env)).toBeNull();
    const second = await handleHostedApi(
      req("auth/recover", { recovery }),
      env,
    );
    expect(second.status).toBe(200);
    const newCookie = second.headers.get("set-cookie")!,
      next = (await second.json()) as { recovery: string };
    expect(
      (
        await handleHostedApi(
          req("auth/confirm-recovery", { recovery: next.recovery }, newCookie),
          env,
        )
      ).status,
    ).toBe(409);
    await env.DB.prepare(
      "INSERT INTO credentials(id,user_id,auth_epoch,public_key,counter,transports) VALUES(?,?,?,?,?,?)",
    )
      .bind("new-passkey", "user1", 2, "public", 0, "[]")
      .run();
    expect(
      (
        await handleHostedApi(
          req("auth/confirm-recovery", { recovery: next.recovery }, newCookie),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (await handleHostedApi(req("auth/recover", { recovery }), env)).status,
    ).toBe(400);
    expect(
      (
        await handleHostedApi(
          req("auth/recover", { recovery: next.recovery }),
          env,
        )
      ).status,
    ).toBe(200);
  });
  it("confirms only the exact recovery code saved despite another tab issuing a replacement", async () => {
    const { cookie, recovery } = await user();
    await env.DB.prepare(
      "INSERT INTO credentials(id,user_id,auth_epoch,public_key,counter,transports) VALUES('passkey','user1',0,'public',0,'[]')",
    ).run();
    const a = (await (
      await handleHostedApi(req("auth/new-recovery", {}, cookie), env)
    ).json()) as { recovery: string };
    const b = (await (
      await handleHostedApi(req("auth/new-recovery", {}, cookie), env)
    ).json()) as { recovery: string };
    expect(
      (
        await handleHostedApi(
          req("auth/confirm-recovery", { recovery: a.recovery }, cookie),
          env,
        )
      ).status,
    ).toBe(409);
    expect(
      (await handleHostedApi(req("auth/confirm-recovery", {}, cookie), env))
        .status,
    ).toBe(400);
    expect(
      store.sqlite.prepare("SELECT recovery_hash FROM users").get(),
    ).toMatchObject({ recovery_hash: await digest(recovery) });
    expect(
      (
        await handleHostedApi(
          req("auth/confirm-recovery", { recovery: b.recovery }, cookie),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      store.sqlite.prepare("SELECT recovery_hash FROM users").get(),
    ).toMatchObject({ recovery_hash: await digest(b.recovery) });
  });
  it("cannot issue a session from a credential checked before recovery", async () => {
    const { recovery } = await user();
    await handleHostedApi(req("auth/recover", { recovery }), env);
    await expect(issueSession(env, "user1", 0)).rejects.toThrow(
      "reauthenticate",
    );
    expect(
      store.sqlite
        .prepare("SELECT count(*) as count FROM sessions WHERE auth_epoch=0")
        .get(),
    ).toMatchObject({ count: 0 });
  });
  it("cannot attach a credential after recovery using a stale registration epoch", async () => {
    const { recovery } = await user();
    await handleHostedApi(req("auth/recover", { recovery }), env);
    const result = await env.DB.prepare(
      "INSERT INTO credentials(id,user_id,public_key,counter,transports,auth_epoch) SELECT ?,id,?,?,?,auth_epoch FROM users WHERE id=? AND auth_epoch=?",
    )
      .bind("stale", "public", 0, "[]", "user1", 0)
      .run();
    expect(result.meta.changes).toBe(0);
  });
});
describe("atomic quotas", () => {
  it("reserves four requests per second without consuming monthly quota for a denied fifth", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1800000000000);
    for (let i = 0; i < 4; i++)
      expect(await reserveJevUsage(env, "user1")).toBe(true);
    expect(await reserveJevUsage(env, "user1")).toBe(false);
    expect(
      store.sqlite
        .prepare("SELECT count FROM quotas WHERE key LIKE 'jev:user1:%'")
        .get(),
    ).toMatchObject({ count: 4 });
    expect(
      store.sqlite
        .prepare("SELECT count(*) as count FROM jev_reservations")
        .get(),
    ).toMatchObject({ count: 0 });
  });
  it("does not consume user quota if global budget is exhausted", async () => {
    const month = new Date().toISOString().slice(0, 7);
    await env.DB.prepare("INSERT INTO quotas VALUES(?,?,?)")
      .bind("global-budget:" + month, 1000000, Date.now() / 1000 + 86400)
      .run();
    expect(await reserveJevUsage(env, "user1")).toBe(false);
    expect(
      store.sqlite
        .prepare(
          "SELECT count(*) as count FROM quotas WHERE key LIKE 'jev:user1:%'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
  });
});
it("allows a new checkout lease after a completely canceled subscription", async () => {
  await user();
  env.STRIPE_SECRET_KEY = "sk_test_fixture_only";
  env.STRIPE_MODE = "test";
  await env.DB.prepare("UPDATE users SET customer_id=? WHERE id=?")
    .bind("cus_owner", "user1")
    .run();
  await env.DB.prepare("INSERT INTO checkout_leases VALUES(?,?,?,?,?)")
    .bind("user1", "old", 0, "old-key", "cs_old")
    .run();
  // The SDK's HTTP transport is replaced only in this unit test, never in production.
  vi.spyOn(Stripe, "createFetchHttpClient").mockReturnValue(
    Stripe.createFetchHttpClient(async (input) => {
      const url = String(input);
      return Response.json(
        url.includes("/checkout/sessions/")
          ? {
              id: "cs_old",
              status: "complete",
              customer: "cus_owner",
              client_reference_id: "user1",
              subscription: "sub_old",
            }
          : { id: "sub_old", status: "canceled" },
      );
    }),
  );
  await coordinator(env)("user1:price_Pro", async (lease) => {
    expect(lease.sessionId).toBeNull();
    expect(lease.idempotencyKey).not.toBe("old-key");
    return null;
  });
});

describe("deployment Stripe mode", () => {
  function configured(mode: string | undefined, key: string): HostedEnv {
    return {
      ...env,
      STRIPE_MODE: mode,
      STRIPE_SECRET_KEY: key,
      STRIPE_PRICE_ID: "price_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      TYPESAFE_API_KEY: "fixture",
      BILLING_ENABLED: "true",
    };
  }
  it.each([
    ["live", "sk_live_fixture", true],
    ["live", "rk_live_fixture", true],
    ["test", "sk_test_fixture", true],
    ["test", "rk_test_fixture", true],
    ["live", "sk_test_fixture", false],
    ["test", "sk_live_fixture", false],
    [undefined, "sk_live_fixture", false],
    ["invalid", "sk_live_fixture", false],
    ["live", "pk_live_fixture", false],
    ["live", "", false],
  ])("mode %s with %s gives ready=%s", (mode, key, ready) => {
    expect(billingReady(configured(mode, key))).toBe(ready);
  });
  it("blocks checkout and cached paid access when a test key reaches production", async () => {
    const { cookie } = await user();
    env = configured("live", "sk_test_fixture");
    await env.DB.prepare(
      "UPDATE users SET customer_id=?,recovery_confirmed=1 WHERE id=?",
    )
      .bind("cus_fixture", "user1")
      .run();
    await env.DB.prepare(
      "INSERT INTO entitlements(user_id,active,checked_at) VALUES(?,?,?)",
    )
      .bind("user1", 1, Math.floor(Date.now() / 1000))
      .run();
    expect(
      (await handleHostedApi(req("billing/checkout", {}, cookie), env)).status,
    ).toBe(503);
    const status = await handleHostedApi(
      new Request(origin + "/api/jev/status", { headers: { cookie } }),
      env,
    );
    expect(await status.json()).toMatchObject({
      billingReady: false,
      subscribed: false,
      configured: false,
    });
  });
  it.each([
    ["test", "price_fixture", "cus_fixture"],
    ["live", "price_old", "cus_fixture"],
    ["live", "price_fixture", "cus_previous"],
    null,
  ])(
    "revalidates cached access from another scope or an older schema",
    async (...parts) => {
      const { cookie } = await user();
      env = configured("live", "sk_live_fixture");
      await env.DB.prepare("UPDATE users SET customer_id=? WHERE id=?")
        .bind("cus_fixture", "user1")
        .run();
      const previousScope = parts[0] === null ? null : JSON.stringify(parts);
      await env.DB.prepare(
        "INSERT INTO entitlements(user_id,active,checked_at,scope) VALUES(?,?,?,?)",
      )
        .bind("user1", 1, Math.floor(Date.now() / 1000), previousScope)
        .run();
      const transport = vi.fn(async () =>
        Response.json({ object: "list", data: [], has_more: false }),
      );
      vi.spyOn(Stripe, "createFetchHttpClient").mockReturnValue(
        Stripe.createFetchHttpClient(transport),
      );
      const getStatus = () =>
        handleHostedApi(
          new Request(origin + "/api/jev/status", { headers: { cookie } }),
          env,
        );
      expect(await (await getStatus()).json()).toMatchObject({
        subscribed: false,
        configured: false,
      });
      expect(transport).toHaveBeenCalledTimes(1);
      // Matching scope reuses the newly verified negative result.
      expect(await (await getStatus()).json()).toMatchObject({
        subscribed: false,
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    ["test", "sk_test_fixture", false, 200],
    ["test", "sk_test_fixture", true, 400],
    ["live", "sk_live_fixture", false, 400],
    ["live", "sk_live_fixture", true, 200],
    ["live", "sk_test_fixture", false, 503],
  ])(
    "accepts only signed events matching the deployment mode",
    async (mode, key, live, status) => {
      env = configured(mode, key);
      // Webhooks remain available during a billing-disabled rollout.
      env.BILLING_ENABLED = "false";
      const payload = JSON.stringify({
        id: "evt_fixture",
        type: "customer.subscription.updated",
        livemode: live,
        data: { object: { customer: "cus_fixture" } },
      });
      const signature = new Stripe(key).webhooks.generateTestHeaderString({
        payload,
        secret: env.STRIPE_WEBHOOK_SECRET!,
      });
      const response = await handleHostedApi(
        new Request(origin + "/api/billing/webhook", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: payload,
        }),
        env,
      );
      expect(response.status).toBe(status);
      expect(
        store.sqlite
          .prepare("SELECT count(*) AS count FROM billing_events")
          .get(),
      ).toMatchObject({ count: status === 200 ? 1 : 0 });
    },
  );
});
