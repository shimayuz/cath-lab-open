import vmr from "./vmr.json";
import { diagnosticWireGeometry } from "./wire";
import { CATHETER_TRACES } from "./catheters";
import * as THREE from "three";
import {
  ROOT,
  AORTIC_AXIS,
  CUSP_FLOOR,
  clamp,
  tipPosition,
  catheterPose,
} from "./model";
import type { Access, Coronary, SimulationState, Vec3 } from "./model";
export const curve = (points: Vec3[]) =>
  new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)),
    false,
    "centripetal",
  );
export const AORTA: Vec3[] = [
  ...vmr.aorta.map((p) => p as Vec3),
  [-1.0, 3.7, 0.05],
  [0.35, 4.25, -1.0],
  [1.2, 3.85, -1.6],
  [1.45, 2.4, -1.9],
  [1.3, 0.5, -2.6],
  [1.0, -2.5, -2.2],
  [0.6, -5.5, -1.4],
];
const FEMORAL: Vec3[] = [
  [-1.55, -8, 0],
  [-1.2, -6.7, -0.2],
  [0.1, -5.9, -0.5],
  ...AORTA.slice().reverse(),
];
const RADIAL: Vec3[] = [
  [-4.7, -2.8, 0.3],
  [-4.35, -1.1, 0.2],
  [-3.8, 0.7, 0],
  [-3.2, 2.75, -0.2],
  [-2.7, 3.85, -0.3],
  [-1.5, 4, -0.3],
  [-1.35, 3.6, 0.25],
  ...vmr.aorta
    .slice()
    .reverse()
    .map((p) => p as Vec3),
];
export const ROUTES = { radial: curve(RADIAL), femoral: curve(FEMORAL) };
export const ACCESS_POINTS: Record<Access, Vec3> = {
  radial: RADIAL[0],
  femoral: FEMORAL[0],
};
export const ARTERIAL_BRANCHES: { points: Vec3[]; radius: number }[] = [
  { points: RADIAL.slice(0, 8), radius: 0.1 },
  {
    points: [
      [-1.35, 3.6, 0.25],
      [-0.8, 5.15, -0.2],
    ],
    radius: 0.15,
  },
  {
    points: [
      [0.35, 4.25, -1],
      [0.15, 4.5, -0.4],
      [0.25, 5.2, -0.3],
    ],
    radius: 0.14,
  },
  {
    points: [
      [0.75, 4.16, -1.25],
      [1.2, 4, -0.6],
      [2.7, 3.8, -0.3],
      [3.2, 2.5, -0.2],
      [3.7, 0.7, 0],
      [4.3, -2.8, 0.2],
    ],
    radius: 0.1,
  },
  {
    points: [
      [0.6, -5.5, -1.4],
      [0.1, -5.9, -0.5],
      [-1.2, -6.7, -0.2],
      [-1.55, -8, 0],
    ],
    radius: 0.16,
  },
  {
    points: [
      [0.6, -5.5, -1.4],
      [1.3, -6, -0.5],
      [1.9, -6.8, -0.2],
      [2.05, -8, 0],
    ],
    radius: 0.16,
  },
];
export interface CoronaryBranch {
  name: string;
  side: Coronary;
  points: Vec3[];
  radius: number;
  delay: number;
  radii: number[];
}
export const CORONARIES: CoronaryBranch[] = vmr.branches.map((b) => ({
  ...b,
  side: b.side as Coronary,
  points: b.points.map((p) => p as Vec3),
}));
let cachedWireKey = "";
let cachedWire: ReturnType<typeof diagnosticWireGeometry>;
export function wireShape(s: SimulationState) {
  const key = `${s.access}:${s.wire}:${s.catheter}:${s.catheterType}:${s.rotation}`;
  if (key !== cachedWireKey) {
    const route = ROUTES[s.access];
    cachedWire = diagnosticWireGeometry(route, s.wire, s.catheter);
    if (cachedWire.phase === "sheathed" && s.catheter > 0) {
      // Use the exact curve rendered for the catheter, including recovered shape/rotation.
      const catheter = new THREE.CatmullRomCurve3(catheterPoints(s));
      const coveredFraction = Math.min(
        1,
        cachedWire.length / ((route.getLength() * s.catheter) / 100),
      );
      const points = Array.from({ length: 181 }, (_, i) =>
        catheter.getPointAt((coveredFraction * i) / 180),
      );
      cachedWire = {
        ...cachedWire,
        points,
        tipStart: points.length,
        length: points.reduce(
          (sum, p, i) => sum + (i ? p.distanceTo(points[i - 1]) : 0),
          0,
        ),
      };
    }
    cachedWireKey = key;
  }
  return cachedWire;
}
export function wirePoints(s: SimulationState) {
  return wireShape(s).points;
}
function formationWeight(s: SimulationState): number {
  const smooth = (v: number) => {
    const t = clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
  };
  return smooth((s.catheter - 82) / 8) * smooth((s.catheter - s.wire) / 14);
}
export function catheterDisplayTip(s: SimulationState): THREE.Vector3 {
  return ROUTES[s.access]
    .getPointAt(s.catheter / 100)
    .lerp(new THREE.Vector3(...tipPosition(s)), formationWeight(s));
}
export function catheterPoints(s: SimulationState): THREE.Vector3[] {
  const path = ROUTES[s.access];
  const weight = formationWeight(s);
  if (weight === 0)
    return Array.from({ length: 100 }, (_, i) =>
      path.getPointAt((s.catheter / 100) * (i / 99)),
    );
  const formed = formedCatheterPoints(s);
  if (weight === 1) return formed;
  // Match points by distance along each shaft, so recovering the curve has no
  // instantaneous switch when the wire clears the tip or the catheter leaves Ao.
  const lengths = [0];
  for (let i = 1; i < formed.length; i++)
    lengths.push(lengths[i - 1] + formed[i].distanceTo(formed[i - 1]));
  const total = lengths.at(-1)!;
  return formed.map((point, i) =>
    path
      .getPointAt(((s.catheter / 100) * lengths[i]) / total)
      .lerp(point, weight),
  );
}
function formedCatheterPoints(s: SimulationState): THREE.Vector3[] {
  const path = ROUTES[s.access];
  const pose = catheterPose(s);
  const end = tipPosition(s),
    terminalPoint = new THREE.Vector3(...end);
  const up = new THREE.Vector3(...AORTIC_AXIS),
    root = new THREE.Vector3(...ROOT);
  const height = terminalPoint.clone().sub(root).dot(up);
  const center = root.clone().addScaledVector(up, height);
  const radialDirection = terminalPoint.clone().sub(center);
  const reach = radialDirection.length();
  radialDirection.normalize();
  const trace = CATHETER_TRACES[s.catheterType],
    first = trace[0],
    last = trace.at(-1)!;
  const goalHeight =
    s.catheterType === "JL" ? Math.max(2.2, height + 1.1) : height + 1.55;
  let proximal = new THREE.Vector3(...vmr.aorta.at(-1)!);
  for (let i = 1; i < vmr.aorta.length; i++) {
    const a = new THREE.Vector3(...vmr.aorta[i - 1]),
      b = new THREE.Vector3(...vmr.aorta[i]);
    const ha = a.clone().sub(root).dot(up),
      hb = b.clone().sub(root).dot(up);
    if (goalHeight <= hb) {
      proximal = a.lerp(
        b,
        clamp((goalHeight - ha) / Math.max(1e-9, hb - ha), 0, 1),
      );
      break;
    }
  }
  if (s.catheterType === "JL") {
    // The lecture's paired projections show one long shaft, a broad secondary
    // curve across the root, then a short primary curve into the left ostium.
    // Rotate the whole distal frame with the tip, instead of folding a traced
    // thumbnail onto the endpoint or pulling individual points to a support.
    const samples = path.getSpacedPoints(240);
    let cut = 1,
      best = Infinity;
    samples.forEach((p, i) => {
      const d = p.distanceTo(proximal);
      if (d < best) {
        best = d;
        cut = i;
      }
    });
    const shaft = samples.slice(0, Math.max(2, cut + 1));
    const start = shaft.at(-1)!;
    const tangent = start.clone().sub(shaft.at(-2)!).normalize();
    const floor = Math.max(CUSP_FLOOR, height - 0.16);
    const shoulder = root
      .clone()
      .addScaledVector(radialDirection, -Math.min(0.42, reach * 0.8))
      .addScaledVector(up, floor + 0.32);
    const crossRoot = root
      .clone()
      .addScaledVector(radialDirection, Math.max(0.08, reach - 0.18))
      .addScaledVector(up, floor);
    const span = Math.max(0.2, shoulder.distanceTo(crossRoot));
    const shaftLength = start.distanceTo(shoulder);
    const heading = new THREE.Vector3(...pose.heading);
    const terminalHandle =
      0.12 * clamp((height - CUSP_FLOOR + 0.05) / 0.15, 0.25, 1);
    const shaftCurve = new THREE.CubicBezierCurve3(
      start,
      start.clone().addScaledVector(tangent, shaftLength * 0.33),
      shoulder.clone().addScaledVector(up, shaftLength * 0.33),
      shoulder,
    );
    const secondary = new THREE.CubicBezierCurve3(
      shoulder,
      shoulder.clone().addScaledVector(up, -0.24),
      crossRoot.clone().addScaledVector(radialDirection, -span * 0.3),
      crossRoot,
    );
    const primary = new THREE.CubicBezierCurve3(
      crossRoot,
      crossRoot.clone().addScaledVector(radialDirection, 0.1),
      terminalPoint.clone().addScaledVector(heading, -terminalHandle),
      terminalPoint,
    );
    return [
      ...shaft,
      ...shaftCurve.getPoints(90).slice(1),
      ...secondary.getPoints(25).slice(1),
      ...primary.getPoints(25).slice(1),
    ];
  }
  const shape = trace.map(([u, v]) => {
    const t = (u - first[0]) / (last[0] - first[0]);
    const bend = (v - first[1] - (last[1] - first[1]) * t) * 0.016;
    return proximal
      .clone()
      .lerp(center, t)
      .addScaledVector(radialDirection, reach * t - bend);
  });
  // Keep the shaft/preformed curve coherent. Support is a state indicator;
  // dragging individual shaft vertices to it creates nonphysical zigzags.
  // Keep the recovered curve inside a root-sized geometric envelope. This is a
  // shape constraint, not a simulation of wall contact, force or leaflet anatomy.
  const constrain = (point: THREE.Vector3) => {
    let along = point.clone().sub(root).dot(up);
    if (along < CUSP_FLOOR) {
      point.addScaledVector(up, CUSP_FLOOR - along);
      along = CUSP_FLOOR;
    }
    if (along < height + 0.55) {
      const axisPoint = root.clone().addScaledVector(up, along),
        radial = point.clone().sub(axisPoint);
      const maxRadius =
        Math.max(reach, 0.42) *
        (0.9 +
          0.1 *
            clamp(
              (along - CUSP_FLOOR) / Math.max(0.1, height - CUSP_FLOOR),
              0,
              1,
            ));
      if (radial.length() > maxRadius)
        point.lerp(
          axisPoint.addScaledVector(radial.normalize(), maxRadius),
          1 - clamp((along - height - 0.15) / 0.4, 0, 1),
        );
    }
    return point;
  };
  shape.forEach(constrain);
  const heading = new THREE.Vector3(...pose.heading);
  const terminal = new THREE.Vector3(...end);
  // The rendered terminal tangent and engagement calculation use the same pose.
  shape[shape.length - 2] = terminal.clone().addScaledVector(heading, -0.14);
  shape[shape.length - 1] = terminal;
  // Find the approach point nearest the recovered shape's proximal end.
  const samples = path.getSpacedPoints(240);
  let cut = 1,
    best = Infinity;
  samples.forEach((p, i) => {
    const d = p.distanceTo(shape[0]);
    if (d < best) {
      best = d;
      cut = i;
    }
  });
  const shaft = samples.slice(0, Math.max(2, cut + 1));
  return [
    ...shaft,
    ...new THREE.CatmullRomCurve3(
      [shaft.at(-1)!, ...shape.slice(1)],
      false,
      "centripetal",
    )
      .getPoints(140)
      .slice(1),
  ];
}
// Radius samples come from equivalent areas of the measured contour sections.
export function coronaryTube(
  branch: CoronaryBranch,
  color: THREE.ColorRepresentation,
  opacity = 1,
  multiplier = 1,
) {
  const path = curve(branch.points),
    count = 160,
    sides = 12;
  const geometry = new THREE.TubeGeometry(path, count, 1, sides, false);
  const position = geometry.getAttribute("position"),
    normals = geometry.getAttribute("normal");
  const lengths = [0];
  for (let j = 1; j < branch.points.length; j++)
    lengths.push(
      lengths[j - 1] +
        new THREE.Vector3(...branch.points[j]).distanceTo(
          new THREE.Vector3(...branch.points[j - 1]),
        ),
    );
  for (let i = 0; i <= count; i++) {
    const t = i / count,
      center = path.getPointAt(t);
    // TubeGeometry uses arc length sampling; lookup radius on the source polyline by arc length.
    const distance = t * lengths.at(-1)!;
    let k = 1;
    while (k < lengths.length - 1 && lengths[k] < distance) k++;
    const f =
      (distance - lengths[k - 1]) / Math.max(1e-9, lengths[k] - lengths[k - 1]);
    const radius =
      (branch.radii[k - 1] * (1 - f) + branch.radii[k] * f) * multiplier;
    for (let j = 0; j <= sides; j++) {
      const n = i * (sides + 1) + j;
      position.setXYZ(
        n,
        center.x + normals.getX(n) * radius,
        center.y + normals.getY(n) * radius,
        center.z + normals.getZ(n) * radius,
      );
    }
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      roughness: 0.5,
    }),
  );
}

export function polyline(
  points: THREE.Vector3[],
  radius: number,
  color: THREE.ColorRepresentation,
  opacity = 1,
) {
  const mesh = new THREE.Mesh(
    points.length < 2
      ? new THREE.BufferGeometry()
      : new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points),
          Math.max(24, points.length),
          radius,
          8,
          false,
        ),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.12,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
    }),
  );
  return mesh;
}
