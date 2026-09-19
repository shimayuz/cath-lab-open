import {
  canInject,
  CUSP_BOTTOM_INSERTION,
  OSTIAL_INSERTION,
  desiredRotation,
  distalIsFree,
  dropRotation,
  supportsTarget,
  wrapAngle,
} from "./model";
import type { Action, SimulationState } from "./model";
export interface DemoStep {
  actions: Action[];
  view?: "route" | "heart" | "root";
  complete?: boolean;
  waitMs?: number;
}
/** Demonstrate the same sinus seating / pull-back actions accepted from the hands. */
export function nextDemoStep(s: SimulationState): DemoStep {
  const move = (
    delta: number,
    instrument: "wire" | "catheter" = "catheter",
  ): DemoStep => ({
    actions: [
      { type: "select", instrument },
      { type: "move", delta, instrument },
    ],
    view: instrument === "wire" && delta > 0 ? "route" : "root",
  });
  const rotate = (goal: number): DemoStep => ({
    actions: [
      { type: "select", instrument: "catheter" },
      {
        type: "rotate",
        delta:
          Math.sign(wrapAngle(goal - s.rotation)) *
          Math.min(5, Math.abs(wrapAngle(goal - s.rotation))),
      },
    ],
    view: "root",
  });
  if (s.bolus && s.time - s.bolus.start < s.bolus.duration + 4)
    return { actions: [] };
  if (s.imaged.length === 2) return { actions: [], complete: true };
  if (s.imaged.includes(s.target))
    return {
      actions: [
        { type: "target", value: s.target === "LCA" ? "RCA" : "LCA" },
        { type: "catheter", value: s.target === "LCA" ? "JR" : "JL" },
      ],
      view: "route",
    };
  if (!supportsTarget(s))
    return {
      actions: [{ type: "catheter", value: s.target === "LCA" ? "JL" : "JR" }],
      view: "route",
    };
  if (s.root?.seatAt != null) {
    if (Math.abs(s.catheter - s.root.seatAt) > 0.05)
      return move(Math.max(-3, Math.min(3, s.root.seatAt - s.catheter)));
    if (s.wire > 0) return move(-10, "wire");
    if (Math.abs(wrapAngle(desiredRotation(s) - s.rotation)) > 0.1)
      return rotate(desiredRotation(s));
    if (canInject(s))
      return s.contrastVolume !== 6 || s.contrastDuration !== 2
        ? { actions: [{ type: "contrast", volume: 6, duration: 2 }] }
        : { actions: [{ type: "inject" }], waitMs: 500 };
    return { actions: [] };
  }
  if (s.root && s.root.side !== s.target) return move(-3);
  if (!s.root) {
    if (
      s.catheter > 92 &&
      (s.wire > 0 || Math.abs(wrapAngle(dropRotation(s) - s.rotation)) > 0.1)
    )
      return move(Math.max(-3, 92 - s.catheter));
    if (s.catheter < 92) {
      if (!distalIsFree(s) && s.wire < 100) return move(5, "wire");
      return move(Math.min(4, 92 - s.catheter));
    }
    if (s.wire > 0) return move(-10, "wire");
    if (Math.abs(wrapAngle(dropRotation(s) - s.rotation)) > 0.1)
      return rotate(dropRotation(s));
    return move(Math.min(0.25, CUSP_BOTTOM_INSERTION - s.catheter));
  }
  if (s.root.capturedAt < CUSP_BOTTOM_INSERTION - 0.01)
    return move(Math.min(0.25, CUSP_BOTTOM_INSERTION - s.catheter));
  // Let learners see the tip at the bottom before the combined pull and rotation.
  if (s.root.bottomAt != null && s.time - s.root.bottomAt < 0.7)
    return { actions: [] };
  const remaining = s.catheter - OSTIAL_INSERTION;
  const turn = wrapAngle(desiredRotation(s) - s.rotation);
  if (remaining > 0.001) {
    const fraction = Math.min(1, 0.1 / remaining);
    return {
      actions: [
        { type: "select", instrument: "catheter" },
        { type: "rotate", delta: turn * fraction },
        { type: "move", delta: -remaining * fraction, instrument: "catheter" },
      ],
      view: "root",
    };
  }
  if (Math.abs(turn) > 0.1) return rotate(desiredRotation(s));
  // Restart after a manually aborted maneuver rather than jumping into an ostium.
  return move(-3);
}
