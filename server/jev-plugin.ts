import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isJevRequest } from "../src/hand/jev-contract.ts";
import { evaluateIntent, jevClient, JEV_MODEL } from "./jev.ts";
import type { JevRequest, JevResult } from "../src/hand/jev-contract.ts";
type Evaluate = (
  request: JevRequest,
  signal: AbortSignal,
) => Promise<JevResult>;
export function createJevMiddleware(apiKey: string, evaluate?: Evaluate) {
  const client = apiKey ? jevClient(apiKey) : null;
  const run: Evaluate =
    evaluate ?? ((r, signal) => evaluateIntent(client!, r, signal));
  let active = false,
    nextAllowed = 0;
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const path = req.url?.split("?")[0];
    if (path !== "/api/jev/status" && path !== "/api/jev/intent") return next();
    const send = (status: number, data: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    // This gateway is intentionally local. A public deployment needs real authentication.
    let allowed = false;
    try {
      const host = new URL(`http://${req.headers.host}`);
      const origin = req.headers.origin ? new URL(req.headers.origin) : null;
      allowed =
        ["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) &&
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress ?? "",
        ) &&
        (!origin || origin.host === host.host) &&
        req.headers["sec-fetch-site"] !== "cross-site";
    } catch {
      /* Invalid host or origin. */
    }
    if (!allowed) return send(403, { code: "forbidden" });
    if (path === "/api/jev/status") {
      if (req.method !== "GET") return send(405, { code: "method" });
      return send(200, { configured: !!apiKey, model: JEV_MODEL });
    }
    if (req.method !== "POST") return send(405, { code: "method" });
    if (
      req.headers["content-type"]?.split(";")[0] !== "application/json" ||
      req.headers["x-cath-lab"] !== "hand-intent-v1"
    )
      return send(403, { code: "forbidden" });
    if (!apiKey) return send(503, { code: "not-configured" });
    if (active || Date.now() < nextAllowed)
      return send(429, { code: "rate-limited" });
    active = true;
    nextAllowed = Date.now() + 250;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      send(504, { code: "timeout" });
      if (!req.complete) req.destroy();
    }, 1200);
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnect);
    try {
      let body = "",
        bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4096) {
          send(413, { code: "too-large" });
          return;
        }
        body += chunk;
      }
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        return send(400, { code: "invalid-request" });
      }
      if (!isJevRequest(value)) return send(400, { code: "invalid-request" });
      if (controller.signal.aborted) return;
      const result = await run(value, controller.signal);
      if (!controller.signal.aborted) send(200, result);
    } catch (error) {
      const status =
        typeof error === "object" && error && "status" in error
          ? error.status
          : null;
      const code =
        status === 401 || status === 403
          ? "authentication"
          : status === 429
            ? "rate-limited"
            : controller.signal.aborted
              ? "timeout"
              : "unavailable";
      send(status === 429 ? 429 : 502, { code });
    } finally {
      clearTimeout(timer);
      res.off("close", disconnect);
      active = false;
    }
  };
}
export function jevPlugin(apiKey: string): Plugin {
  return {
    name: "cath-lab-jev",
    configureServer(server) {
      server.middlewares.use(createJevMiddleware(apiKey));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createJevMiddleware(apiKey));
    },
  };
}
