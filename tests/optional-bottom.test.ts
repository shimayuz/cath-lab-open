import { describe, expect, it } from "vitest";
import {
  initialState,
  reducer,
  desiredRotation,
  dropRotation,
  isEngaged,
  canInject,
  catheterPose,
  hint,
  type SimulationState,
} from "../src/simulator/model";
import { tick } from "./helpers";
function supported(cat: "JL" | "JR", depth: number): SimulationState {
  const s = {
    ...initialState,
    active: "catheter" as const,
    catheterType: cat,
    target: cat === "JL" ? ("LCA" as const) : ("RCA" as const),
    catheter: 92,
    wire: 0,
  };
  s.rotation = dropRotation(s);
  return reducer(s, { type: "move", delta: depth - 92 });
}
describe("Bottom is optional for ostial engagement", () => {
  for (const cat of ["JL", "JR"] as const) {
    it.each([94, 95, 96])(
      `${cat} seats and injects after supported insertion %i`,
      (depth) => {
        let s = supported(cat, depth);
        expect(s.root?.capturedAt).toBe(depth);
        s = reducer(s, {
          type: "rotate",
          delta: desiredRotation(s) + 3 - s.rotation,
        });
        s = reducer(s, { type: "move", delta: 93.08 - depth });
        expect(isEngaged(s)).toBe(true);
        expect(s.catheter).toBeCloseTo(93.08);
        expect(s.root?.capturedAt).toBe(depth);
        expect(s.root?.bottomAt == null).toBe(depth < 96);
        expect(catheterPose(s).supportStrength).toBeGreaterThan(0);
        expect(canInject(s)).toBe(false);
        s = tick(s, 0.7);
        expect(canInject(s)).toBe(true);
        expect(canInject({ ...s, wire: 0.1 })).toBe(false);
        expect(tick(reducer(s, { type: "inject" }), 2.1).imaged).toContain(
          s.target,
        );
      },
    );
    it(`${cat} checks between-frame contact even without Bottom history`, () => {
      let s = supported(cat, 94);
      s = reducer(s, { type: "move", delta: -0.8 });
      s = reducer(s, {
        type: "rotate",
        delta: desiredRotation(s) + 4 - s.rotation,
      });
      s = reducer(s, { type: "handMotion", push: -0.7, rotation: -8 });
      expect(s.root?.bottomAt).toBeUndefined();
      expect(isEngaged(s)).toBe(true);
      expect(s.catheter).toBeCloseTo(92.5);
    });
    it(`${cat} does not direct a supported tip to the bottom as a requirement`, () => {
      expect(hint(supported(cat, 94)).key).not.toContain("底へ、もう少しPush");
    });
  }
});
