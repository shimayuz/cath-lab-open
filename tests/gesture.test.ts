import { describe, it, expect } from "vitest";
import { gestureDelta, readGesture } from "../src/hand/gesture";
import type { GestureFrame, Landmark } from "../src/hand/gesture";
const base: GestureFrame = {
  wrist: { x: 0.5, y: 0.5, z: 0 },
  angle: 0,
  pinch: true,
  fingers: [1, 1, 1, 1, 1],
  time: 100,
};
describe("gesture control", () => {
  it("requires two consecutive pinches to move", () => {
    expect(gestureDelta(null, base).push).toBe(0);
    expect(
      gestureDelta(
        { ...base, pinch: false },
        { ...base, time: 170, wrist: { ...base.wrist, y: 0.48 } },
      ).push,
    ).toBe(0);
  });
  it("maps upward motion to push and wrist tilt to rotation", () => {
    const d = gestureDelta(base, {
      ...base,
      time: 170,
      wrist: { ...base.wrist, y: 0.48 },
      angle: 5,
    });
    expect(d.push).toBeGreaterThan(0);
    expect(d.rotation).toBe(5);
  });
  it("maps down to pull and counterclockwise tilt to negative rotation", () => {
    const d = gestureDelta(base, {
      ...base,
      time: 170,
      wrist: { ...base.wrist, y: 0.52 },
      angle: -5,
    });
    expect(d.push).toBeLessThan(0);
    expect(d.rotation).toBe(-5);
  });
  it("stops on loss or open fingers", () => {
    expect(gestureDelta(base, null)).toEqual({
      push: 0,
      rotation: 0,
      pinched: false,
    });
    expect(gestureDelta(base, { ...base, time: 170, pinch: false }).push).toBe(
      0,
    );
  });
  it("rejects stale frames and jumps", () => {
    expect(gestureDelta(base, { ...base, time: 800, angle: 10 }).rotation).toBe(
      0,
    );
    expect(
      gestureDelta(base, {
        ...base,
        time: 170,
        wrist: { ...base.wrist, y: 0.1 },
      }).push,
    ).toBe(0);
  });
  it("handles angular wraparound", () => {
    expect(
      gestureDelta({ ...base, angle: 178 }, { ...base, time: 170, angle: -178 })
        .rotation,
    ).toBe(4);
  });
  it("ignores tiny movements", () => {
    const d = gestureDelta(base, {
      ...base,
      time: 170,
      wrist: { ...base.wrist, y: 0.499 },
      angle: 0.5,
    });
    expect(d.push).toBe(0);
    expect(d.rotation).toBe(0);
  });
  it("requires exactly 21 finite landmarks", () => {
    expect(readGesture([], 100)).toBeNull();
    const points: Landmark[] = Array.from({ length: 21 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
    }));
    points[1].x = NaN;
    expect(readGesture(points, 100)).toBeNull();
  });
  it("produces five finger values and wrist from 21 points", () => {
    const points: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
      x: 0.5 + i * 0.01,
      y: 0.8 - i * 0.01,
      z: 0,
    }));
    const frame = readGesture(points, 100)!;
    expect(frame.fingers).toHaveLength(5);
    expect(frame.wrist).toEqual(points[0]);
    expect(frame.fingers.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe("continuous fine motion", () => {
  it("accumulates repeated sub-threshold movement instead of losing slow pushes", () => {
    const remainder = { push: 0, rotation: 0 };
    let previous = { ...base },
      total = 0;
    for (let i = 1; i <= 40; i++) {
      const next = {
        ...base,
        time: 100 + i * 66,
        wrist: { ...base.wrist, y: 0.5 - i * 0.001 },
      };
      total += gestureDelta(previous, next, 1, remainder).push;
      previous = next;
    }
    expect(total).toBeGreaterThan(5.5);
  });
  it("does not accumulate stationary back-and-forth jitter", () => {
    const remainder = { push: 0, rotation: 0 };
    let previous = { ...base },
      total = 0;
    for (let i = 1; i <= 40; i++) {
      const next = {
        ...base,
        time: 100 + i * 66,
        wrist: { ...base.wrist, y: 0.5 - (i % 2) * 0.001 },
      };
      total += Math.abs(gestureDelta(previous, next, 1, remainder).push);
      previous = next;
    }
    expect(total).toBe(0);
  });
  it("discards residual motion on release, loss, stale frames and tracking jumps", () => {
    const stops = [
      null,
      { ...base, time: 166, pinch: false },
      { ...base, time: 800 },
      { ...base, time: 166, wrist: { ...base.wrist, y: 0.1 } },
    ];
    for (const stop of stops) {
      const remainder = { push: 0.1, rotation: 0.2 };
      gestureDelta(base, stop, 1, remainder);
      expect(remainder).toEqual({ push: 0, rotation: 0 });
    }
  });
});

describe("pinch hysteresis", () => {
  it("keeps a held grip through small landmark noise, but releases an open pinch", () => {
    const points: Landmark[] = Array.from({ length: 21 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
    }));
    points[9] = { x: 0.5, y: 0.4, z: 0 };
    points[4] = { x: 0.48, y: 0.45, z: 0 };
    points[8] = { x: 0.512, y: 0.45, z: 0 };
    const closed = readGesture(points, 100)!;
    expect(closed.pinch).toBe(true);
    points[8] = { x: 0.52, y: 0.45, z: 0 };
    expect(readGesture(points, 166, closed)?.pinch).toBe(true);
    expect(readGesture(points, 166)?.pinch).toBe(false);
    points[8] = { x: 0.532, y: 0.45, z: 0 };
    expect(readGesture(points, 232, closed)?.pinch).toBe(false);
  });
});

describe("slow rendering", () => {
  it("accepts a bounded 400ms hand movement but resets after a longer interruption", () => {
    expect(
      gestureDelta(base, {
        ...base,
        time: 500,
        wrist: { ...base.wrist, y: 0.48 },
      }).push,
    ).toBeGreaterThan(0);
    expect(
      gestureDelta(base, {
        ...base,
        time: 700,
        wrist: { ...base.wrist, y: 0.48 },
      }).push,
    ).toBe(0);
  });
});
