import type { Catheter } from "./model";
// Hand traced centerlines from the user's reference. Planar silhouettes only;
// no manufacturer dimensions, stiffness or size-specific CAD is implied.
export const CATHETER_TRACES: Record<Catheter, [number, number][]> = {
  JL: [
    [10, 527],
    [40, 537],
    [80, 542],
    [111, 541],
    [132, 538],
    [139, 533],
    [138, 523],
    [132, 518],
    [110, 518],
    [102, 519],
    [98, 523],
    [98, 530],
  ],
  JR: [
    [10, 140],
    [43, 141],
    [68, 147],
    [95, 155],
    [115, 156],
    [132, 151],
    [138, 146],
    [138, 139],
  ],
  AL: [
    [174, 525],
    [205, 527],
    [239, 527],
    [264, 523],
    [275, 519],
    [280, 512],
    [277, 505],
    [271, 501],
    [267, 495],
    [267, 486],
  ],
};
export function catheterIconPath(kind: Catheter) {
  const ps = CATHETER_TRACES[kind],
    minX = Math.min(...ps.map((p) => p[0])),
    minY = Math.min(...ps.map((p) => p[1]));
  const scale = Math.min(
    120 / (Math.max(...ps.map((p) => p[0])) - minX),
    42 / (Math.max(...ps.map((p) => p[1])) - minY),
  );
  const yoff = (54 - (Math.max(...ps.map((p) => p[1])) - minY) * scale) / 2;
  // Catmull-Rom converted to Bezier for the selector silhouette.
  // The 3D JL uses a separately constrained shaft and two curved sections.
  let d = `M ${10 + (ps[0][0] - minX) * scale} ${yoff + (ps[0][1] - minY) * scale}`;
  const norm = (p: [number, number]) => [
    10 + (p[0] - minX) * scale,
    yoff + (p[1] - minY) * scale,
  ];
  for (let i = 0; i < ps.length - 1; i++) {
    const a = norm(ps[Math.max(0, i - 1)]),
      b = norm(ps[i]),
      c = norm(ps[i + 1]),
      e = norm(ps[Math.min(ps.length - 1, i + 2)]);
    d += ` C ${b[0] + (c[0] - a[0]) / 6} ${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6} ${c[1] - (e[1] - b[1]) / 6} ${c[0]} ${c[1]}`;
  }
  return d;
}
