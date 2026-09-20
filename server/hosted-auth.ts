import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransport,
} from "@simplewebauthn/server";
import type { D1Database } from "@cloudflare/workers-types";
import { Buffer } from "node:buffer";
export interface Account {
  id: string;
  customer_id: string | null;
  recovery_confirmed: number;
  auth_epoch: number;
  authenticated_at: number;
}
export interface AuthEnv {
  DB: D1Database;
  APP_ORIGIN: string;
}
const SESSION = "__Host-cath-session",
  CHALLENGE = "__Host-cath-challenge";
const seconds = () => Math.floor(Date.now() / 1000);
export const randomToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
export async function digest(value: string) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("hex");
}
export function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
function cookie(name: string, token: string, age: number) {
  return `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}
function getCookie(request: Request, name: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) ?? ""
  );
}
export async function readJson(
  request: Request,
  max = 16384,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw Error("invalid-input");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) {
        await reader.cancel();
        throw Error("too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("invalid-input");
  return data;
}
export async function reserve(
  db: D1Database,
  key: string,
  limit: number,
  expires: number,
) {
  const row = await db
    .prepare(
      "INSERT INTO quotas(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count",
    )
    .bind(key, expires, limit)
    .first();
  return !!row;
}
export async function account(
  request: Request,
  env: AuthEnv,
): Promise<Account | null> {
  const token = getCookie(request, SESSION);
  if (!/^[\w-]{43}$/.test(token)) return null;
  return env.DB.prepare(
    "SELECT u.id,u.customer_id,u.recovery_confirmed,u.auth_epoch,s.issued_at AS authenticated_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND s.auth_epoch=u.auth_epoch",
  )
    .bind(await digest(token), seconds())
    .first<Account>();
}
export async function issueSession(
  env: AuthEnv,
  userId: string,
  epoch: number,
) {
  const token = randomToken();
  const saved = await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,auth_epoch,issued_at,expires_at) SELECT ?,id,auth_epoch,?,? FROM users WHERE id=? AND auth_epoch=? RETURNING user_id",
  )
    .bind(await digest(token), seconds(), seconds() + 2592000, userId, epoch)
    .first();
  if (!saved) throw Error("reauthenticate");
  return cookie(SESSION, token, 2592000);
}
export async function authRoute(
  request: Request,
  env: AuthEnv,
  path: string,
): Promise<Response> {
  const origin = new URL(env.APP_ORIGIN),
    now = seconds();
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const ipHash = await digest(ip + env.APP_ORIGIN);
  if (
    !(await reserve(
      env.DB,
      `auth:${ipHash}:${Math.floor(now / 60)}`,
      15,
      now + 120,
    ))
  )
    return json({ code: "rate-limited" }, 429);
  // Expired auth state is pruned using indexed expiry columns, never by logging bodies.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM challenges WHERE expires_at<?").bind(now),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now),
    env.DB.prepare("DELETE FROM quotas WHERE expires_at<?").bind(now),
  ]);
  const current = await account(request, env);
  if (path === "logout") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await digest(getCookie(request, SESSION)))
      .run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(SESSION, "", 0) });
  }
  if (
    current &&
    [
      "confirm-recovery",
      "new-recovery",
      "register/options",
      "register/verify",
    ].includes(path) &&
    current.authenticated_at < now - 600
  )
    return json({ code: "reauthenticate" }, 401);
  if (path === "new-recovery") {
    if (!current) return json({ code: "sign-in-required" }, 401);
    const next = randomToken();
    const updated = await env.DB.prepare(
      "UPDATE users SET pending_recovery_hash=? WHERE id=? AND auth_epoch=? RETURNING id",
    )
      .bind(await digest(next), current.id, current.auth_epoch)
      .first();
    if (!updated) return json({ code: "reauthenticate" }, 401);
    return json({ recovery: next });
  }
  if (path === "confirm-recovery") {
    if (!current) return json({ code: "sign-in-required" }, 401);
    const data = await readJson(request);
    if (typeof data.recovery !== "string" || !/^[\w-]{43}$/.test(data.recovery))
      return json({ code: "invalid-recovery" }, 400);
    const codeHash = await digest(data.recovery);
    const saved = await env.DB.prepare(
      "UPDATE users SET recovery_hash=COALESCE(pending_recovery_hash,recovery_hash),pending_recovery_hash=NULL,recovery_confirmed=1 WHERE id=? AND auth_epoch=? AND COALESCE(pending_recovery_hash,recovery_hash)=? AND EXISTS (SELECT 1 FROM credentials WHERE user_id=users.id AND auth_epoch=users.auth_epoch) RETURNING id",
    )
      .bind(current.id, current.auth_epoch, codeHash)
      .first();
    return saved
      ? json({ ok: true })
      : json({ code: "recovery-confirmation-failed" }, 409);
  }
  if (path === "recover") {
    const data = await readJson(request),
      recovery = typeof data.recovery === "string" ? data.recovery.trim() : "";
    if (!/^[\w-]{43}$/.test(recovery))
      return json({ code: "invalid-recovery" }, 400);
    const next = randomToken();
    const recovered = await env.DB.prepare(
      "UPDATE users SET pending_recovery_hash=?,recovery_confirmed=0,auth_epoch=auth_epoch+1 WHERE recovery_hash=? RETURNING id,auth_epoch",
    )
      .bind(await digest(next), await digest(recovery))
      .first<{ id: string; auth_epoch: number }>();
    if (!recovered) return json({ code: "invalid-recovery" }, 400);
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM sessions WHERE user_id=? AND auth_epoch<?",
      ).bind(recovered.id, recovered.auth_epoch),
      env.DB.prepare(
        "DELETE FROM credentials WHERE user_id=? AND auth_epoch<?",
      ).bind(recovered.id, recovered.auth_epoch),
    ]);
    return json({ ok: true, recovery: next }, 200, {
      "Set-Cookie": await issueSession(env, recovered.id, recovered.auth_epoch),
    });
  }
  if (path === "register/options" || path === "login/options") {
    if (
      path === "register/options" &&
      !current &&
      !(await reserve(
        env.DB,
        `signup:${ipHash}:${Math.floor(now / 86400)}`,
        10,
        now + 86400,
      ))
    )
      return json({ code: "rate-limited" }, 429);
    const kind = path.startsWith("register") ? "register" : "login",
      userId = current?.id ?? crypto.randomUUID();
    const existing = current
      ? await env.DB.prepare("SELECT id FROM credentials WHERE user_id=?")
          .bind(current.id)
          .all<{ id: string }>()
      : { results: [] };
    const options =
      kind === "register"
        ? await generateRegistrationOptions({
            rpName: "Cath Lab",
            rpID: origin.hostname,
            userName: `Cath Lab ${userId.slice(0, 8)}`,
            userID: new TextEncoder().encode(userId),
            attestationType: "none",
            authenticatorSelection: {
              residentKey: "required",
              userVerification: "required",
            },
            excludeCredentials: existing.results.map((c) => ({ id: c.id })),
          })
        : await generateAuthenticationOptions({
            rpID: origin.hostname,
            userVerification: "required",
          });
    const token = randomToken();
    await env.DB.prepare(
      "INSERT INTO challenges(token_hash,challenge,kind,user_id,expires_at,auth_epoch) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        await digest(token),
        options.challenge,
        kind,
        userId,
        now + 300,
        current?.auth_epoch ?? 0,
      )
      .run();
    return json(options, 200, { "Set-Cookie": cookie(CHALLENGE, token, 300) });
  }
  if (path === "register/verify" || path === "login/verify") {
    const token = getCookie(request, CHALLENGE);
    if (!/^[\w-]{43}$/.test(token))
      return json({ code: "challenge-expired" }, 400);
    const kind = path.startsWith("register") ? "register" : "login";
    const challenge = await env.DB.prepare(
      "DELETE FROM challenges WHERE token_hash=? AND kind=? AND expires_at>? RETURNING challenge,user_id,auth_epoch",
    )
      .bind(await digest(token), kind, now)
      .first<{ challenge: string; user_id: string; auth_epoch: number }>();
    if (!challenge) return json({ code: "challenge-expired" }, 400);
    const body = await readJson(request);
    if (kind === "register") {
      // A session must still own an existing account; stale registration cannot attach to another user.
      const exists = await env.DB.prepare("SELECT id FROM users WHERE id=?")
        .bind(challenge.user_id)
        .first();
      if (
        exists &&
        (current?.id !== challenge.user_id ||
          current.auth_epoch !== challenge.auth_epoch)
      )
        return json({ code: "sign-in-required" }, 401);
      const verification = await verifyRegistrationResponse({
        response: body as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: env.APP_ORIGIN,
        expectedRPID: origin.hostname,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo)
        return json({ code: "invalid-passkey" }, 400);
      const c = verification.registrationInfo.credential,
        recovery = exists ? null : randomToken();
      const statements = [];
      if (recovery)
        statements.push(
          env.DB.prepare(
            "INSERT INTO users(id,recovery_hash,created_at) VALUES(?,?,?)",
          ).bind(challenge.user_id, await digest(recovery), now),
        );
      statements.push(
        env.DB.prepare(
          "INSERT INTO credentials(id,user_id,public_key,counter,transports,auth_epoch) SELECT ?,id,?,?,?,auth_epoch FROM users WHERE id=? AND auth_epoch=?",
        ).bind(
          c.id,
          Buffer.from(c.publicKey).toString("base64"),
          c.counter,
          JSON.stringify(c.transports ?? []),
          challenge.user_id,
          challenge.auth_epoch,
        ),
      );
      await env.DB.batch(statements);
      return json({ ok: true, recovery }, 200, {
        "Set-Cookie": await issueSession(
          env,
          challenge.user_id,
          challenge.auth_epoch,
        ),
      });
    }
    if (typeof body.id !== "string")
      return json({ code: "invalid-passkey" }, 400);
    const stored = await env.DB.prepare(
      "SELECT c.* FROM credentials c JOIN users u ON u.id=c.user_id AND u.auth_epoch=c.auth_epoch WHERE c.id=?",
    )
      .bind(body.id)
      .first<{
        id: string;
        user_id: string;
        public_key: string;
        counter: number;
        transports: string;
        auth_epoch: number;
      }>();
    if (!stored) return json({ code: "invalid-passkey" }, 400);
    const verification = await verifyAuthenticationResponse({
      response: body as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.APP_ORIGIN,
      expectedRPID: origin.hostname,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.public_key, "base64")),
        counter: stored.counter,
        transports: JSON.parse(stored.transports) as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    });
    if (!verification.verified) return json({ code: "invalid-passkey" }, 400);
    const updated = await env.DB.prepare(
      "UPDATE credentials SET counter=? WHERE id=? AND counter=? AND EXISTS (SELECT 1 FROM users WHERE id=credentials.user_id AND auth_epoch=credentials.auth_epoch) RETURNING id",
    )
      .bind(
        verification.authenticationInfo.newCounter,
        stored.id,
        stored.counter,
      )
      .first();
    if (!updated) return json({ code: "try-again" }, 409);
    return json({ ok: true }, 200, {
      "Set-Cookie": await issueSession(env, stored.user_id, stored.auth_epoch),
    });
  }
  return json({ code: "not-found" }, 404);
}
