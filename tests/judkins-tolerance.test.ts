import { describe, expect, it } from "vitest";
import {
  initialState,
  reducer,
  desiredRotation,
  dropRotation,
  isEngaged,
  canInject,
  engagement,
  type SimulationState,
  type Catheter,
  type Coronary,
} from "../src/simulator/model";
import { tick } from "./helpers";
function bottom(catheterType: Catheter, target: Coronary): SimulationState {
  const s = {
    ...initialState,
    active: "catheter" as const,
    catheterType,
    target,
    catheter: 92,
    wire: 0,
  };
  s.rotation = dropRotation(s);
  return reducer(s, { type: "move", delta: 4 });
}
function lift(cat: Catheter, target: Coronary, error: number, insertion = 93) {
  let s = bottom(cat, target);
  s = reducer(s, {
    type: "rotate",
    delta: desiredRotation(s) + error - s.rotation,
  });
  return reducer(s, { type: "move", delta: insertion - s.catheter });
}
describe("small position tolerance for supported Judkins engagement", () => {
  for (const [cat, target] of [
    ["JL", "LCA"],
    ["JR", "RCA"],
  ] as const) {
    it.each([-3, 3])(
      `${cat} seats an aligned entrance with %i degrees of hand error`,
      (error) => {
        const s = lift(cat, target, error);
        expect(isEngaged(s)).toBe(true);
        expect(s.rotation).toBeCloseTo(desiredRotation(s) + error);
        expect(canInject(s)).toBe(false);
        const stable = tick(s, 0.7);
        expect(canInject(stable)).toBe(true);
        expect(tick(reducer(stable, { type: "inject" }), 2.1).imaged).toContain(
          target,
        );
      },
    );
    it(`${cat} seats slightly before the exact ostial insertion mark`, () => {
      expect(isEngaged(lift(cat, target, 0, 93.08))).toBe(true);
      expect(isEngaged(lift(cat, target, 0, 93.13))).toBe(false);
    });
    it(`${cat} still rejects distance, wrong angle, no cusp support and residual wire`, () => {
      expect(isEngaged(lift(cat, target, 4))).toBe(false);
      expect(isEngaged(lift(cat, target, 8))).toBe(false);
      const s = bottom(cat, target);
      const unsupported = {
        ...s,
        root: null,
        catheter: 93.08,
        rotation: desiredRotation(s) + 3,
      };
      expect(
        isEngaged(reducer(unsupported, { type: "move", delta: -0.08 })),
      ).toBe(false);
      const seated = tick(lift(cat, target, 3), 0.7);
      expect(canInject({ ...seated, wire: 0.01 })).toBe(false);
      const deep = reducer(seated, { type: "move", delta: 2 });
      expect(engagement(deep).deep).toBe(true);
      expect(canInject(tick(deep, 1))).toBe(false);
      const wall = reducer(seated, { type: "rotate", delta: 20 });
      expect(engagement(wall).wallContact).toBe(true);
      expect(canInject(tick(wall, 1))).toBe(false);
      expect(reducer(seated, { type: "move", delta: -6 }).root).toBeNull();
    });
  }
  it.each(["LCA", "RCA"] as const)(
    "does not extend AL capture for %s",
    (target) => {
      expect(isEngaged(lift("AL", target, 3))).toBe(false);
      expect(isEngaged(lift("AL", target, 0, 93.08))).toBe(false);
      expect(isEngaged(lift("AL", target, 0))).toBe(true);
    },
  );
  it.each([
    ["JL", "RCA"],
    ["JR", "LCA"],
  ] as const)(
    "does not enable the unsupported %s/%s pairing",
    (cat, target) => {
      expect(canInject(tick(lift(cat, target, 3), 1))).toBe(false);
    },
  );
});
