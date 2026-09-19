import { describe, expect, it } from "vitest";
import { fingerRollCoordinate, rotationInputHand } from "../src/hand/rotation";
import { readHandPair } from "../src/hand/bimanual";
import { StrokeClutch } from "../src/hand/clutch";
import type { Landmark } from "../src/hand/gesture";
import {
  HandMeasurements,
  measurementsCsv,
  movementsCsv,
  measuredMovements,
  summarizeMeasurements,
} from "../src/hand/measurements";
import { initialState } from "../src/simulator/model";
function palm(roll = 0): Landmark[] {
  const p = Array.from({ length: 21 }, () => ({ x: 0.25, y: 0.6, z: 0 }));
  p[9] = { x: 0.25, y: 0.52, z: 0 };
  p[4] = { x: 0.247, y: 0.56 - 0.04 * roll, z: 0 };
  p[8] = { x: 0.25, y: 0.56 + 0.04 * roll, z: 0 };
  return p;
}
describe("thumb-index roll independent of wrist tilt", () => {
  it("measures signed relative finger slip at fixed wrist and MCP", () => {
    expect(fingerRollCoordinate(palm(0.15))).toBeCloseTo(0.15);
    expect(fingerRollCoordinate(palm(-0.15))).toBeCloseTo(-0.15);
  });
  it("is invariant under whole-hand translation, scale and 3D rotation", () => {
    const transformed = palm(0.15).map((p) => ({
      x: 2 * (p.z + 0.4),
      y: 2 * (-p.x + 0.2),
      z: 2 * (-p.y + 0.1),
    }));
    expect(fingerRollCoordinate(transformed)).toBeCloseTo(0.15);
    expect(
      fingerRollCoordinate(palm(0).map((p) => ({ x: -p.y, y: p.x, z: p.z }))),
    ).toBeCloseTo(0);
  });
  it("rejects missing, degenerate, nonfinite and implausible world landmarks", () => {
    expect(fingerRollCoordinate()).toBeNull();
    const p = palm();
    p[9] = { ...p[0] };
    expect(fingerRollCoordinate(p)).toBeNull();
    const q = palm();
    q[8].z = NaN;
    expect(fingerRollCoordinate(q)).toBeNull();
    expect(fingerRollCoordinate(palm(0.8))).toBeNull();
  });
  it("rolls CW and CCW through MediaPipe extraction and grip control without wrist motion", () => {
    const c = new StrokeClutch();
    let previous: ReturnType<typeof readHandPair> = null;
    const frame = (time: number, r: number, closed = true, world = true) => {
      const points = palm(r);
      if (!closed) points[8].x += 0.1;
      previous = readHandPair(
        [points],
        time,
        previous,
        [{ categoryName: "Right", score: 0.99 }],
        world ? [palm(r)] : undefined,
      );
      const input = rotationInputHand(previous?.[1] ?? null, "fingers");
      return c.update(input, "rotation", 1, true);
    };
    frame(100, 0);
    frame(200, 0);
    expect(frame(300, 0.02).delta).toBeCloseTo(-0.6);
    expect(frame(400, 0.04).delta).toBeCloseTo(-3.6);
    expect(frame(500, 0).delta).toBeGreaterThan(0);
    expect(
      (previous as ReturnType<typeof readHandPair>)?.[1]?.angle,
    ).toBeCloseTo(0);
    expect(frame(600, 0, false).delta).toBe(0);
    expect(frame(700, -0.1, false).delta).toBe(0);
    frame(800, -0.1);
    frame(900, -0.1);
    expect(frame(1000, -0.1).delta).toBe(0);
    expect(frame(1100, -0.14).delta).toBeGreaterThan(0);
    expect(frame(1200, -0.14, true, false).delta).toBe(0);
    expect(frame(1300, -0.15).phase).toBe("regrip");
  });
  it("does not drift under bounded stationary finger noise", () => {
    const c = new StrokeClutch();
    const base = {
      identity: "Right" as const,
      wrist: { x: 0.25, y: 0.6, z: 0 },
      angle: 0,
      pinch: true,
      fingers: [],
      time: 100,
      fingerRoll: 0,
    };
    c.update(rotationInputHand(base, "fingers"), "rotation", 1, true);
    c.update(
      rotationInputHand({ ...base, time: 200 }, "fingers"),
      "rotation",
      1,
      true,
    );
    for (let i = 0; i < 40; i++)
      expect(
        c.update(
          rotationInputHand(
            {
              ...base,
              time: 300 + i * 100,
              fingerRoll: (i % 2 ? 1 : -1) * 0.01,
            },
            "fingers",
          ),
          "rotation",
          1,
          true,
        ).delta,
      ).toBe(0);
  });
  it("exports finger slip in palm percentages, not measured degrees", () => {
    const m = new HandMeasurements();
    m.start(100, {
      gain: 1,
      pushAxis: "left",
      swapRoles: false,
      reverse: false,
      requestedFps: 30,
      rotationMode: "fingers",
    });
    for (let i = 0; i < 3; i++)
      m.capture({
        time: 100 + i * 100,
        pushHand: { position: 0.5, phase: "gripped" },
        rotationHand: {
          angle: i * 2,
          fingerRoll: i * 0.02,
          wristAngle: 0,
          phase: "gripped",
        },
        simulation: initialState,
        commandPush: 0,
        commandRotation: i ? -1.8 : 0,
        detectionMs: 0,
        jev: { state: "off", result: null, latencyMs: null },
      });
    const data = m.export();
    expect(data.schema).toBe("cath-lab-hand-measurements-v2");
    expect(data.units.handRotation).toBe("palm_length_percent");
    expect(data.samples[2].fingerRoll).toBe(4);
    expect(data.samples[2].handRotationStep).toBe(2);
    expect(data.samples[2].wristAngle).toBe(0);
    expect(measuredMovements(data.samples)[0].direction).toBe(
      "counterclockwise",
    );
    expect(summarizeMeasurements(data.samples).counterclockwise).toBe(4);
    expect(summarizeMeasurements(data.samples).clockwise).toBe(0);
    expect(measurementsCsv(data)).toContain('"palm_length_percent"');
    expect(movementsCsv(data)).toContain("palm_length_percent");
  });
});

it("does not confuse closing the pinch with a large roll, including an open hand with no valid roll coordinate", () => {
  const c = new StrokeClutch();
  const base = {
    identity: "Right" as const,
    wrist: { x: 0.25, y: 0.6, z: 0 },
    angle: 0,
    pinch: false,
    fingers: [],
    time: 100,
    fingerRoll: null as number | null,
  };
  expect(
    c.update(rotationInputHand(base, "fingers"), "rotation", 1, true).phase,
  ).toBe("released");
  expect(
    c.update(
      rotationInputHand(
        { ...base, time: 200, pinch: true, fingerRoll: 0.25 },
        "fingers",
      ),
      "rotation",
      1,
      true,
    ).phase,
  ).toBe("arming");
  expect(
    c.update(
      rotationInputHand(
        { ...base, time: 300, pinch: true, fingerRoll: -0.05 },
        "fingers",
      ),
      "rotation",
      1,
      true,
    ).phase,
  ).toBe("gripped");
  expect(
    c.update(
      rotationInputHand(
        { ...base, time: 400, pinch: true, fingerRoll: -0.02 },
        "fingers",
      ),
      "rotation",
      1,
      true,
    ).delta,
  ).toBeLessThan(0);
});

it.each([
  ["Right", "fingers", false, -1],
  ["Right", "fingers", true, 1],
  ["Left", "fingers", false, 1],
  ["Left", "fingers", true, -1],
  ["Right", "wrist", false, 1],
  ["Right", "wrist", true, -1],
  ["Left", "wrist", false, 1],
  ["Left", "wrist", true, -1],
] as const)(
  "%s %s reverse=%s keeps control and recorded direction consistent",
  (identity, mode, reverse, expectedSign) => {
    const m = new HandMeasurements();
    const c = new StrokeClutch();
    m.start(0, {
      gain: 1,
      pushAxis: "left",
      swapRoles: identity === "Left",
      reverse,
      requestedFps: 30,
      rotationMode: mode,
    });
    let command = 0;
    for (let i = 0; i < 4; i++) {
      const raw = Math.max(0, i - 1) * 0.04;
      const hand = {
        identity,
        wrist: { x: 0.25, y: 0.6, z: 0 },
        angle: raw * 180,
        fingerRoll: raw,
        pinch: true,
        fingers: [],
        time: 100 + i * 100,
      };
      command =
        c.update(rotationInputHand(hand, mode), "rotation", 1, true).delta *
        (reverse ? -1 : 1);
      m.capture({
        time: hand.time,
        pushHand: { position: 0.5, phase: "gripped" },
        rotationHand: {
          angle: raw * (mode === "fingers" ? 100 : 180),
          phase: "gripped",
          fingerRoll: raw,
          wristAngle: hand.angle,
        },
        simulation: initialState,
        commandPush: 0,
        commandRotation: command,
        detectionMs: 0,
        jev: { state: "off", result: null, latencyMs: null },
      });
    }
    expect(Math.sign(command)).toBe(expectedSign);
    expect(m.samples.at(-1)!.rotationDirectionSign).toBe(expectedSign);
    expect(m.samples.at(-1)!.handRotationStep).toBeGreaterThan(0);
    const direction = expectedSign > 0 ? "clockwise" : "counterclockwise";
    expect(
      measuredMovements(m.samples).every((s) => s.direction === direction),
    ).toBe(true);
    expect(summarizeMeasurements(m.samples)[direction]).toBeGreaterThan(0);
    expect(measurementsCsv(m.export())).toContain('"rotation_direction_sign"');
  },
);

it("does not change finger control direction when the image is mirrored", () => {
  const base = {
    identity: "Right" as const,
    wrist: palm()[0],
    angle: 0,
    fingerRoll: fingerRollCoordinate(palm(0.1)),
    pinch: true,
    fingers: [],
    time: 100,
  };
  const mirrored = palm(0.1).map((p) => ({ ...p, x: -p.x }));
  expect(rotationInputHand(base, "fingers")!.angle).toBeLessThan(0);
  expect(
    rotationInputHand(
      { ...base, fingerRoll: fingerRollCoordinate(mirrored) },
      "fingers",
    )!.angle,
  ).toBeCloseTo(rotationInputHand(base, "fingers")!.angle);
});
