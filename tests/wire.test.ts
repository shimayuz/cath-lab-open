import { describe, it, expect } from "vitest";
import { diagnosticWireGeometry } from "../src/simulator/wire";
import * as THREE from "three";
import {
  ROUTES,
  wirePoints,
  wireShape,
  catheterPoints,
} from "../src/simulator/anatomy";
import { initialState, reducer } from "../src/simulator/model";

describe("wire contained by a formed catheter", () => {
  for (const access of ["radial", "femoral"] as const) {
    for (const catheterType of ["JL", "JR", "AL"] as const) {
      it(`${access} ${catheterType}: covered wire follows the actual curved lumen during rotation`, () => {
        const ends: THREE.Vector3[] = [];
        for (const rotation of [-60, 0, 60]) {
          const state = {
            ...initialState,
            access,
            catheterType,
            rotation,
            catheter: 98,
            wire: 84,
          };
          const shape = wireShape(state);
          expect(shape.phase).toBe("sheathed");
          const lumen = new THREE.CatmullRomCurve3(
            catheterPoints(state),
          ).getSpacedPoints(2400);
          for (const point of shape.points) {
            const distance = Math.min(...lumen.map((p) => p.distanceTo(point)));
            expect(distance).toBeLessThan(0.012);
          }
          ends.push(shape.points.at(-1)!.clone());
        }
        // A wire ending in the long proximal shaft moves less than one in a bend.
        // The containment assertion above applies to every point in either case.
        expect(ends[0].distanceTo(ends[2])).toBeGreaterThan(0.005);
      });
    }
  }
});
describe("J-tip and feed-dependent aortic bending", () => {
  for (const access of ["radial", "femoral"] as const) {
    const path = ROUTES[access];
    it(`${access}: retains a backwards-curved terminal J, distinct from the larger loop`, () => {
      for (const amount of [20, 60, 88, 92, 96, 100]) {
        const shape = diagnosticWireGeometry(path, amount);
        const tip = shape.points.slice(shape.tipStart);
        const initial = tip[2].clone().sub(tip[0]).normalize();
        const final = tip.at(-1)!.clone().sub(tip.at(-3)!).normalize();
        expect(initial.dot(final)).toBeLessThan(-0.9);
        const jLength = tip.reduce(
          (s, p, i) => s + (i ? p.distanceTo(tip[i - 1]) : 0),
          0,
        );
        expect(jLength).toBeGreaterThan(0.12);
        expect(jLength).toBeLessThan(0.22);
      }
    });
    it(`${access}: pushing grows the inserted curve monotonically and keeps the distal bend above the basal plane`, () => {
      let previous = 0;
      const base = path.getPointAt(1);
      const up = path.getTangentAt(1).negate();
      for (let amount = 1; amount <= 100; amount += 0.25) {
        const shape = diagnosticWireGeometry(path, amount);
        expect(
          shape.points.flatMap((p) => p.toArray()).every(Number.isFinite),
        ).toBe(true);
        expect(shape.length, `length at ${amount}`).toBeGreaterThanOrEqual(
          previous - 0.003,
        );
        previous = shape.length;
        if (amount >= 88) {
          for (const p of shape.points.slice(181))
            expect(
              p.clone().sub(base).dot(up),
              `base at ${amount}`,
            ).toBeGreaterThan(0);
        }
      }
    });
    it(`${access}: keeps a continuous tip position when contact starts and loop grows`, () => {
      let previous = diagnosticWireGeometry(path, 87).points.at(-1)!;
      for (let amount = 87.05; amount <= 100; amount += 0.05) {
        const next = diagnosticWireGeometry(path, amount).points.at(-1)!;
        expect(next.distanceTo(previous), `tip jump at ${amount}`).toBeLessThan(
          0.05,
        );
        previous = next;
      }
    });
    it(`${access}: holds and reversibly unfolds on withdrawal through the actual reducer`, () => {
      let s = { ...initialState, access, wire: 88 };
      const original = wirePoints(s).map((p) => p.toArray());
      s = reducer(s, { type: "move", delta: 6 });
      s = reducer(s, { type: "move", delta: 6 });
      expect(diagnosticWireGeometry(path, s.wire).phase).toBe("loop");
      const held = wirePoints(s).map((p) => p.toArray());
      expect(
        wirePoints({
          ...s,
          message: { key: "カテーテルをPush。", values: [] },
        }).map((p) => p.toArray()),
      ).toEqual(held);
      s = reducer(s, { type: "move", delta: -6 });
      s = reducer(s, { type: "move", delta: -6 });
      expect(wirePoints(s).map((p) => p.toArray())).toEqual(original);
    });
    it(`${access}: straightens a covered tip and restores it as the wire emerges`, () => {
      expect(diagnosticWireGeometry(path, 40, 70).phase).toBe("sheathed");
      expect(diagnosticWireGeometry(path, 80, 50).phase).toBe("j-tip");
      for (const catheter of [0, 50, 80, 92, 98]) {
        const g = diagnosticWireGeometry(path, 100, catheter);
        expect(g.points.every((p) => p.toArray().every(Number.isFinite))).toBe(
          true,
        );
        const maxSegment = Math.max(
          ...g.points.slice(1).map((p, i) => p.distanceTo(g.points[i])),
        );
        expect(maxSegment).toBeLessThan(0.25);
      }
    });
  }
});
