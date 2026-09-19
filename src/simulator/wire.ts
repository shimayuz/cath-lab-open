import * as THREE from "three";

/** Generic teaching geometry, not a fitted material model for any commercial wire. */
export const WIRE_CONTACT_PERCENT = 88;
export const WIRE_J_RADIUS = 0.0525; // 1.5 mm at the source's cm -> scene scale (0.35).
export const WIRE_TAPER_LENGTH = 1.05; // Illustrative 3 cm distal flexible region.
const CLEARANCE = 0.1;
const MAX_LOOP_RADIUS = 0.3;
const smooth = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
export type WirePhase = "away" | "j-tip" | "contact" | "loop" | "sheathed";
export interface WireGeometry {
  points: THREE.Vector3[];
  tipStart: number;
  phase: WirePhase;
  loop: number;
  length: number;
}
const lengthOf = (points: THREE.Vector3[]) =>
  points.reduce((n, p, i) => n + (i ? p.distanceTo(points[i - 1]) : 0), 0);

/** Feed-dependent bending constrained to the aortic route and a basal stop plane.
 * The shaft remains supported; curvature is concentrated in the distal free span.
 * The terminal J retains its small radius while the proximal bend grows around it.
 * No time integration: holding or returning to the same feed preserves coordinates.
 */
export function diagnosticWireGeometry(
  path: THREE.CatmullRomCurve3,
  insertion: number,
  catheterInsertion = 0,
): WireGeometry {
  const amount = THREE.MathUtils.clamp(insertion, 0, 100);
  if (amount <= 0)
    return { points: [], tipStart: 0, phase: "away", loop: 0, length: 0 };
  const routeLength = path.getLength();
  const stop = routeLength - CLEARANCE;
  const supported =
    (THREE.MathUtils.clamp(catheterInsertion, 0, 98) / 100) * routeLength;
  const radius = WIRE_J_RADIUS;
  const contactFeed = stop + (Math.PI - 1) * radius;
  const feed = (amount / WIRE_CONTACT_PERCENT) * contactFeed;
  const frame = (distance: number, offset = 0) => {
    const t = THREE.MathUtils.clamp(distance / routeLength, 0, 1);
    const point = path.getPointAt(t);
    const tangent = path.getTangentAt(t);
    let normal = new THREE.Vector3().crossVectors(
      tangent,
      new THREE.Vector3(0, 0, 1),
    );
    if (normal.lengthSq() < 1e-8)
      normal = new THREE.Vector3().crossVectors(
        tangent,
        new THREE.Vector3(0, 1, 0),
      );
    return point.addScaledVector(normal.normalize(), offset);
  };
  // A covered tip is straightened by the catheter; it does not form a J through it.
  if (feed <= supported) {
    const points = Array.from({ length: 181 }, (_, i) =>
      frame((feed * i) / 180),
    );
    return {
      points,
      tipStart: points.length,
      phase: "sheathed",
      loop: 0,
      length: lengthOf(points),
    };
  }
  const available = Math.max(0, feed - supported);
  const jRadius = Math.min(radius, available / Math.PI, feed / Math.PI);
  const development = smooth(
    (amount - WIRE_CONTACT_PERCENT) / (100 - WIRE_CONTACT_PERCENT),
  );
  // The catheter limits the span which can bend independently of its shaft.
  const largeRadius =
    jRadius +
    (Math.max(jRadius, Math.min(MAX_LOOP_RADIUS, (stop - supported) * 0.72)) -
      jRadius) *
      development;
  const bendAngle = Math.PI * development;
  const returningLimb = 0.38 * development * development;
  const head: { x: number; d: number; terminal: boolean }[] = [];
  for (let i = 0; i <= 56; i++) {
    const angle = (bendAngle * i) / 56;
    head.push({
      x: largeRadius * (1 - Math.cos(angle)),
      d: largeRadius * Math.sin(angle),
      terminal: false,
    });
  }
  const bendEnd = head.at(-1)!;
  for (let i = 1; i <= 16; i++) {
    const along = (returningLimb * i) / 16;
    head.push({
      x: bendEnd.x + along * Math.sin(bendAngle),
      d: bendEnd.d + along * Math.cos(bendAngle),
      terminal: false,
    });
  }
  const jStart = head.at(-1)!;
  for (let i = 0; i <= 36; i++) {
    const angle = bendAngle + (Math.PI * i) / 36;
    head.push({
      x: jStart.x + jRadius * (Math.cos(bendAngle) - Math.cos(angle)),
      d: jStart.d + jRadius * (Math.sin(angle) - Math.sin(bendAngle)),
      terminal: true,
    });
  }
  const headLength =
    largeRadius * bendAngle + returningLimb + Math.PI * jRadius;
  const forwardMost = Math.max(...head.map((p) => p.d));
  const stem = Math.max(0, Math.min(feed - headLength, stop - forwardMost));
  const offset =
    (-(Math.min(...head.map((p) => p.x)) + Math.max(...head.map((p) => p.x))) /
      2) *
    smooth((stem - supported) / 0.15);
  const taperStart = Math.max(supported, stem - WIRE_TAPER_LENGTH);
  const points: THREE.Vector3[] = [];
  const append = (p: THREE.Vector3) => {
    if (!points.length || p.distanceToSquared(points.at(-1)!) > 1e-14)
      points.push(p);
  };
  for (let i = 0; i <= 180; i++) {
    const d = (stem * i) / 180;
    const shift = smooth((d - taperStart) / Math.max(1e-9, stem - taperStart));
    append(frame(d, offset * shift));
  }
  let tipStart = points.length;
  let terminalStarted = false;
  for (const p of head) {
    if (p.terminal && !terminalStarted) {
      tipStart = Math.max(0, points.length - 1);
      terminalStarted = true;
    }
    append(frame(stem + p.d, offset + p.x));
  }
  return {
    points,
    tipStart,
    phase:
      development > 0.015
        ? "loop"
        : amount >= WIRE_CONTACT_PERCENT
          ? "contact"
          : "j-tip",
    loop: development,
    length: lengthOf(points),
  };
}
