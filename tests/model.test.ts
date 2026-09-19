import { tick } from "./helpers";
import { describe, it, expect } from "vitest";
import {
  initialState,
  reducer,
  isEngaged,
  canInject,
  desiredRotation,
  dropRotation,
  wrapAngle,
  tipPosition,
  OSTIA,
} from "../src/simulator/model";
import type {
  Access,
  Catheter,
  Coronary,
  SimulationState,
} from "../src/simulator/model";
import {
  catheterPoints,
  ROUTES,
  wirePoints,
  wireShape,
} from "../src/simulator/anatomy";
function advance(
  s: SimulationState,
  delta: number,
  times: number,
  instrument: "wire" | "catheter",
) {
  for (let i = 0; i < times; i++)
    s = reducer(s, { type: "move", delta, instrument });
  return s;
}
export function deliver(
  access: Access = "radial",
  catheterType: Catheter = "JL",
  target: Coronary = "LCA",
) {
  let s = { ...initialState, access, catheterType, target };
  s = advance(s, 10, 10, "wire");
  s = advance(s, 10, 9, "catheter");
  s = advance(s, 2, 1, "catheter");
  s = advance(s, -10, 10, "wire");
  s = reducer(s, { type: "select", instrument: "catheter" });
  for (let i = 0; i < 12; i++) {
    const delta = wrapAngle(dropRotation(s) - s.rotation);
    if (Math.abs(delta) < 0.01) break;
    s = reducer(s, { type: "rotate", delta });
  }
  s = reducer(s, { type: "move", delta: 4, instrument: "catheter" });
  for(let i=0;i<12;i++) {const delta=wrapAngle(desiredRotation(s)-s.rotation);if(Math.abs(delta)<.01)break;s=reducer(s,{type:"rotate",delta});}
  s = reducer(s, { type: "move", delta: -3, instrument: "catheter" });
  return tick(s, 0.7);
}
describe("access to CAG", () => {
  for (const access of ["radial", "femoral"] as const)
    for (const [type, target] of [
      ["JL", "LCA"],
      ["JR", "RCA"],
      ["AL", "LCA"],
      ["AL", "RCA"],
    ] as const) {
      it(`${access} / ${type} / ${target} can be delivered, engaged and imaged`, () => {
        let s = deliver(access, type, target);
        expect(isEngaged(s)).toBe(true);
        expect(canInject(s)).toBe(true);
        catheterPoints(s)
          .at(-1)!
          .toArray()
          .forEach((p, i) => expect(p).toBeCloseTo(tipPosition(s)[i], 10));
        expect(
          Math.hypot(...tipPosition(s).map((p, i) => p - OSTIA[target][i])),
        ).toBeLessThan(0.145);
        s = reducer(s, { type: "inject" });
        expect(s.imaged).toEqual([]);
        s = tick(s, 2.1);
        expect(s.imaged).toEqual([target]);
        expect(s.injectionTarget).toBe(target);
      });
    }
  it("blocks unsupported catheter advance", () => {
    expect(
      reducer(initialState, { type: "move", delta: 10, instrument: "catheter" })
        .catheter,
    ).toBe(0);
  });
  it("wire stays within its delivery range and forms a loop above the root", () => {
    const s = advance(initialState, 10, 30, "wire");
    expect(s.wire).toBe(100);
    expect(wireShape(s).phase).toBe("loop");
    const base = ROUTES.radial.getPointAt(1);
    const up = ROUTES.radial.getTangentAt(1).negate();
    expect(wirePoints(s).at(-1)!.clone().sub(base).dot(up)).toBeGreaterThan(0);
  });
  it("cannot inject with wire remaining even if the distal catheter is free", () => {
    const s = { ...deliver(), wire: 4 };
    expect(isEngaged(s)).toBe(true);
    expect(canInject(s)).toBe(false);
    expect(reducer(s, { type: "inject" }).imaged).toEqual([]);
  });
  it("wire straightens the distal shape and disengages", () => {
    const s = { ...deliver(), wire: 100 };
    expect(isEngaged(s)).toBe(false);
  });
  it("rejects mismatched catheter and ostium", () => {
    const s = deliver("radial", "JR", "LCA");
    expect(isEngaged(s)).toBe(false);
  });
  it("moving away loses engage and stops the injection target", () => {
    let s = reducer(deliver(), { type: "inject" });
    s = reducer(s, { type: "move", delta: -10, instrument: "catheter" });
    expect(isEngaged(s)).toBe(false);
    expect(s.injectionTarget).toBeNull();
  });
  it("rotating away loses engagement", () => {
    expect(isEngaged(reducer(deliver(), { type: "rotate", delta: 30 }))).toBe(
      false,
    );
  });
  it("target selection cannot move the physical tip", () => {
    const s = deliver();
    expect(tipPosition(reducer(s, { type: "target", value: "RCA" }))).toEqual(
      tipPosition(s),
    );
  });
  it("catheter exchange resets insertion and preserves completed angiograms", () => {
    let s = reducer(deliver(), { type: "inject" });
    s = tick(s, 2.1);
    s = reducer(s, { type: "catheter", value: "JR" });
    expect([s.wire, s.catheter, s.rotation]).toEqual([0, 0, 0]);
    expect(s.imaged).toEqual(["LCA"]);
  });
  it("access change starts a fresh session", () => {
    const s = reducer(reducer(deliver(), { type: "inject" }), {
      type: "access",
      value: "femoral",
    });
    expect(s.access).toBe("femoral");
    expect(s.imaged).toEqual([]);
    expect(s.wire).toBe(0);
  });
  it("no negative position or invalid numeric input", () => {
    expect(advance(initialState, -10, 100, "wire").wire).toBe(0);
    expect(reducer(initialState, { type: "move", delta: NaN })).toBe(
      initialState,
    );
    expect(reducer(initialState, { type: "rotate", delta: Infinity })).toBe(
      initialState,
    );
  });
  it("does not count the same side twice", () => {
    let s = reducer(deliver(), { type: "inject" });
    s = tick(s, 2.1);
    s = reducer(s, { type: "inject" });
    s = tick(s, 2.1);
    expect(s.imaged).toEqual(["LCA"]);
    expect(s.injectionId).toBe(2);
  });
});
