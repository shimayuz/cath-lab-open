import { describe, it, expect } from "vitest";
import { cameraPushDelta, cameraRotationDelta } from "../src/hand/control";
import {
  StrokeClutch,
  splitRotationDelta,
  splitPushDelta,
} from "../src/hand/clutch";
import type { ClassifiedHand } from "../src/hand/bimanual";
import { catheterPoints, catheterDisplayTip } from "../src/simulator/anatomy";
import {
  type SimulationState,
  initialState,
  dropRotation,
  reducer,
  rootManeuver,
} from "../src/simulator/model";
const hand = (time: number, angle = 0): ClassifiedHand => ({
  identity: "Right",
  wrist: { x: 0.25, y: 0.6, z: 0 },
  pinch: true,
  fingers: [1, 1, 1, 1, 1],
  time,
  angle,
});
describe("rotation responsiveness", () => {
  it("preserves the same signed angle at sparse and frequent updates", () => {
    const run = (angles: number[]) => {
      const c = new StrokeClutch();
      c.update(hand(100), "rotation", 1);
      c.update(hand(200), "rotation", 1);
      return angles.reduce(
        (sum, a, i) =>
          sum + c.update(hand(300 + i * 150, a), "rotation", 1).delta,
        0,
      );
    };
    expect(run([20])).toBeCloseTo(20);
    expect(run([5, 10, 15, 20])).toBeCloseTo(20);
    expect(run([-20])).toBeCloseTo(-20);
    expect(run([-5, -10, -15, -20])).toBeCloseTo(-20);
  });
  it("discards tiny pending turns on release or tracking loss", () => {
    for (const lost of [true, false]) {
      const c = new StrokeClutch();
      c.update(hand(100), "rotation", 1);
      c.update(hand(200), "rotation", 1);
      expect(c.update(hand(300, 0.2), "rotation", 1).delta).toBe(0);
      expect(
        c.update(
          lost ? null : { ...hand(400, 0.2), pinch: false },
          "rotation",
          1,
        ).delta,
      ).toBe(0);
      c.update({ ...hand(500, 10), pinch: false }, "rotation", 1);
      c.update({ ...hand(600, 10), pinch: false }, "rotation", 1);
      c.update(hand(700, 10), "rotation", 1);
      c.update(hand(800, 10), "rotation", 1);
      expect(c.update(hand(900, 10), "rotation", 1).delta).toBe(0);
      expect(c.update(hand(1000, 10.4), "rotation", 1).delta).toBeCloseTo(0.4);
    }
  });
  it("responds to a 0.4 degree turn without waiting for a larger movement", () => {
    const c = new StrokeClutch();
    c.update(hand(100), "rotation", 1);
    c.update(hand(200), "rotation", 1);
    expect(c.update(hand(300, 0.4), "rotation", 1).delta).toBeCloseTo(0.4);
  });
});
describe("withdrawal shape boundaries", () => {
  it.each(["radial", "femoral"] as const)(
    "does not snap on either side of free-tip boundary: %s",
    (access) => {
      const base = {
        ...initialState,
        access,
        wire: 0,
        active: "catheter" as const,
        catheter: 82,
      };
      base.rotation = dropRotation(base);
      const before = catheterPoints({ ...base, catheter: 82.001 }).at(-1)!;
      const after = catheterPoints({ ...base, catheter: 81.999 }).at(-1)!;
      expect(before.distanceTo(after)).toBeLessThan(0.01);
    },
  );
});

describe("camera fine control at the root", () => {
  it.each(["radial", "femoral"] as const)(
    "small pull stays in the cusp and reverses without jumping: %s",
    (access) => {
      let s: SimulationState = {
        ...initialState,
        access,
        active: "catheter" as const,
        catheter: 95,
        wire: 0,
      };
      s.rotation = dropRotation(s);
      s = reducer(s, { type: "move", delta: 1 });
      expect(rootManeuver(s)).toBe("bottom");
      const tip = catheterDisplayTip(s);
      s = reducer(s, { type: "move", delta: cameraPushDelta(s, -7.5) });
      expect(s.catheter).toBeCloseTo(95.25);
      expect(rootManeuver(s)).toBe("lifting");
      expect(catheterDisplayTip(s).distanceTo(tip)).toBeLessThan(0.3);
      s = reducer(s, { type: "move", delta: cameraPushDelta(s, 7.5) });
      expect(s.catheter).toBeCloseTo(96);
    },
  );
  it.each([0, 70, 100])(
    "is frame independent across sensitivity boundaries, wire %s",
    (wire) => {
      const move = (start: number, amount: number, steps: number) => {
        let s: SimulationState = {
          ...initialState,
          active: "catheter" as const,
          catheter: start,
          wire,
        };
        for (let i = 0; i < steps; i++) {
          const mapped = cameraPushDelta(s, amount / steps);
          for (const delta of splitPushDelta(mapped))
            s = reducer(s, { type: "move", delta });
        }
        return s.catheter;
      };
      expect(move(96, -80, 1)).toBeCloseTo(move(96, -80, 40), 8);
      // Enough deliberate Pull always permits withdrawal beyond Ao.
      expect(move(96, -140, 50)).toBeLessThan(82);
    },
  );
  it("does not slow the wire or clip a high-gain turn in the reducer", () => {
    expect(cameraPushDelta(initialState, -15)).toBe(-15);
    let s: SimulationState = { ...initialState, active: "catheter" as const };
    for (const delta of splitRotationDelta(60))
      s = reducer(s, { type: "rotate", delta });
    expect(s.rotation).toBe(60);
  });
});
describe("wire release shape transition", () => {
  it.each(["JL", "JR", "AL"] as const)(
    "renders a continuous terminal position for %s",
    (catheterType) => {
      for (const access of ["radial", "femoral"] as const) {
        const base = {
          ...initialState,
          access,
          catheterType,
          catheter: 96,
          wire: 82,
        };
        const before = catheterPoints({ ...base, wire: 82.001 }).at(-1)!;
        const after = catheterPoints({ ...base, wire: 81.999 }).at(-1)!;
        expect(before.distanceTo(after)).toBeLessThan(0.01);
        for (const catheter of [81, 82.5, 86, 90, 96]) {
          const s = { ...base, catheter, wire: 0 };
          expect(
            catheterPoints(s).at(-1)!.distanceTo(catheterDisplayTip(s)),
          ).toBeLessThan(1e-8);
        }
      }
    },
  );
});

it("keeps catheter rotation precision independent from the left-hand wire selection", () => {
  const s = { ...initialState, catheter: 96, wire: 0 };
  expect(cameraRotationDelta({ ...s, active: "wire" }, -12)).toBe(-6);
  expect(cameraRotationDelta({ ...s, active: "catheter" }, -12)).toBe(-6);
  expect(cameraPushDelta({ ...s, active: "wire" }, -12)).toBe(-12);
});
