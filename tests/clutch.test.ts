import { describe, it, expect } from "vitest";
import {
  BimanualClutch,
  StrokeClutch,
  splitPushDelta,
} from "../src/hand/clutch";
import type { ClassifiedHand } from "../src/hand/bimanual";
import { readHandPair } from "../src/hand/bimanual";
import {
  initialState,
  reducer,
  CUSP_BOTTOM_INSERTION,
  distalIsFree,
} from "../src/simulator/model";
import { wirePoints } from "../src/simulator/anatomy";
const hand = (time: number, x = 0.5, pinch = true): ClassifiedHand => ({
  identity: "Left",
  wrist: { x, y: 0.6, z: 0 },
  angle: 0,
  time,
  pinch,
  fingers: [1, 1, 1, 1, 1],
});
describe("grip / stroke / hold / regrip", () => {
  it("repeats 12 push-release-return-regrip strokes, preserving wire coordinates every release", () => {
    const c = new StrokeClutch();
    let s = { ...initialState },
      time = 0;
    const totals: number[] = [];
    const tick = (x: number, pinch = true) => {
      time += 100;
      const r = c.update(hand(time, x, pinch), "left", 1);
      s = reducer(s, { type: "move", delta: r.delta });
      return r;
    };
    for (let cycle = 0; cycle < 12; cycle++) {
      tick(0.5);
      tick(0.5);
      expect(tick(0.5).delta).toBe(0);
      for (let i = 1; i <= 8; i++) tick(0.5 + i * 0.01);
      const held = s.wire;
      const coordinates = wirePoints(s).map((p) => p.toArray());
      // Release before returning the hand preserves the preceding push.
      expect(tick(0.56, false).delta).toBe(0);
      expect(s.wire).toBe(held);
      tick(0.55, false);
      tick(0.53, false);
      tick(0.5, false);
      expect(s.wire).toBe(held);
      expect(wirePoints(s).map((p) => p.toArray())).toEqual(coordinates);
      totals.push(held);
    }
    expect(totals[0]).toBeGreaterThan(10);
    expect(totals.slice(0, 8).every((n, i) => !i || n > totals[i - 1])).toBe(
      true,
    );
    expect(s.wire).toBe(100);
  });
  it("preserves equal total displacement across frame rates without queued movement", () => {
    const finish = (positions: number[]) => {
      const c = new StrokeClutch();
      let state = { ...initialState };
      c.update(hand(100), "left", 1);
      c.update(hand(200), "left", 1);
      positions.forEach((x, i) => {
        for (const delta of splitPushDelta(
          c.update(hand(300 + i * 100, x), "left", 1).delta,
        ))
          state = reducer(state, { type: "move", delta });
      });
      expect(c.update(hand(1200, 0.5, false), "left", 1).delta).toBe(0);
      return state.wire;
    };
    expect(finish([0.6])).toBeCloseTo(15);
    expect(finish([0.55, 0.6])).toBeCloseTo(15);
    expect(splitPushDelta(Infinity)).toEqual([]);
  });
  it("accepts continuously open hands even when rendering takes 600ms per frame", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "left", 1);
    c.update(hand(200), "left", 1);
    c.update(hand(800, 0.53, false), "left", 1);
    expect(c.update(hand(1400, 0.5, false), "left", 1).phase).toBe("released");
    c.update(hand(2000), "left", 1);
    c.update(hand(2600), "left", 1);
    expect(c.update(hand(3200, 0.53), "left", 1).delta).toBeGreaterThan(4);
  });
  it("can grasp immediately after one initially open frame or a reset", () => {
    const c = new StrokeClutch();
    for (let i = 0; i < 2; i++) {
      c.reset();
      expect(c.update(hand(100, 0.5, false), "left", 1).phase).toBe("released");
      expect(c.update(hand(200), "left", 1).phase).toBe("arming");
      expect(c.update(hand(300), "left", 1).phase).toBe("gripped");
      expect(c.update(hand(400, 0.53), "left", 1).delta).toBeGreaterThan(0);
    }
  });
  it("first closed frames at any new hand position produce no jump", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "left", 1);
    c.update(hand(200), "left", 1);
    c.update(hand(300, 0.55), "left", 1);
    c.update(hand(400, 0.55, false), "left", 1);
    c.update(hand(500, 0.5, false), "left", 1);
    expect(c.update(hand(600, 0.45), "left", 1).delta).toBe(0);
    expect(c.update(hand(700, 0.45), "left", 1).delta).toBe(0);
    expect(c.update(hand(800, 0.47), "left", 1).delta).toBeGreaterThan(0);
  });
  it("allows an intentional pull after a release and fresh grip", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "left", 1);
    c.update(hand(200), "left", 1);
    expect(c.update(hand(300, 0.53), "left", 1).delta).toBeGreaterThan(0);
    c.update(hand(400, 0.53, false), "left", 1);
    c.update(hand(500, 0.53, false), "left", 1);
    c.update(hand(600, 0.53), "left", 1);
    c.update(hand(700, 0.53), "left", 1);
    expect(c.update(hand(800, 0.51), "left", 1).delta).toBeLessThan(0);
  });
  it("requires a deliberate open hand after loss or a one-frame false release", () => {
    for (const lost of [null, hand(300, 0.52, false)]) {
      const c = new StrokeClutch();
      c.update(hand(100), "left", 1);
      c.update(hand(200), "left", 1);
      c.update(lost, "left", 1);
      expect(c.update(hand(400, 0.48), "left", 1)).toMatchObject({
        delta: 0,
        phase: "regrip",
      });
      c.update(hand(500, 0.48, false), "left", 1);
      c.update(hand(600, 0.48, false), "left", 1);
      c.update(hand(700, 0.48), "left", 1);
      c.update(hand(800, 0.48), "left", 1);
      expect(c.update(hand(900, 0.5), "left", 1).delta).toBeGreaterThan(0);
    }
  });
  it("does not combine two brief open detections separated by a closed hand", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "left", 1);
    c.update(hand(200), "left", 1);
    c.update(hand(300, 0.52, false), "left", 1);
    c.update(hand(400, 0.5, true), "left", 1);
    expect(c.update(hand(500, 0.48, false), "left", 1).phase).toBe("regrip");
    expect(c.update(hand(600, 0.47, true), "left", 1)).toMatchObject({
      delta: 0,
      phase: "regrip",
    });
    c.update(hand(700, 0.47, false), "left", 1);
    expect(c.update(hand(800, 0.47, false), "left", 1).phase).toBe("released");
  });
  it("holds through static noise, old timestamps and large jumps", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "left", 1);
    c.update(hand(200), "left", 1);
    for (let i = 3; i < 20; i++)
      expect(
        c.update(hand(i * 100, 0.5 + (i % 2) * 0.001), "left", 1).delta,
      ).toBe(0);
    expect(c.update(hand(2500, 0.5), "left", 1)).toMatchObject({
      delta: 0,
      phase: "gripped",
    });
    expect(c.update(hand(5000, 0.52), "left", 1)).toMatchObject({
      delta: 0,
      phase: "regrip",
    });
  });
  it("follows deliberate reversals through delayed frames without getting stuck", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "left", 1);
    c.update(hand(200), "left", 1);
    expect(c.update(hand(300, 0.53), "left", 1).delta).toBeGreaterThan(0);
    expect(c.update(hand(1000, 0.51), "left", 1).delta).toBeCloseTo(-3);
    expect(c.update(hand(1100, 0.49), "left", 1).delta).toBeCloseTo(-3);
    expect(c.update(hand(1200, 0.54), "left", 1).delta).toBeGreaterThan(0);
  });
  it("preserves an actual 0.40 held pinch through delayed classification and clutch processing", () => {
    const points = Array.from({ length: 21 }, (_, i) => ({
      x: 0.75,
      y: 0.5 - i * 0.007,
      z: 0,
    }));
    points[9] = { x: 0.75, y: 0.4, z: 0 };
    points[4] = { x: 0.73, y: 0.45, z: 0 };
    points[8] = { x: 0.762, y: 0.45, z: 0 };
    const categories = [{ categoryName: "Left", score: 0.99 }];
    const c = new StrokeClutch();
    let pair = readHandPair([points], 100, null, categories)!;
    c.update(pair[0], "left", 1);
    points[8] = { x: 0.77, y: 0.45, z: 0 };
    pair = readHandPair([structuredClone(points)], 200, pair, categories)!;
    c.update(pair[0], "left", 1);
    pair = readHandPair([structuredClone(points)], 900, pair, categories)!;
    expect(pair[0]?.pinch).toBe(true);
    expect(c.update(pair[0], "left", 1)).toMatchObject({
      delta: 0,
      phase: "gripped",
    });
  });
  it("requires release after a rotation tracking jump", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "rotation", 1);
    c.update(hand(200), "rotation", 1);
    expect(c.update({ ...hand(300), angle: 90 }, "rotation", 1)).toMatchObject({
      delta: 0,
      phase: "regrip",
    });
    expect(c.update({ ...hand(400), angle: 95 }, "rotation", 1)).toMatchObject({
      delta: 0,
      phase: "regrip",
    });
  });
  it("supports vertical strokes and independent rotation while the push hand is released", () => {
    const c = new BimanualClutch();
    const left = hand(100);
    const right = { ...hand(100, 0.2), identity: "Right" as const };
    c.update([left, right], 1, false, "up");
    c.update(
      [
        { ...left, time: 200 },
        { ...right, time: 200 },
      ],
      1,
      false,
      "up",
    );
    const d = c.update(
      [
        { ...left, time: 300, wrist: { ...left.wrist, y: 0.57 } },
        { ...right, time: 300, angle: 5 },
      ],
      1,
      false,
      "up",
    );
    expect(d.push).toBeGreaterThan(0);
    expect(d.rotation).toBe(5);
    const released = c.update(
      [
        { ...left, time: 400, pinch: false },
        { ...right, time: 400, angle: 10 },
      ],
      1,
      false,
      "up",
    );
    expect(released.push).toBe(0);
    expect(released.rotation).toBe(5);
  });
  it("resets both grips when the caller changes device or roles", () => {
    const c = new BimanualClutch();
    c.update([hand(100), null], 1, false, "left");
    c.update([hand(200), null], 1, false, "left");
    c.reset();
    expect(c.update([hand(300, 0.55), null], 1, false, "left").push).toBe(0);
  });
});

describe("continuous hand push/pull and cusp delivery", () => {
  it("pulls rightward in the mirrored preview without releasing after a push", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "left", 1);
    c.update(hand(200), "left", 1);
    expect(c.update(hand(300, 0.56), "left", 1).delta).toBeCloseTo(9);
    expect(c.update(hand(400, 0.52), "left", 1).delta).toBeCloseTo(-6);
    expect(c.update(hand(500, 0.54), "left", 1).delta).toBeCloseTo(3);
    expect(c.update(hand(600, 0.5, false), "left", 1).delta).toBe(0);
  });
  it.each(["radial", "femoral"] as const)(
    "delivers to Ao cusp via hand strokes on %s access",
    (access) => {
      const c = new StrokeClutch();
      let s = reducer(initialState, { type: "access", value: access });
      let time = 0;
      const tick = (x: number, pinch = true) => {
        const d = c.update(hand((time += 100), x, pinch), "left", 1).delta;
        for (const delta of splitPushDelta(d))
          s = reducer(s, { type: "move", delta });
      };
      const grasp = () => {
        tick(0.5, false);
        tick(0.5, false);
        tick(0.5);
        tick(0.5);
      };
      const push = () => {
        grasp();
        for (let i = 1; i <= 8; i++) tick(0.5 + i * 0.01);
      };
      for (let i = 0; i < 9; i++) push();
      expect(s.wire).toBe(100);
      s = reducer(s, { type: "select", instrument: "catheter" });
      c.reset();
      for (let i = 0; i < 8; i++) push();
      expect(s.catheter).toBeCloseTo(CUSP_BOTTOM_INSERTION);
      s = reducer(s, { type: "select", instrument: "wire" });
      c.reset();
      grasp();
      tick(0.54); // A push at the wire limit must not lock out the following pull.
      for (let i = 1; i <= 10; i++) tick(0.54 - i * 0.025);
      expect(distalIsFree(s)).toBe(true);
      s = reducer(s, { type: "select", instrument: "catheter" });
      c.reset();
      grasp();
      tick(0.53); // The unsupported distal curve can now move within the root.
      expect(s.catheter).toBeGreaterThanOrEqual(CUSP_BOTTOM_INSERTION);
      tick(0.5);
      expect(s.catheter).toBeLessThan(CUSP_BOTTOM_INSERTION);
      tick(0.54);
      expect(s.catheter).toBeGreaterThanOrEqual(CUSP_BOTTOM_INSERTION);
    },
  );
});
