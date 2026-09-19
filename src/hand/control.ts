import { clamp, type SimulationState } from "../simulator/model";

// A virtual travel coordinate makes sensitivity independent of camera frame count.
// Its slope rises continuously from 1 at 82 to 10 at 90 (fine motion in the root).
function travelCoordinate(insertion: number): number {
  if (insertion <= 82) return insertion;
  if (insertion >= 90) return 126 + (insertion - 90) * 10;
  const d = insertion - 82;
  return 82 + d + (9 * d * d) / 16;
}
function insertionCoordinate(travel: number): number {
  if (travel <= 82) return travel;
  if (travel >= 126) return 90 + (travel - 126) / 10;
  return 82 + (8 / 9) * (Math.sqrt(1 + (9 * (travel - 82)) / 4) - 1);
}
export function fineCatheterControl(s: SimulationState): boolean {
  return (
    s.active === "catheter" && s.catheter > 82 && s.wire <= s.catheter - 14
  );
}
export function cameraPushDelta(s: SimulationState, delta: number): number {
  if (!Number.isFinite(delta) || Math.abs(delta) > 100) return 0;
  if (s.active !== "catheter") return delta;
  // A wire-supported catheter retains normal delivery speed. Account for crossing
  // the free-tip boundary within this frame, in either direction.
  const boundary = Math.max(82, s.wire + 14);
  const atBoundary = travelCoordinate(boundary);
  const coordinate = (x: number) =>
    x <= boundary ? x : boundary + travelCoordinate(x) - atBoundary;
  const start = coordinate(s.catheter);
  const next = start + delta;
  const insertion =
    next <= boundary ? next : insertionCoordinate(next - boundary + atBoundary);
  return clamp(insertion, 0, 98) - s.catheter;
}

/** Half-angle rotation near the root gives more hand travel for the same tip turn. */
export function cameraRotationDelta(s: SimulationState, delta: number): number {
  if (!Number.isFinite(delta) || Math.abs(delta) > 100) return 0;
  if (s.catheter <= 0) return 0;
  // The rotation hand always controls the catheter, even while the push hand
  // selects the wire. Preserve root sensitivity across that selection change.
  return delta * (fineCatheterControl({ ...s, active: "catheter" }) ? 0.5 : 1);
}
