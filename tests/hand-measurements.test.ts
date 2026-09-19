import { polyline, wirePoints } from "../src/simulator/anatomy";
import { describe, it, expect } from "vitest";
import {
  HandMeasurements,
  filterMeasurementSamples,
  summarizeMeasurements,
  measurementsCsv,
  measuredMovements,
} from "../src/hand/measurements";
import type { MeasurementInput } from "../src/hand/measurements";
import { initialState } from "../src/simulator/model";
const input = (time: number, x = 0.5, angle = 0): MeasurementInput => ({
  time,
  pushHand: { position: x, phase: "gripped" },
  rotationHand: { angle, phase: "gripped" },
  simulation: { ...initialState, active: "catheter", catheter: 96, wire: 0 },
  commandPush: 0,
  commandRotation: 0,
  detectionMs: 4,
  jev: { state: "off", latencyMs: null, result: null },
});
const settings = {
  gain: 1,
  pushAxis: "left" as const,
  swapRoles: false,
  reverse: false,
  requestedFps: 30,
};
describe("hand movement measurements", () => {
  it("measures distance, speed, acceleration and wrapped arc independently of control gain", () => {
    const m = new HandMeasurements();
    m.start(100, settings);
    m.capture(input(100, 0.5, 179));
    m.capture(input(200, 0.52, -179));
    m.capture(input(300, 0.55, -175));
    expect(m.samples[1].handPushStep).toBeCloseTo(2);
    expect(m.samples[1].handSpeed).toBeCloseTo(20);
    expect(m.samples[2].handAcceleration).toBeCloseTo(100);
    expect(m.samples[1].handRotationStep).toBeCloseTo(2);
    expect(m.samples[2].handAngularSpeed).toBeCloseTo(40);
    expect(summarizeMeasurements(m.samples).rotationArc).toBeCloseTo(6);
  });
  it("does not turn release, tracking gaps, or device changes into motion", () => {
    const m = new HandMeasurements();
    m.start(0, settings);
    m.capture(input(0));
    m.capture({
      ...input(100, 0.6, 20),
      pushHand: { position: 0.6, phase: "released" },
      rotationHand: { angle: 20, phase: "released" },
    });
    m.capture(input(200, 0.7, 30));
    expect(m.samples[2].handPushStep).toBeNull();
    m.capture(input(900, 0.71, 31));
    expect(m.samples[3].handSpeed).toBeNull();
    m.capture({
      ...input(1000, 0.72, 32),
      simulation: { ...initialState, active: "wire" },
    });
    expect(m.samples[4].handRotationStep).toBeNull();
  });
  it("does not invent force, real distance, or record before start/after stop", () => {
    const m = new HandMeasurements();
    m.capture(input(0));
    expect(m.samples).toHaveLength(0);
    m.start(0, settings);
    m.capture(input(0));
    m.stop("manual");
    m.capture(input(100));
    expect(m.samples).toHaveLength(1);
    const data = m.export();
    expect(data.units.force).toBe("not_measured");
    expect(data.units.handTranslation).toBe("image_axis_percent");
    expect(measurementsCsv(data)).toContain("hand_speed_image_percent_per_s");
    expect(measurementsCsv(data)).not.toContain("NaN");
  });
  it("records actual observed state separately from requested movement and holds at limits", () => {
    const m = new HandMeasurements();
    m.start(0, settings);
    m.capture({ ...input(0), commandPush: 1.5 });
    m.capture({ ...input(100, 0.51), commandPush: 1.5 });
    expect(m.samples[1].modelInsertion).toBe(96);
    expect(m.samples[1].commandPush).toBe(1.5);
  });
  it("has bounded recording and no mutation after exporting", () => {
    const m = new HandMeasurements();
    m.start(0, settings);
    m.capture(input(0));
    const snapshot = m.export();
    m.capture(input(100));
    expect(snapshot.samples).toHaveLength(1);
    m.capture(input(300001));
    expect(m.recording).toBe(false);
    expect(m.stopReason).toBe("limit");
  });
});

describe("per-movement accounting", () => {
  it("includes subthreshold motion before the first command", () => {
    const m = new HandMeasurements();
    m.start(0, settings);
    m.capture(input(0));
    m.capture(input(100, 0.503, 0.1));
    m.capture(input(200, 0.506, 0.2));
    m.capture({
      ...input(300, 0.512, 0.3),
      commandPush: 1.8,
      commandRotation: 0.3,
    });
    const rows = measuredMovements(m.samples);
    expect(rows.find((r) => r.axis === "rotation")!.handArc).toBeCloseTo(0.3);
    expect(rows.find((r) => r.axis === "push")!.handAmount).toBeCloseTo(1.2);
    expect(rows.find((r) => r.axis === "rotation")!.startMs).toBe(0);
  });
  it.each([100, 300])(
    "keeps continuous movement as one segment at %s ms intervals",
    (dt) => {
      const m = new HandMeasurements();
      m.start(0, settings);
      m.capture(input(0));
      for (let i = 1; i <= 4; i++)
        m.capture({ ...input(i * dt, 0.5 + i * 0.01), commandPush: 1.5 });
      expect(
        measuredMovements(m.samples).filter((r) => r.axis === "push"),
      ).toHaveLength(1);
    },
  );
  it("splits at an observed pause, not at slow sampling", () => {
    const m = new HandMeasurements();
    m.start(0, settings);
    m.capture(input(0));
    m.capture({ ...input(100, 0.51), commandPush: 1.5 });
    m.capture(input(200, 0.51));
    m.capture(input(400, 0.51));
    m.capture({ ...input(500, 0.52), commandPush: 1.5 });
    expect(
      measuredMovements(m.samples).filter((r) => r.axis === "push"),
    ).toHaveLength(2);
  });
});

it("can render the tiny positive wire remainder after a push/pull round trip", () => {
  for (const wire of [0, 1e-14, 0.001]) {
    const points = wirePoints({ ...initialState, wire });
    const mesh = polyline(points, 0.016, 0xd48b28);
    expect(mesh.geometry).toBeDefined();
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

it("records catheter rotation separately from wire push and filters axes independently", () => {
  const m = new HandMeasurements();
  m.start(100, settings);
  for (let i = 0; i < 3; i++) {
    const f = input(100 + i * 100, 0.5 + i * 0.01, -i * 4);
    m.capture({
      ...f,
      simulation: {
        ...f.simulation,
        active: "wire",
        wire: 1,
        root: { side: "LCA", capturedAt: 96, seatAt: null, bottomAt: 0 },
      },
      commandPush: -1,
      commandRotation: -2,
    });
  }
  const all = m.export();
  expect(all.samples[1].instrument).toBe("wire");
  expect(all.samples[1].rotationInstrument).toBe("catheter");
  expect(measurementsCsv(all)).toContain("rotation_instrument");
  for (const scope of ["catheter", "root"]) {
    const filtered = filterMeasurementSamples(m.samples, scope);
    expect(filtered).toHaveLength(3);
    expect(filtered[1].modelInsertion).toBe(96);
    expect(summarizeMeasurements(filtered).rotationArc).toBe(8);
    expect(filtered[1].commandPush).toBe(0);
    expect(filtered[1].handPushStep).toBeNull();
    expect(measuredMovements(filtered).map((x) => x.instrument)).toEqual([
      "catheter",
    ]);
  }
  const wire = filterMeasurementSamples(m.samples, "wire");
  expect(wire[1].commandRotation).toBe(0);
  expect(summarizeMeasurements(wire).rotationArc).toBe(0);
  expect(wire[1].modelInsertion).toBe(1);
  expect(measuredMovements(wire).map((x) => x.instrument)).toEqual(["wire"]);
});
