import { describe, it, expect } from "vitest";
import {
  initialState,
  reducer,
  desiredRotation,
  engagement,
  canInject,
  catheterPose,
  isEngaged,
} from "../src/simulator/model";
import type { SimulationState, Coronary } from "../src/simulator/model";
import {
  contrastAt,
  contrastField,
  hemodynamics,
  pressureAt,
} from "../src/simulator/imaging";
import { catheterPoints } from "../src/simulator/anatomy";
export function tick(s: SimulationState, seconds: number) {
  for (let n = 0; n < Math.round(seconds * 20); n++)
    s = reducer(s, { type: "tick", dt: 0.05 });
  return s;
}
function seated(side: Coronary = "LCA"): SimulationState {
  const s = {
    ...initialState,
    target: side,
    catheterType: side === "LCA" ? ("JL" as const) : ("JR" as const),
    catheter: 92,
    active: "catheter" as const,
  };
  return {
    ...s,
    rotation: desiredRotation(s),
    root: { side, capturedAt: 96, seatAt: 92 },
  };
}
describe("axis, depth, pressure and support", () => {
  for (const side of ["LCA", "RCA"] as const) {
    it(`${side} requires stationary support before injection`, () => {
      let s = seated(side);
      expect(isEngaged(s)).toBe(true);
      expect(canInject(s)).toBe(false);
      s = tick(s, 0.7);
      expect(canInject(s)).toBe(true);
      s = reducer(s, { type: "rotate", delta: 1 });
      expect(canInject(s)).toBe(false);
      expect(canInject(tick(s, 0.7))).toBe(true);
    });
    it(`${side} rejects near but non-coaxial tip`, () => {
      const s = {
        ...seated(side),
        rotation: seated(side).rotation + (side === "LCA" ? 24.5 : 6),
      };
      const e = engagement(s);
      expect(e.near).toBe(true);
      expect(e.angle).toBeGreaterThan(23);
      expect(e.angle).toBeLessThan(25);
      expect(isEngaged(s)).toBe(false);
    });
    it(`${side} deep intubation damps catheter pressure and withdrawal restores it`, () => {
      const s = seated(side),
        deep = reducer(s, { type: "move", delta: 3 });
      expect(engagement(deep).deep).toBe(true);
      expect(hemodynamics(deep).damping).toBeGreaterThan(0);
      expect(canInject(tick(deep, 1))).toBe(false);
      expect(hemodynamics(deep).systolic).toBeLessThan(120);
      const back = tick(reducer(deep, { type: "move", delta: -3 }), 1);
      expect(canInject(back)).toBe(true);
      expect(hemodynamics(back).systolic).toBe(120);
    });
    it(`${side} rendered tip tangent matches evaluated heading`, () => {
      const s = seated(side),
        ps = catheterPoints(s);
      const heading = ps.at(-1)!.clone().sub(ps.at(-2)!).normalize();
      expect(
        heading.dot({
          x: catheterPose(s).heading[0],
          y: catheterPose(s).heading[1],
          z: catheterPose(s).heading[2],
        }),
      ).toBeGreaterThan(0.99);
    });
  }
  it("wall contact creates damping independently of chosen target", () => {
    const s = { ...seated(), catheter: 93, rotation: seated().rotation + 25 };
    expect(engagement(s).wallContact).toBe(true);
    expect(hemodynamics(s).damping).toBeGreaterThan(0);
    expect(hemodynamics({ ...s, target: "RCA" })).toEqual(hemodynamics(s));
  });
  it("damping narrows pulse pressure", () => {
    const normal = Array.from({ length: 500 }, (_, i) =>
        pressureAt(i / 500, 0),
      ),
      damped = Array.from({ length: 500 }, (_, i) => pressureAt(i / 500, 0.8));
    expect(Math.max(...damped) - Math.min(...damped)).toBeLessThan(
      Math.max(...normal) - Math.min(...normal),
    );
  });
});
describe("injection clock and washout", () => {
  it("counts delivered volume over time, completing only at the end", () => {
    let s = tick(seated(), 1);
    s = reducer(s, { type: "inject" });
    expect(s.imaged).toEqual([]);
    expect(s.contrastTotal).toBe(0);
    s = tick(s, 1);
    expect(s.contrastTotal).toBeCloseTo(3);
    expect(canInject(s)).toBe(false);
    s = tick(s, 1.1);
    expect(s.contrastTotal).toBeCloseTo(6);
    expect(s.imaged).toEqual(["LCA"]);
  });
  it("movement stops further injection while already delivered contrast washes out", () => {
    let s = tick(reducer(tick(seated(), 1), { type: "inject" }), 0.7);
    s = reducer(s, { type: "move", delta: 3 });
    const total = s.contrastTotal;
    expect(s.bolus?.stopped).toBe(true);
    expect(contrastAt(s.bolus, s.time, 0).opacity).toBeGreaterThan(0);
    s = tick(s, 9);
    expect(s.contrastTotal).toBe(total);
    expect(contrastAt(s.bolus, s.time, 0).opacity).toBe(0);
    expect(s.imaged).toEqual([]);
  });
  it("distal branches fill later and injection settings change opacity and duration", () => {
    const b = {
      side: "LCA" as const,
      start: 0,
      volume: 6,
      duration: 2,
      delivered: 0,
      stopped: false,
    };
    expect(contrastAt(b, 0.2, 0.6).opacity).toBe(0);
    expect(contrastAt(b, 0.5, 0).opacity).toBeGreaterThan(
      contrastAt({ ...b, volume: 2 }, 0.5, 0).opacity,
    );
    expect(
      contrastAt({ ...b, duration: 4, volume: 12 }, 3, 0).opacity,
    ).toBeGreaterThan(contrastAt(b, 3, 0).opacity);
  });
  it("changing the UI target does not redirect an in-flight bolus", () => {
    let s = reducer(tick(seated(), 1), { type: "inject" });
    s = reducer(s, { type: "target", value: "RCA" });
    s = tick(s, 1);
    expect(s.bolus?.side).toBe("LCA");
    expect(s.contrastTotal).toBeCloseTo(3);
  });
  it("reset clears volume and time", () => {
    const s = reducer(tick(reducer(tick(seated(), 1), { type: "inject" }), 1), {
      type: "reset",
    });
    expect(s.time).toBe(0);
    expect(s.contrastTotal).toBe(0);
    expect(s.bolus).toBeNull();
  });
});
describe("review regressions", () => {
  it("ignored wire rotation and lower-limit Pull do not interrupt an ongoing injection", () => {
    const s = reducer(
      { ...tick(seated(), 1), active: "wire" },
      { type: "inject" },
    );
    for (const action of [
      { type: "rotate", delta: 5 },
      { type: "move", delta: -3 },
      { type: "move", delta: NaN },
    ] as const) {
      const next = reducer(s, action);
      expect(next.bolus?.stopped).toBe(false);
      expect(next.stableFor).toBe(s.stableFor);
    }
  });
  it("re-injection retains contrast already in the vessels", () => {
    let s = tick(reducer(tick(seated(), 1), { type: "inject" }), 2.1);
    const before = contrastField(s, "LCA", 0).opacity;
    s = reducer(s, { type: "inject" });
    expect(s.bolusHistory).toHaveLength(1);
    expect(contrastField(s, "LCA", 0).opacity).toBeCloseTo(before);
  });
});
it("render stalls do not stretch injection duration", () => {
  let s = reducer(tick(seated(), 1), { type: "inject" });
  s = reducer(s, { type: "tick", dt: 3 });
  expect(s.time).toBeCloseTo(4);
  expect(s.contrastTotal).toBeCloseTo(6);
  expect(s.bolus?.stopped).toBe(true);
});
