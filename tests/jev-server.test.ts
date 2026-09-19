import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request, type Server } from "node:http";
import { createJevMiddleware } from "../server/jev-plugin";
import { evaluateIntent, jevClient } from "../server/jev";
import type { JevRequest, JevResult } from "../src/hand/jev-contract";
const payload: JevRequest = {
  id: 1,
  instrument: "catheter",
  recent: [
    {
      push: { grip: "gripped", movement: "push", returning: false },
      rotation: { grip: "gripped", movement: "still" },
    },
  ],
};
const result: JevResult = {
  id: 1,
  model: "jev-1.13.0",
  elapsedMs: 25,
  push: { choice: "push", confidence: 1, probability: 1 },
  rotation: { choice: "hold", confidence: 1, probability: 1 },
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
});
async function gateway(
  key = "dummy-test-key",
  run = vi.fn(async () => result),
) {
  const middleware = createJevMiddleware(key, run);
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as { port: number };
  const url = `http://127.0.0.1:${a.port}`;
  const send = (
    body: unknown = payload,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${url}/api/jev/intent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cath-Lab": "hand-intent-v1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { url, send, run };
}
describe("local Jev gateway", () => {
  it("status checks configuration without making paid requests", async () => {
    const s = await gateway();
    expect(await (await fetch(s.url + "/api/jev/status")).json()).toEqual({
      configured: true,
      model: "jev-1.13.0",
    });
    expect(s.run).not.toHaveBeenCalled();
    expect(await (await s.send()).json()).toEqual(result);
  });
  it("never sends without a key", async () => {
    const s = await gateway("");
    expect((await s.send()).status).toBe(503);
    expect(s.run).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin site, invalid host and missing application header", async () => {
    const s = await gateway();
    const rejectedHeaders: Record<string, string>[] = [
      { Origin: "https://other.example" },
      { "Sec-Fetch-Site": "cross-site" },
      { "X-Cath-Lab": "" },
    ];
    for (const headers of rejectedHeaders)
      expect(
        (await s.send(payload, headers)).status,
        JSON.stringify(headers),
      ).toBe(403);
    expect(s.run).not.toHaveBeenCalled();
  });
  it("rejects a forged Host at the HTTP layer", async () => {
    const s = await gateway();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        s.url + "/api/jev/status",
        { headers: { Host: "other.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
    expect(s.run).not.toHaveBeenCalled();
  });
  it("rejects arbitrary AI requests", async () => {
    const s = await gateway();
    expect((await s.send({ ...payload, question: "arbitrary" })).status).toBe(
      400,
    );
    expect(s.run).not.toHaveBeenCalled();
  });
  it("limits request size", async () => {
    const s = await gateway();
    expect((await s.send({ data: "x".repeat(5000) })).status).toBe(413);
    expect(s.run).not.toHaveBeenCalled();
  });
  it("caps request frequency", async () => {
    const s = await gateway();
    expect((await s.send()).status).toBe(200);
    expect((await s.send()).status).toBe(429);
    expect(s.run).toHaveBeenCalledTimes(1);
  });
  it("redacts SDK exception bodies", async () => {
    const s = await gateway(
      "dummy-test-key",
      vi.fn(async () => {
        throw new Error("secret upstream error");
      }),
    );
    const r = await s.send();
    expect(r.status).toBe(502);
    expect(await r.text()).toBe('{"code":"unavailable"}');
  });
});
it("SDK uses the fixed server endpoint, excludes unrelated data, and returns typed decisions", async () => {
  let sentUrl = "",
    sentBody = "";
  const transport = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      sentUrl = String(input);
      sentBody = String(init?.body);
      return Response.json({
        model: "jev-1.13.0",
        answers: {
          push: {
            choice: "push",
            confidence: 1,
            probabilities: {
              push: 1,
              pull: 0,
              hold: 0,
              regrip: 0,
              uncertain: 0,
            },
          },
          rotation: {
            choice: "hold",
            confidence: 1,
            probabilities: {
              clockwise: 0,
              counterclockwise: 0,
              hold: 1,
              regrip: 0,
              uncertain: 0,
            },
          },
        },
      });
    },
  );
  const r = await evaluateIntent(
    jevClient("dummy-test-key", transport as typeof fetch),
    payload,
    new AbortController().signal,
  );
  expect(sentUrl).toBe("https://api.typesafe.ai/v1/systemone");
  expect(JSON.parse(sentBody).state).toEqual({
    instrument: payload.instrument,
    recent: payload.recent,
  });
  expect(sentBody).not.toContain("dummy-test-key");
  expect(r.push.choice).toBe("push");
  expect(transport).toHaveBeenCalledTimes(1);
});
