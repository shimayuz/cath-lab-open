import { describe, expect, it } from "vitest";
import {
  initialState,
  reducer,
  desiredRotation,
  dropRotation,
  isEngaged,
  canInject,
  wireInsertionLabel,
  type SimulationState,
} from "../src/simulator/model";
import { tick } from "./helpers";

function cusp(catheterType: "JL" | "JR"): SimulationState {
  const s: SimulationState = {
    ...initialState,
    active: "catheter",
    catheterType,
    target: catheterType === "JL" ? "LCA" : "RCA",
    catheter: 92,
    wire: 0,
  };
  s.rotation = dropRotation(s);
  return reducer(s, { type: "move", delta: 4 });
}
describe("continuous ostial contact between camera frames", () => {
  it.each(["JL", "JR"] as const)(
    "%s captures a crossed entrance without a sample at exactly 93",
    (catheterType) => {
      let s = cusp(catheterType);
      s = reducer(s, {
        type: "rotate",
        delta: desiredRotation(s) + 1.5 - s.rotation,
      });
      s = reducer(s, { type: "move", delta: -2.87 });
      expect(isEngaged(s)).toBe(false);
      s = reducer(s, { type: "move", delta: -0.4 });
      expect(s.catheter).toBeCloseTo(92.73);
      expect(isEngaged(s)).toBe(true);
      expect(canInject(tick(s, 0.7))).toBe(true);
    },
  );
  it.each(["JL", "JR"] as const)(
    "%s does not capture a misaligned, unsupported or over-withdrawn tip",
    (catheterType) => {
      const s = cusp(catheterType);
      expect(isEngaged(reducer(s, { type: "move", delta: -3.2 }))).toBe(false);
      const aligned = { ...s, rotation: desiredRotation(s) };
      expect(reducer(aligned, { type: "move", delta: -6 }).root).toBeNull();
      expect(
        isEngaged(
          reducer(
            { ...aligned, root: null, catheter: 93.1 },
            { type: "move", delta: -0.3 },
          ),
        ),
      ).toBe(false);
    },
  );
  it("a complete fractional wire withdrawal reaches exactly zero", () => {
    let s = { ...initialState, wire: 0.7 };
    for (let i = 0; i < 7; i++) s = reducer(s, { type: "move", delta: -0.1 });
    expect(s.wire).toBe(0);
  });
});

import { BimanualClutch, StrokeClutch } from "../src/hand/clutch";
import { cameraPushDelta, cameraRotationDelta } from "../src/hand/control";
import type { ClassifiedHand } from "../src/hand/bimanual";
const hand = (
  time: number,
  x: number,
  angle: number,
  identity: "Left" | "Right",
  pinch = true,
): ClassifiedHand => ({
  time,
  wrist: { x, y: 0.6, z: 0 },
  angle,
  identity,
  pinch,
  fingers: [1, 1, 1, 1, 1],
});

describe("precise camera control through Engage and injection", () => {
  for (const catheterType of ["JL", "JR"] as const)
    for (const access of ["radial", "femoral"] as const)
      it.each([33, 100, 600])(
        `${access} ${catheterType}: paired hand control at %i ms with bounded hold noise`,
        (interval) => {
          let s = { ...cusp(catheterType), access };
          const c = new BimanualClutch();
          let time = 0;
          const frame = (x: number, angle: number, pinch = true) => {
            const d = c.update(
              [
                hand((time += interval), x, 0, "Left", pinch),
                hand(time, 0.2, angle, "Right", pinch),
              ],
              1,
              false,
              "left",
              true,
            );
            s = reducer(s, {
              type: "handMotion",
              push: cameraPushDelta(s, d.push),
              rotation: cameraRotationDelta(s, d.rotation),
            });
            s = reducer(s, { type: "tick", dt: interval / 1000 });
            return d;
          };
          for (let i = 0; i < 5; i++) frame(0.7, 0);
          const direction = catheterType === "JL" ? -1 : 1;
          // Rotate and lift together, then cross the entrance between two frames.
          for (let i = 1; i <= 10; i++)
            frame(0.7 - 0.019 * i, direction * 3.3 * i);
          frame(0.7 - 0.23, direction * 33);
          expect(isEngaged(s)).toBe(true);
          expect(s.catheter).toBeCloseTo(92.595);
          for (let i = 0; i < 50; i++)
            frame(
              0.47 + (i % 2 ? 0.002 : -0.002),
              direction * 33 + (i % 2 ? 0.5 : -0.5),
            );
          expect(isEngaged(s)).toBe(true);
          expect(canInject(s)).toBe(true);
          s = reducer(s, { type: "inject" });
          for (let i = 0; i < Math.ceil(3500 / interval); i++)
            frame(
              0.47 + (i % 2 ? 0.002 : -0.002),
              direction * 33 + (i % 2 ? 0.5 : -0.5),
            );
          expect(s.imaged).toContain(s.target);
          const held = s.catheter;
          frame(0.47, direction * 33, false);
          frame(0.48, direction * 40, false);
          expect(s.catheter).toBe(held);
        },
      );
  it("fine push starts gradually and slow turns accumulate without a threshold-sized jump", () => {
    for (const axis of ["left", "rotation"] as const) {
      const c = new StrokeClutch();
      c.update(hand(100, 0.7, 0, "Left"), axis, 1, true);
      c.update(hand(200, 0.7, 0, "Left"), axis, 1, true);
      const deltas = Array.from(
        { length: 12 },
        (_, i) =>
          c.update(
            hand(300 + i * 100, 0.7 + (i + 1) * 0.0004, (i + 1) * 0.1, "Left"),
            axis,
            1,
            true,
          ).delta,
      );
      expect(Math.max(...deltas)).toBeLessThan(axis === "left" ? 0.061 : 0.101);
      expect(deltas.reduce((a, b) => a + b, 0)).toBeCloseTo(
        axis === "left" ? 0.27 : 0.4,
      );
    }
  });
  it.each(["JL", "JR"] as const)(
    "%s detects rotation across the entrance but retains the final commanded angle",
    (catheterType) => {
      let s = { ...cusp(catheterType), catheter: 93 };
      s.rotation = desiredRotation(s) + 3;
      s = reducer(s, { type: "rotate", delta: -5.8 });
      expect(s.rotation).toBeCloseTo(desiredRotation(s) - 2.8);
      expect(isEngaged(s)).toBe(true);
      s = reducer(s, { type: "rotate", delta: 18 });
      expect(isEngaged(s)).toBe(false);
    },
  );
});

it.each(["JL", "JR"] as const)(
  "%s captures a simultaneous diagonal crossing that sequential axes miss",
  (catheterType) => {
    // Stay outside the widened Judkins window on either separate-axis path.
    const s = { ...cusp(catheterType), catheter: 93.2 };
    s.rotation = desiredRotation(s) + 4;
    const staircase = reducer(reducer(s, { type: "move", delta: -0.7 }), {
      type: "rotate",
      delta: -8,
    });
    expect(isEngaged(staircase)).toBe(false);
    const together = reducer(s, {
      type: "handMotion",
      push: -0.7,
      rotation: -8,
    });
    expect(isEngaged(together)).toBe(true);
    expect(together.catheter).toBeCloseTo(92.5);
    expect(together.rotation).toBeCloseTo(desiredRotation(s) - 4);
  },
);
it("atomic camera commands preserve limits, complete travel, and injection stop semantics", () => {
  let wire = reducer(initialState, {
    type: "handMotion",
    push: 60,
    rotation: 80,
  });
  expect(wire.wire).toBe(60);
  expect(wire.rotation).toBe(0);
  expect(reducer(wire, { type: "handMotion", push: NaN, rotation: 0 })).toBe(
    wire,
  );
  let s = cusp("JL");
  s = reducer(s, { type: "handMotion", push: -3, rotation: -16 });
  s = tick(s, 0.7);
  s = reducer(s, { type: "inject" });
  expect(s.bolus?.stopped).toBe(false);
  expect(reducer(s, { type: "handMotion", push: 0, rotation: 0 })).toBe(s);
  expect(
    reducer(s, { type: "handMotion", push: 0.02, rotation: 0.1 }).bolus
      ?.stopped,
  ).toBe(true);
});

describe("explicit wire withdrawal before injection", () => {
  it("never displays a remaining wire as zero", () => {
    expect(wireInsertionLabel(0)).toBe("0.0");
    expect(wireInsertionLabel(0.01)).toBe("<0.1");
    expect(wireInsertionLabel(0.49)).toBe("0.5");
  });
  it.each(["JL", "JR"] as const)(
    "%s removes a hidden residual wire without losing Engage",
    (cat) => {
      let s = cusp(cat);
      s = reducer(s, {
        type: "rotate",
        delta: desiredRotation(s) - s.rotation,
      });
      s = reducer(s, { type: "move", delta: -3 });
      s = tick({ ...s, wire: 0.01 }, 0.7);
      expect(isEngaged(s)).toBe(true);
      expect(canInject(s)).toBe(false);
      const next = reducer(s, { type: "withdrawWire" });
      expect(next.wire).toBe(0);
      expect(next.catheter).toBe(s.catheter);
      expect(next.rotation).toBe(s.rotation);
      expect(next.root).toEqual(s.root);
      expect(next.active).toBe(s.active);
      expect(canInject(next)).toBe(false);
      expect(canInject(tick(next, 0.7))).toBe(true);
      expect(reducer(tick(next, 0.7), { type: "inject" }).injectionId).toBe(1);
    },
  );
  it("can fully withdraw from 100 and does not invent Engage", () => {
    const s = reducer(
      { ...initialState, wire: 100, catheter: 96 },
      { type: "withdrawWire" },
    );
    expect(s.wire).toBe(0);
    expect(s.catheter).toBe(96);
    expect(canInject(tick(s, 1))).toBe(false);
    expect(reducer(s, { type: "withdrawWire" })).toBe(s);
    expect(reducer(s, { type: "move", delta: 3 }).wire).toBe(3);
  });
});

it("right-hand catheter turns still apply after wire withdrawal while the left hand targets the wire", () => {
  const s = { ...cusp("JL"), active: "wire" as const, wire: 0 };
  const turned = reducer(s, { type: "handMotion", push: -5, rotation: -12 });
  expect(turned.rotation).toBe(s.rotation - 12);
  expect(turned.catheter).toBe(s.catheter);
  expect(turned.wire).toBe(0);
  expect(turned.active).toBe("wire");
  const back = reducer(turned, { type: "handMotion", push: 5, rotation: 12 });
  expect(back.rotation).toBe(s.rotation);
  expect(back.catheter).toBe(s.catheter);
  expect(back.wire).toBe(5);
});

it.each(["JL", "JR"] as const)(
  "%s captures a rotation crossing during simultaneous wire Pull",
  (cat) => {
    const s = { ...cusp(cat), active: "wire" as const, wire: 1, catheter: 93 };
    s.rotation = desiredRotation(s) + 3;
    const next = reducer(s, { type: "handMotion", push: -0.1, rotation: -5.8 });
    expect(next.wire).toBeCloseTo(0.9);
    expect(next.catheter).toBe(93);
    expect(isEngaged(next)).toBe(true);
  },
);
it("keeps wrist rotation steady while the wire uses normal push sensitivity", () => {
  const c = new BimanualClutch();
  const frame = (time: number, x: number, angle: number) =>
    c.update(
      [hand(time, x, 0, "Left"), hand(time, 0.2, angle, "Right")],
      1,
      false,
      "left",
      false,
      true,
    );
  frame(100, 0.7, 0);
  frame(200, 0.7, 0);
  for (let i = 0; i < 10; i++) {
    const d = frame(300 + i * 100, 0.7 + (i + 1) * 0.02, i % 2 ? -0.5 : 0.5);
    expect(d.rotation).toBe(0);
    expect(d.push).toBeCloseTo(3);
  }
});
