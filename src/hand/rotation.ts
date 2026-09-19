import type { ClassifiedHand } from "./bimanual";
import type { Landmark } from "./gesture";
export type RotationMode = "fingers" | "wrist";
// Control mapping, NOT measured catheter rotation: one palm length of relative
// finger travel maps to 180 control degrees before sensitivity / root scaling.
export const FINGER_CONTROL_DEGREES = 180;

/** Control convention for the demonstrated pinch grip, not measured axial rotation.
 * Right thumb moving toward the fingertips relative to the index means Counter;
 * a mirrored left-hand grip has the opposite mapping. CSS mirroring is unrelated.
 * Apply the user's explicit reverse setting later, exactly once.
 */
export function rotationDirectionSign(
  mode: RotationMode,
  identity: ClassifiedHand["identity"],
): 1 | -1 {
  return mode === "fingers" && identity === "Right" ? -1 : 1;
}

/** Signed thumb/index offset along the palm in the model's isotropic world frame.
 * Translation, scale and rigid wrist rotation cancel. Do not normalize the
 * thumb/index gap itself: it approaches zero during a pinch.
 */
export function fingerRollCoordinate(points?: Landmark[]): number | null {
  if (
    !points ||
    points.length !== 21 ||
    points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return null;
  const axis = {
    x: points[9].x - points[0].x,
    y: points[9].y - points[0].y,
    z: points[9].z - points[0].z,
  };
  const length2 = axis.x ** 2 + axis.y ** 2 + axis.z ** 2;
  if (length2 < 0.015 ** 2 || length2 > 0.2 ** 2) return null;
  const gap = {
    x: points[4].x - points[8].x,
    y: points[4].y - points[8].y,
    z: points[4].z - points[8].z,
  };
  const ratio = (gap.x * axis.x + gap.y * axis.y + gap.z * axis.z) / length2;
  return Math.abs(ratio) <= 0.6 ? ratio : null;
}
export function rotationInputHand(
  hand: ClassifiedHand | null,
  mode: RotationMode,
): ClassifiedHand | null {
  if (!hand || mode === "wrist") return hand;
  // Opening is a release even when the spread fingers have no usable roll coordinate.
  if (!hand.pinch) return { ...hand, angle: 0, rotationDeadband: 3 };
  if (hand.fingerRoll == null || !Number.isFinite(hand.fingerRoll)) return null;
  return {
    ...hand,
    angle:
      hand.fingerRoll *
      FINGER_CONTROL_DEGREES *
      rotationDirectionSign(mode, hand.identity),
    rotationDeadband: 3,
  };
}
