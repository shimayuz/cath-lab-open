import * as THREE from "three";
import { describe, it, expect } from "vitest";
import {
  CORONARIES,
  AORTA,
  coronaryTube,
  catheterPoints,
} from "../src/simulator/anatomy";
import { CATHETER_TRACES } from "../src/simulator/catheters";
import {
  type SimulationState,
  ROOT,
  AORTIC_AXIS,
  catheterPose,
  initialState,
  reducer,
  dropRotation,
  wrapAngle,
  OSTIA,
  desiredRotation,
  tipPosition,
} from "../src/simulator/model";
import vmr from "../src/simulator/vmr.json";
describe("source geometry integrity", () => {
  it("uses the 24 measured branches with positive varying radius and matched samples", () => {
    expect(CORONARIES.length).toBe(24);
    for (const b of CORONARIES) {
      expect(b.radii.length).toBe(b.points.length);
      expect(b.radii.every((r) => r > 0 && r < 0.3)).toBe(true);
      expect(new Set(b.radii).size).toBeGreaterThan(1);
    }
  });
  it("joins the measured aortic cap to the synthetic arch at the identical point", () => {
    expect(AORTA[vmr.aorta.length - 1]).toEqual(vmr.aortaCap);
  });
  it("places each engagement point at its proximal measured coronary section", () => {
    expect(OSTIA.LCA).toEqual(
      CORONARIES.find((b) => b.name === "LAD")!.points[0],
    );
    expect(OSTIA.RCA).toEqual(
      CORONARIES.find((b) => b.name === "RCA")!.points[0],
    );
  });
  it("uses the same traces for distinct catheter types and finite 3D endpoints", () => {
    expect(
      new Set(Object.values(CATHETER_TRACES).map((v) => JSON.stringify(v)))
        .size,
    ).toBe(3);
    for (const catheterType of ["JL", "JR", "AL"] as const) {
      const state = { ...initialState, catheterType, catheter: 92, wire: 0 };
      state.rotation = desiredRotation(state);
      const points = catheterPoints(state);
      expect(points.every((p) => p.toArray().every(Number.isFinite))).toBe(
        true,
      );
      points
        .at(-1)!
        .toArray()
        .forEach((v, i) => expect(v).toBeCloseTo(tipPosition(state)[i], 6));
    }
  });
  it("builds finite tapered geometry for every measured branch", () => {
    for (const branch of CORONARIES) {
      const mesh = coronaryTube(branch, "red");
      expect(
        Array.from(mesh.geometry.getAttribute("position").array).every(
          Number.isFinite,
        ),
      ).toBe(true);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  });
});

for (const [target, catheterType] of [
  ["LCA", "JL"],
  ["RCA", "JR"],
] as const) {
  it(`${catheterType}: the entire recovered curve moves continuously through drop and lift`, () => {
    let s: SimulationState = {
      ...initialState,
      target,
      catheterType,
      catheter: 92,
      wire: 0,
      active: "catheter" as const,
    };
    s.rotation = dropRotation(s);
    let previous = catheterPoints(s).slice(-140);
    for (let i = 0; i < 70; i++) {
      if (i < 40) s = reducer(s, { type: "move", delta: 0.1 });
      else {
        s = reducer(s, {
          type: "rotate",
          delta: wrapAngle(desiredRotation(s) - s.rotation) / (70 - i),
        });
        s = reducer(s, { type: "move", delta: -0.1 });
      }
      const ps = catheterPoints(s).slice(-140);
      expect(
        Math.max(...ps.map((p, j) => p.distanceTo(previous[j]))),
        `step ${i}, insertion ${s.catheter}, capture ${s.root?.capturedAt}`,
      ).toBeLessThan(0.09);
      previous = ps;
    }
  });
}

for (const [target, catheterType] of [
  ["LCA", "JL"],
  ["RCA", "JR"],
] as const) {
  it(`${catheterType}: supported proximal shaft has no local zigzag`, () => {
    let s: SimulationState = {
      ...initialState,
      target,
      catheterType,
      catheter: 92,
      wire: 0,
      active: "catheter",
    };
    s.rotation = dropRotation(s);
    for (let i = 0; i < 40; i++) s = reducer(s, { type: "move", delta: 0.1 });
    for (let i = 0; i <= 30; i++) {
      if (i) {
        s = reducer(s, {
          type: "rotate",
          delta: wrapAngle(desiredRotation(s) - s.rotation) / (31 - i),
        });
        s = reducer(s, { type: "move", delta: -0.1 });
      }
      const points = catheterPoints(s).slice(-140);
      // Leave the preformed distal hook out of the shaft smoothness bound.
      const shaftEnd = Math.floor(
        (140 * 2) / (CATHETER_TRACES[catheterType].length - 1),
      );
      const turns = points.slice(2, shaftEnd).map((p, j) => {
        const k = j + 2;
        return p
          .clone()
          .sub(points[k - 1])
          .angleTo(points[k + 1].clone().sub(p));
      });
      expect(
        Math.max(...turns),
        `lift ${i}, index ${turns.indexOf(Math.max(...turns)) + 2}`,
      ).toBeLessThan(0.15);
    }
  });
}

it("JL keeps a broad secondary curve across the root while the primary curve enters the ostium", () => {
  let s: SimulationState = {
    ...initialState,
    target: "LCA",
    catheterType: "JL",
    catheter: 92,
    wire: 0,
    active: "catheter",
  };
  s.rotation = dropRotation(s);
  for (let i = 0; i < 40; i++) s = reducer(s, { type: "move", delta: 0.1 });
  const up = new THREE.Vector3(...AORTIC_AXIS),
    root = new THREE.Vector3(...ROOT);
  for (let i = 0; i <= 30; i++) {
    if (i) {
      s = reducer(s, {
        type: "rotate",
        delta: wrapAngle(desiredRotation(s) - s.rotation) / (31 - i),
      });
      s = reducer(s, { type: "move", delta: -0.1 });
    }
    const ps = catheterPoints(s).slice(-140);
    const fromRoot = ps.at(-1)!.clone().sub(root);
    const radial = fromRoot
      .clone()
      .addScaledVector(up, -fromRoot.dot(up))
      .normalize();
    // The shaft reaches the opposite side before the secondary curve crosses
    // the root; it must not collapse into a small loop next to the tip.
    expect(ps[89].clone().sub(root).dot(radial)).toBeLessThan(-0.2);
    expect(ps[114].clone().sub(root).dot(radial)).toBeGreaterThan(0.1);
    for (const join of [89, 114]) {
      const incoming = ps[join]
        .clone()
        .sub(ps[join - 1])
        .normalize();
      const outgoing = ps[join + 1].clone().sub(ps[join]).normalize();
      expect(incoming.dot(outgoing)).toBeGreaterThan(0.98);
    }
    const heading = new THREE.Vector3(...catheterPose(s).heading);
    expect(
      ps.at(-1)!.clone().sub(ps.at(-2)!).normalize().dot(heading),
    ).toBeGreaterThan(0.99);
  }
});

it("JL rotates both curves and the terminal direction by the hand rotation around the aortic axis", () => {
  const base: SimulationState = {
    ...initialState,
    active: "catheter",
    catheterType: "JL",
    target: "LCA",
    catheter: 96,
    wire: 0,
    root: { side: "LCA", capturedAt: 96, seatAt: null },
  };
  base.rotation = dropRotation(base);
  const turned = reducer(base, { type: "rotate", delta: -16 });
  const up = new THREE.Vector3(...AORTIC_AXIS),
    root = new THREE.Vector3(...ROOT);
  const planar = (v: THREE.Vector3) =>
    v.addScaledVector(up, -v.dot(up)).normalize();
  const rotation = (a: THREE.Vector3, b: THREE.Vector3) =>
    (Math.atan2(up.dot(a.clone().cross(b)), a.dot(b)) * 180) / Math.PI;
  const pa = catheterPoints(base).slice(-140),
    pb = catheterPoints(turned).slice(-140);
  for (const k of [89, 114, 139]) {
    expect(
      rotation(
        planar(pa[k].clone().sub(root)),
        planar(pb[k].clone().sub(root)),
      ),
    ).toBeCloseTo(16, 4);
  }
  const a = new THREE.Vector3(...catheterPose(base).heading),
    b = new THREE.Vector3(...catheterPose(turned).heading);
  expect(a.dot(up)).toBeCloseTo(b.dot(up), 6);
  expect(rotation(planar(a), planar(b))).toBeCloseTo(16, 4);
});
