import { clamp, wrapAngle } from "../simulator/model";
// Allow low-frame-rate rendering while still rejecting discontinuities and long gaps.
export const MAX_HAND_FRAME_GAP_MS = 500;
export interface Landmark {
  x: number;
  y: number;
  z: number;
}
export interface GestureFrame {
  wrist: Landmark;
  angle: number;
  fingerRoll?: number | null;
  rotationDeadband?: number;
  pinch: boolean;
  fingers: number[];
  time: number;
}
export interface GestureDelta {
  push: number;
  rotation: number;
  pinched: boolean;
}
const distance = (a: Landmark, b: Landmark) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function readGesture(
  points: Landmark[],
  time: number,
  previous: GestureFrame | null = null,
): GestureFrame | null {
  if (
    points.length !== 21 ||
    points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return null;
  const palm = Math.max(0.02, distance(points[0], points[9]));
  const wrist = points[0],
    middle = points[9];
  // Camera preview is mirrored. This is an image-plane wrist tilt, not measured axial torque.
  const angle =
    (Math.atan2(-(middle.x - wrist.x), -(middle.y - wrist.y)) * 180) / Math.PI;
  const fingers = [4, 8, 12, 16, 20].map((tip, i) =>
    clamp(
      distance(points[tip], wrist) /
        (distance(points[[2, 5, 9, 13, 17][i]], wrist) * 1.9),
      0,
      1,
    ),
  );
  return {
    wrist,
    angle,
    pinch:
      distance(points[4], points[8]) / palm < (previous?.pinch ? 0.48 : 0.36),
    fingers,
    time,
  };
}
export interface GestureRemainder {
  push: number;
  rotation: number;
}
export function gestureDelta(
  previous: GestureFrame | null,
  next: GestureFrame | null,
  gain = 1,
  remainder: GestureRemainder = { push: 0, rotation: 0 },
): GestureDelta {
  const reset = () => {
    remainder.push = 0;
    remainder.rotation = 0;
  };
  if (
    !previous ||
    !next ||
    !next.pinch ||
    !previous.pinch ||
    next.time - previous.time > MAX_HAND_FRAME_GAP_MS ||
    next.time <= previous.time
  ) {
    reset();
    return { push: 0, rotation: 0, pinched: next?.pinch ?? false };
  }
  const dy = previous.wrist.y - next.wrist.y,
    da = wrapAngle(next.angle - previous.angle);
  // Reject tracking jumps rather than letting reacquisition move a device.
  if (Math.abs(dy) > 0.09 || Math.abs(da) > 35) {
    reset();
    return { push: 0, rotation: 0, pinched: true };
  }
  // Retain sub-threshold displacement. Opposing jitter cancels; slow travel survives.
  const push = dy * 150 * gain + remainder.push;
  const rotation = da * gain + remainder.rotation;
  const emitPush = Math.abs(push) >= 0.3 * gain;
  const emitRotation = Math.abs(rotation) >= 0.7 * gain;
  remainder.push = emitPush ? 0 : push;
  remainder.rotation = emitRotation ? 0 : rotation;
  return {
    push: emitPush ? clamp(push, -3, 3) : 0,
    rotation: emitRotation ? clamp(rotation, -8, 8) : 0,
    pinched: true,
  };
}
export const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
