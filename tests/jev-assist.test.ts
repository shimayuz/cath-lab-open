import { describe, it, expect, vi, afterEach } from "vitest";
import { JevAssist, type JevStatus } from "../src/hand/jev-assist";
import {
  isJevRequest,
  isJevResult,
  type JevResult,
  type MotionObservation,
} from "../src/hand/jev-contract";
const observation: MotionObservation = {
  push: { grip: "gripped", movement: "push", returning: false },
  rotation: { grip: "gripped", movement: "clockwise" },
};
const movement = { push: 0.02, rotation: 3, returning: false };
const answer = (id = 1): JevResult => ({
  id,
  model: "jev-1.13.0",
  elapsedMs: 40,
  push: { choice: "regrip", confidence: 0.95, probability: 0.95 },
  rotation: { choice: "clockwise", confidence: 0.99, probability: 0.99 },
});
function setup() {
  let time = 0;
  const requests: {
    init: RequestInit;
    resolve: (v: Response) => void;
    reject: (e: Error) => void;
  }[] = [];
  const transport = vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) =>
        requests.push({ init: init!, resolve, reject }),
      ),
  );
  const statuses: JevStatus[] = [];
  const assist = new JevAssist(
    (s) => statuses.push(s),
    transport as typeof fetch,
    () => time,
    "http://localhost/api/jev/intent",
  );
  assist.setEnabled(true);
  return {
    assist,
    transport,
    requests,
    statuses,
    time: (t: number) => {
      time = t;
    },
    respond: async (i = 0, result = answer()) => {
      requests[i].resolve(Response.json(result));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe("Jev closed transport contract", () => {
  it("accepts only bounded motion vocabulary, no prompt/image/extra fields", () => {
    const r = { id: 0, instrument: "catheter", recent: [observation] };
    expect(isJevRequest(r)).toBe(true);
    for (const bad of [
      { ...r, prompt: "arbitrary" },
      { ...r, recent: [] },
      { ...r, recent: Array(7).fill(observation) },
      { ...r, id: -1 },
      {
        ...r,
        recent: [
          { ...observation, push: { ...observation.push, movement: "attack" } },
        ],
      },
    ])
      expect(isJevRequest(bad)).toBe(false);
    expect(
      isJevResult({
        ...answer(),
        push: { choice: "push", confidence: NaN, probability: 1 },
      }),
    ).toBe(false);
    expect(
      isJevResult({
        ...answer(),
        push: { choice: "anything", confidence: 1, probability: 1 },
      }),
    ).toBe(false);
  });
});
describe("Jev asynchronous assistance", () => {
  it("never waits for a pending request, caps in-flight requests and history", async () => {
    const s = setup();
    s.assist.observe(observation, "catheter");
    for (let i = 1; i < 10; i++) {
      s.time(i * 30);
      s.assist.observe(observation, "catheter");
      expect(s.assist.filter(movement)).toEqual(movement);
    }
    expect(s.transport).toHaveBeenCalledTimes(1);
    await s.respond();
    s.time(300);
    s.assist.observe(observation, "catheter");
    expect(JSON.parse(s.requests[1].init.body as string).recent).toHaveLength(
      6,
    );
    s.assist.setEnabled(false);
    expect(s.requests[1].init.signal?.aborted).toBe(true);
    await s.respond(1, answer(2));
  });
  it("only suppresses the specified axis and expires without new observations", async () => {
    const s = setup();
    s.assist.observe(
      { ...observation, push: { ...observation.push, grip: "arming" } },
      "catheter",
    );
    s.time(80);
    await s.respond();
    expect(s.assist.filter(movement)).toEqual({ ...movement, push: 0 });
    s.time(501);
    expect(s.assist.filter(movement)).toEqual(movement);
  });
  it("drops a prior hold as soon as the gripped hand reverses to Pull", async () => {
    const s = setup();
    s.assist.observe(observation, "wire");
    s.time(50);
    await s.respond();
    expect(s.assist.filter(movement).push).toBe(movement.push);
    s.time(80);
    s.assist.observe(
      { ...observation, push: { ...observation.push, movement: "pull" } },
      "wire",
    );
    expect(s.assist.filter({ ...movement, push: -0.02 }).push).toBe(-0.02);
    s.assist.setEnabled(false);
  });
  it.each([1, -1])(
    "does not cancel clear gripped push/pull and rotation with a confident hold: %s",
    async (sign) => {
      const s = setup();
      s.assist.observe(
        {
          push: {
            grip: "gripped",
            movement: sign > 0 ? "push" : "pull",
            returning: false,
          },
          rotation: {
            grip: "gripped",
            movement: sign > 0 ? "clockwise" : "counterclockwise",
          },
        },
        "catheter",
      );
      s.time(40);
      await s.respond(0, {
        ...answer(),
        rotation: { choice: "hold", confidence: 1, probability: 1 },
      });
      const motion = { push: sign * 1.5, rotation: sign * 0.4 };
      expect(s.assist.filter(motion)).toEqual(motion);
      s.assist.setEnabled(false);
    },
  );
  it("ignores weak, ambiguous and contradictory direction decisions", async () => {
    for (const push of [
      { choice: "hold", confidence: 0.84, probability: 0.99 },
      { choice: "regrip", confidence: 0.99, probability: 0.84 },
      { choice: "pull", confidence: 1, probability: 1 },
      { choice: "uncertain", confidence: 1, probability: 1 },
    ] as JevResult["push"][]) {
      const s = setup();
      s.assist.observe(observation, "catheter");
      s.time(50);
      await s.respond(0, { ...answer(), push });
      expect(s.assist.filter(movement)).toEqual(movement);
    }
  });
  it("cannot apply a response across release and regrip even when the pose returns", async () => {
    const s = setup();
    s.assist.observe(observation, "catheter");
    s.time(40);
    s.assist.observe(
      {
        ...observation,
        push: { grip: "released", movement: "still", returning: false },
      },
      "catheter",
    );
    s.time(80);
    s.assist.observe(observation, "catheter");
    await s.respond();
    expect(s.assist.filter(movement)).toEqual(movement);
    expect(s.statuses.at(-1)?.state).toBe("stale");
  });
  it.each(["reset", "disable", "instrument", "gap", "late"] as const)(
    "discards old responses after %s",
    async (mode) => {
      const s = setup();
      s.assist.observe(observation, "catheter");
      if (mode === "reset") s.assist.reset();
      if (mode === "disable") s.assist.setEnabled(false);
      if (mode === "instrument") {
        s.time(40);
        s.assist.observe(observation, "wire");
      }
      if (mode === "gap") {
        s.time(600);
        s.assist.observe(observation, "catheter");
      }
      if (mode === "late") s.time(501);
      await s.respond();
      expect(s.assist.filter(movement)).toEqual(movement);
      s.assist.setEnabled(false);
      if (mode === "gap") await s.respond(1, answer(2));
    },
  );
  it("backs off on errors while local motion continues", async () => {
    const s = setup();
    s.assist.observe(observation, "catheter");
    s.requests[0].reject(new Error("offline"));
    await new Promise((r) => setTimeout(r, 0));
    for (let t = 100; t < 2000; t += 100) {
      s.time(t);
      s.assist.observe(observation, "catheter");
    }
    expect(s.transport).toHaveBeenCalledTimes(1);
    expect(s.assist.filter(movement)).toEqual(movement);
    expect(s.statuses.at(-1)?.state).toBe("fallback");
    s.time(2100);
    s.assist.observe(observation, "catheter");
    expect(s.transport).toHaveBeenCalledTimes(2);
    s.assist.setEnabled(false);
    await s.respond(1, answer(2));
  });
  it("calls browser fetch without binding it to the assistance object", async () => {
    let invalidReceiver = false;
    const transport = function (this: unknown) {
      invalidReceiver = this !== undefined && this !== globalThis;
      return invalidReceiver
        ? Promise.reject(new TypeError("Illegal invocation"))
        : Promise.resolve(Response.json(answer()));
    };
    vi.stubGlobal("fetch", transport);
    try {
      const states: JevStatus[] = [];
      const a = new JevAssist(
        (s) => states.push(s),
        undefined,
        () => 0,
        "/api",
      );
      a.setEnabled(true);
      a.observe(observation, "catheter");
      await new Promise((r) => setTimeout(r, 0));
      expect(invalidReceiver).toBe(false);
      expect(states.at(-1)?.state).toBe("active");
      a.setEnabled(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("exposes only a currently fresh classification to measurements", async () => {
    const s = setup();
    s.assist.observe(observation, "catheter");
    s.time(50);
    await s.respond();
    expect(s.assist.snapshot().state).toBe("active");
    expect(s.assist.snapshot().result?.id).toBe(1);
    s.time(501);
    expect(s.assist.snapshot()).toMatchObject({ state: "stale", result: null });
    s.assist.setEnabled(false);
    expect(s.assist.snapshot()).toMatchObject({ state: "off", result: null });
  });
  it("is off by default and does not send", () => {
    const f = vi.fn();
    const a = new JevAssist(
      () => {},
      f,
      () => 0,
      "/api",
    );
    a.observe(observation, "catheter");
    expect(f).not.toHaveBeenCalled();
  });
});
