import type { JevResult, MotionObservation } from "./jev-contract";
import { isJevResult } from "./jev-contract";
export const JEV_FRESH_MS = 500;
export const JEV_INTERVAL_MS = 250;
export interface JevStatus {
  state: "off" | "waiting" | "active" | "stale" | "fallback";
  latencyMs: number | null;
  result: JevResult | null;
}
interface Motion {
  push: number;
  rotation: number;
}
/** Non-blocking assist: explicit gripped motion takes priority over AI hold decisions. */
export class JevAssist {
  private enabled = false;
  private status: JevStatus = { state: "off", latencyMs: null, result: null };
  private revision = 0;
  private generation = 0;
  private sequence = 0;
  private signature = "";
  private history: MotionObservation[] = [];
  private pending: AbortController | null = null;
  private decision: {
    result: JevResult;
    until: number;
    revision: number;
  } | null = null;
  private nextSend = 0;
  private lastSampleAt = -Infinity;
  private failures = 0;
  constructor(
    private readonly onStatus: (status: JevStatus) => void,
    private readonly transport: typeof fetch = (input, init) =>
      fetch(input, init),
    private readonly now: () => number = () => performance.now(),
    private readonly endpoint = new URL(
      `${import.meta.env.BASE_URL}api/jev/intent`,
      document.baseURI,
    ).href,
  ) {}
  private reportStatus(status: JevStatus) {
    this.status = status;
    this.onStatus(status);
  }
  snapshot(): JevStatus {
    if (this.status.state !== "active") return this.status;
    if (
      !this.decision ||
      this.decision.revision !== this.revision ||
      this.now() > this.decision.until
    )
      return { state: "stale", latencyMs: this.status.latencyMs, result: null };
    return this.status;
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.reset();
  }
  reset() {
    this.generation++;
    this.revision++;
    this.pending?.abort();
    this.pending = null;
    this.decision = null;
    this.signature = "";
    this.history = [];
    this.nextSend = 0;
    this.lastSampleAt = -Infinity;
    this.failures = 0;
    this.reportStatus({
      state: this.enabled ? "waiting" : "off",
      latencyMs: null,
      result: null,
    });
  }
  observe(observation: MotionObservation, instrument: "wire" | "catheter") {
    if (!this.enabled) return;
    const time = this.now();
    if (
      time - this.lastSampleAt > JEV_FRESH_MS &&
      this.lastSampleAt !== -Infinity
    )
      this.reset();
    this.lastSampleAt = time;
    const signature = JSON.stringify([instrument, observation]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.revision++;
      if (this.decision)
        this.reportStatus({ state: "waiting", latencyMs: null, result: null });
      this.decision = null;
    }
    this.history.push(observation);
    this.history = this.history.slice(-6);
    if (this.decision && time > this.decision.until) {
      this.decision = null;
      this.reportStatus({ state: "stale", latencyMs: null, result: null });
    }
    if (this.pending || time < this.nextSend) return;
    const controller = new AbortController();
    this.pending = controller;
    const generation = this.generation,
      revision = this.revision,
      id = ++this.sequence;
    this.nextSend = time + JEV_INTERVAL_MS;
    const timeout = setTimeout(() => controller.abort(), 850);
    void this.transport(this.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Cath-Lab": "hand-intent-v1",
      },
      body: JSON.stringify({ id, instrument, recent: this.history }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("jev-unavailable");
        const result: unknown = await response.json();
        if (!isJevResult(result) || result.id !== id)
          throw new Error("invalid-response");
        if (controller.signal.aborted || generation !== this.generation) return;
        this.failures = 0;
        const elapsed = this.now() - time;
        if (revision !== this.revision || elapsed > JEV_FRESH_MS) {
          this.reportStatus({
            state: "stale",
            latencyMs: Math.round(elapsed),
            result: null,
          });
          return;
        }
        this.decision = { result, until: time + JEV_FRESH_MS, revision };
        this.reportStatus({
          state: "active",
          latencyMs: Math.round(elapsed),
          result,
        });
      })
      .catch(() => {
        if (generation !== this.generation) return;
        this.decision = null;
        this.failures++;
        this.nextSend =
          this.now() + Math.min(30000, 1000 * 2 ** Math.min(this.failures, 5));
        this.reportStatus({ state: "fallback", latencyMs: null, result: null });
      })
      .finally(() => {
        clearTimeout(timeout);
        if (this.pending === controller) this.pending = null;
      });
  }
  filter<T extends Motion>(motion: T): T {
    const d = this.decision;
    if (
      !this.enabled ||
      !d ||
      d.revision !== this.revision ||
      this.now() > d.until
    )
      return motion;
    const hold = (answer: JevResult["push"] | JevResult["rotation"]) =>
      answer.confidence >= 0.85 &&
      answer.probability >= 0.85 &&
      (answer.choice === "hold" || answer.choice === "regrip");
    return {
      ...motion,
      push:
        hold(d.result.push) &&
        !(
          this.history.at(-1)?.push.grip === "gripped" &&
          !this.history.at(-1)?.push.returning &&
          this.history.at(-1)?.push.movement ===
            (motion.push > 0 ? "push" : "pull")
        )
          ? 0
          : motion.push,
      rotation:
        hold(d.result.rotation) &&
        !(
          this.history.at(-1)?.rotation.grip === "gripped" &&
          this.history.at(-1)?.rotation.movement ===
            (motion.rotation > 0 ? "clockwise" : "counterclockwise")
        )
          ? 0
          : motion.rotation,
    };
  }
}
