import { describe, it, expect } from "vitest";
import { nextDemoStep } from "../src/simulator/demo";
import {
  initialState,
  reducer,
  dropRotation,
  wrapAngle,
  isEngaged,
} from "../src/simulator/model";
import type { SimulationState } from "../src/simulator/model";
function complete(s: SimulationState) {
  for (let i = 0; i < 400; i++) {
    s = reducer(s, { type: "tick", dt: 0.145 });
    const step = nextDemoStep(s);
    for (const a of step.actions) s = reducer(s, a);
    if (step.complete) return { s, steps: i };
  }
  return { s, steps: 400 };
}
describe("demo recovers from manual states", () => {
  for (const access of ["radial", "femoral"] as const) {
    for (const [wire, catheter] of [
      [0, 0],
      [100, 98],
      [84, 82],
      [0, 85],
      [30, 13],
      [100, 92],
      [0, 98],
    ]) {
      it(`${access}, wire ${wire}, catheter ${catheter}`, () => {
        const result = complete({
          ...initialState,
          access,
          wire,
          catheter,
          rotation: 150,
        });
        expect(result.steps).toBeLessThan(400);
        expect(result.s.imaged).toEqual(["LCA", "RCA"]);
      });
    }
  }
  it("can continue after a completed side", () => {
    const result = complete({ ...initialState, imaged: ["LCA"] });
    expect(result.s.imaged).toEqual(["LCA", "RCA"]);
  });
  it("recovers from a mismatched catheter and target", () => {
    const result = complete({
      ...initialState,
      catheterType: "JR",
      target: "LCA",
    });
    expect(result.s.imaged).toEqual(["LCA", "RCA"]);
  });
  it("honors an AL shape selected before demo", () => {
    let s: SimulationState = { ...initialState, catheterType: "AL" };
    for (let i = 0; i < 200 && !s.imaged.length; i++) {
      s = reducer(s, { type: "tick", dt: 0.145 });
      for (const a of nextDemoStep(s).actions) s = reducer(s, a);
    }
    expect(s.catheterType).toBe("AL");
    expect(s.imaged).toEqual(["LCA"]);
  });
});

for (const access of ["radial", "femoral"] as const) {
  for (const phase of ["initial", "seated", "kickback"] as const) {
    it(`demo normalizes high injection load: ${access} ${phase}`, () => {
      const result = complete({
        ...initialState,
        access,
        contrastVolume: 12,
        contrastDuration: 1,
        ...(phase === "initial"
          ? {}
          : {
              wire: 0,
              catheter: phase === "seated" ? 93 : 90,
              rotation: -95,
              root:
                phase === "seated"
                  ? { side: "LCA" as const, capturedAt: 96, seatAt: 93 }
                  : null,
              kickbackCount: phase === "kickback" ? 1 : 0,
            }),
      });
      expect(result.steps).toBeLessThan(400);
      expect(result.s.imaged).toEqual(["LCA", "RCA"]);
      expect(result.s.contrastVolume).toBe(6);
      expect(result.s.contrastDuration).toBe(2);
    });
  }
}

describe("Judkins demo lifts while turning from the sinus bottom", () => {
  for (const [target, catheterType, direction] of [
    ["LCA", "JL", -1],
    ["RCA", "JR", 1],
  ] as const) {
    it(`${catheterType}: reaches bottom, then couples each rotation to a small pull`, () => {
      let s: SimulationState = {
        ...initialState,
        target,
        catheterType,
        active: "catheter",
        catheter: 92,
        wire: 0,
      };
      s.rotation = dropRotation(s);
      const lifting: { turn: number; pull: number }[] = [];
      let bottom = false;
      for (let n = 0; n < 120 && !s.root?.seatAt; n++) {
        s = reducer(s, { type: "tick", dt: 0.145 });
        const before = s;
        for (const a of nextDemoStep(s).actions) s = reducer(s, a);
        if (s.catheter >= 96) bottom = true;
        if (
          before.root &&
          before.root.seatAt == null &&
          s.catheter < before.catheter
        ) {
          expect(bottom).toBe(true);
          const turn = wrapAngle(s.rotation - before.rotation),
            pull = s.catheter - before.catheter;
          expect(Math.sign(turn)).toBe(direction);
          expect(Math.abs(turn)).toBeLessThanOrEqual(1.5);
          expect(pull).toBeGreaterThanOrEqual(-0.3);
          lifting.push({ turn, pull });
        }
      }
      expect(lifting.length).toBeGreaterThan(10);
      expect(s.root?.seatAt).not.toBeNull();
      expect(isEngaged(s)).toBe(true);
    });
  }
});
