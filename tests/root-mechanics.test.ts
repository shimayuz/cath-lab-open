import { describe, it, expect } from "vitest";
import {
  initialState,
  AORTIC_AXIS,
  cuspBottom,
  OSTIA,
  reducer,
  desiredRotation,
  dropRotation,
  wrapAngle,
  catheterPose,
  isEngaged,
  canInject,
  engagement,
} from "../src/simulator/model";
import type {
  SimulationState,
  Coronary,
  Catheter,
  Access,
} from "../src/simulator/model";
import { tick } from "./helpers";
function aimed(
  side: Coronary = "LCA",
  catheterType: Catheter = "JL",
  access: Access = "radial",
): SimulationState {
  const s = {
    ...initialState,
    catheter: 92,
    wire: 0,
    target: side,
    catheterType,
    access,
    active: "catheter" as const,
  };
  return { ...s, rotation: dropRotation(s) };
}
function rotateTo(s: SimulationState, goal: number) {
  for (let i = 0; i < 20; i++) {
    const d = wrapAngle(goal - s.rotation);
    if (Math.abs(d) < 0.01) break;
    s = reducer(s, { type: "rotate", delta: d });
  }
  return s;
}
function engage(s = aimed()) {
  s = reducer(s, { type: "move", delta: 4 });
  s = rotateTo(s, desiredRotation(s));
  return tick(reducer(s, { type: "move", delta: -3 }), 0.7);
}
describe("sinus seating and recoil informed by lecture diagrams", () => {
  for (const access of ["radial", "femoral"] as const)
    for (const [cat, side] of [
      ["JL", "LCA"],
      ["JR", "RCA"],
      ["AL", "LCA"],
      ["AL", "RCA"],
    ] as const) {
      it(`${access} ${cat} ${side}: drop, rotate and pull seats the catheter`, () => {
        let s = aimed(side, cat, access);
        const above = catheterPose(s).tip;
        s = reducer(s, { type: "move", delta: 4 });
        expect(s.root?.side).toBe(side);
        expect(isEngaged(s)).toBe(false);
        expect(catheterPose(s).tip[1]).toBeLessThan(above[1]);
        s = rotateTo(s, desiredRotation(s));
        const down = catheterPose(s).tip;
        s = reducer(s, { type: "move", delta: -3 });
        expect(catheterPose(s).tip[1]).toBeGreaterThan(down[1]);
        expect(s.root?.seatAt).toBe(93);
        expect(isEngaged(s)).toBe(true);
        expect(canInject(tick(s, 0.7))).toBe(true);
      });
    }
  it("a matching coordinate without sinus support cannot engage", () => {
    let s = aimed();
    s = { ...s, catheter: 93, rotation: desiredRotation(s) };
    expect(isEngaged(s)).toBe(false);
    expect(canInject(tick(s, 3))).toBe(false);
  });
  it("a tip resting in a sinus must be lifted before crossing to the other sinus", () => {
    let s = reducer(aimed(), { type: "move", delta: 4 });
    s = rotateTo(s, s.rotation + 110);
    expect(s.root?.side).toBe("LCA");
    expect(catheterPose(s).blockedByCusp).toBe(true);
    s = reducer(s, { type: "move", delta: -6 });
    expect(s.root).toBeNull();
    expect(catheterPose(s).blockedByCusp).toBe(false);
  });
  it("changing the target does not move a seated catheter or change its support", () => {
    const s = engage(),
      next = reducer(s, { type: "target", value: "RCA" });
    expect(catheterPose(next)).toEqual(catheterPose(s));
    expect(engagement(next).support).toBe(engagement(s).support);
  });
  it("pulling back or reintroducing the wire releases the seat", () => {
    const s = engage();
    expect(reducer(s, { type: "move", delta: -3 }).root).toBeNull();
    let wire = s;
    for (let i = 0; i < 9; i++)
      wire = reducer(wire, { type: "move", delta: 10, instrument: "wire" });
    expect(wire.root).toBeNull();
  });
  it("adequate support retains the catheter during the normal bolus", () => {
    const s = tick(reducer(engage(), { type: "inject" }), 3);
    expect(s.kickbackCount).toBe(0);
    expect(s.imaged).toEqual(["LCA"]);
    expect(s.contrastTotal).toBeCloseTo(6);
  });
  it("high injection load causes recoil, stops at the event time and preserves delivered contrast", () => {
    const s = reducer(
      { ...engage(), contrastVolume: 12, contrastDuration: 1 },
      { type: "inject" },
    );
    const coarse = reducer(s, { type: "tick", dt: 3 }),
      fine = tick(s, 3);
    for (const out of [coarse, fine]) {
      expect(out.kickbackCount).toBe(1);
      expect(out.root).toBeNull();
      expect(out.catheter).toBe(90);
      expect(out.bolus?.stopped).toBe(true);
      expect(out.contrastTotal).toBeCloseTo(4.2);
      expect(out.imaged).toEqual([]);
      expect(out.message.key).toContain("押し返し");
    }
  });
});

describe("Judkins trajectory in the measured aortic-root frame", () => {
  const axial = (v: number[]) =>
    v.reduce((sum, x, i) => sum + x * AORTIC_AXIS[i], 0);
  for (const [side, cat] of [
    ["LCA", "JL"],
    ["RCA", "JR"],
  ] as const) {
    it(`${cat}: rotation at the bottom cannot lift the tip along the aorta`, () => {
      let s = reducer(aimed(side, cat), { type: "move", delta: 4 });
      expect(catheterPose(s).tip).toEqual(cuspBottom(side));
      const bottom = axial(catheterPose(s).tip);
      s = rotateTo(s, desiredRotation(s));
      expect(axial(catheterPose(s).tip)).toBeCloseTo(bottom, 10);
      expect(isEngaged(s)).toBe(false);
    });
    it(`${cat}: pull plus correctly signed turn rises continuously from bottom to ostium`, () => {
      let s = reducer(aimed(side, cat), { type: "move", delta: 4 });
      let previous = catheterPose(s).tip;
      for (let i = 0; i < 30 && !isEngaged(s); i++) {
        s = reducer(s, {
          type: "rotate",
          delta: ((side === "LCA" ? -1 : 1) * 16) / 30,
        });
        s = reducer(s, { type: "move", delta: -0.1 });
        const tip = catheterPose(s).tip;
        expect(axial(tip)).toBeGreaterThan(axial(previous) - 1e-7);
        expect(Math.hypot(...tip.map((x, j) => x - previous[j]))).toBeLessThan(
          0.04,
        );
        previous = tip;
      }
      expect(isEngaged(s)).toBe(true);
      expect(
        Math.hypot(...previous.map((x, i) => x - OSTIA[side][i])),
      ).toBeLessThan(0.01);
    });
    it(`${cat}: turning and lifting can seat without reaching the bottom`, () => {
      let s = reducer(aimed(side, cat), { type: "move", delta: 2 });
      s = rotateTo(s, desiredRotation(s));
      s = reducer(s, { type: "move", delta: -1 });
      expect(s.root?.bottomAt).toBeUndefined();
      expect(isEngaged(s)).toBe(true);
    });
  }
});

it("free tip remains continuous through every side-selection boundary", () => {
  for (const catheterType of ["JL", "JR", "AL"] as const) {
    let previous = catheterPose({
      ...initialState,
      catheterType,
      catheter: 94,
      rotation: -180,
    }).tip;
    for (let rotation = -179.95; rotation <= 180; rotation += 0.05) {
      const next = catheterPose({
        ...initialState,
        catheterType,
        catheter: 94,
        rotation,
      }).tip;
      expect(Math.hypot(...next.map((x, i) => x - previous[i]))).toBeLessThan(
        0.005,
      );
      previous = next;
    }
  }
});
