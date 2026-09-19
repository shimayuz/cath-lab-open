import { wrapAngle } from "../simulator/model";
import type { GestureRemainder } from "./gesture";
import type { ClassifiedHand, HandPair } from "./bimanual";

export type PushAxis = "left" | "up";
export type ClutchPhase = "released" | "arming" | "gripped" | "regrip";
export interface ClutchResult {
  delta: number;
  phase: ClutchPhase;
  returning: boolean;
}
const zero = (): GestureRemainder => ({ push: 0, rotation: 0 });

/** A virtual device grip. Device coordinates live in the simulator, never in the camera pose. */
export class StrokeClutch {
  private previous: ClassifiedHand | null = null;
  private anchor: ClassifiedHand | null = null;
  private phase: ClutchPhase = "released";
  private gripSince = 0;
  private openSince: number | null = null;
  private direction = 0;
  private emittedTravel = 0;
  private remainder = zero();

  reset() {
    this.previous = this.anchor = null;
    this.phase = "released";
    this.openSince = null;
    this.direction = this.emittedTravel = 0;
    this.remainder = zero();
  }
  update(
    next: ClassifiedHand | null,
    axis: PushAxis | "rotation",
    gain: number,
    precision = false,
  ): ClutchResult {
    const result = (delta = 0, returning = false): ClutchResult => ({
      delta,
      phase: this.phase,
      returning,
    });
    const previous = this.previous;
    if (!next) {
      if (this.phase !== "released") this.phase = "regrip";
      this.previous = this.anchor = null;
      this.openSince = null;
      this.remainder = zero();
      return result();
    }
    this.previous = next;
    const discontinuity =
      previous &&
      (next.identity !== previous.identity ||
        next.time <= previous.time ||
        next.time - previous.time > 2000 ||
        (this.phase === "gripped" &&
          previous.pinch &&
          next.pinch &&
          axis === "rotation" &&
          Math.abs(wrapAngle(next.angle - previous.angle)) > 35) ||
        Math.hypot(
          next.wrist.x - previous.wrist.x,
          next.wrist.y - previous.wrist.y,
        ) > 0.15);
    if (discontinuity) {
      this.phase = "regrip";
      this.anchor = null;
      this.openSince = null;
      this.remainder = zero();
    }
    // Release acts immediately. A brief dropout must not silently establish a new anchor.
    if (!next.pinch) {
      this.anchor = null;
      this.direction = this.emittedTravel = 0;
      this.remainder = zero();
      this.openSince ??= next.time;
      this.phase =
        this.phase === "released" || next.time - this.openSince >= 60
          ? "released"
          : "regrip";
      return result();
    }
    this.openSince = null;
    if (this.phase === "regrip") return result();
    if (this.phase === "released") {
      this.phase = "arming";
      this.gripSince = next.time;
      this.anchor = next;
      this.direction = this.emittedTravel = 0;
      return result();
    }
    if (this.phase === "arming") {
      // Discard hand placement and finger-closing motion; start from the fresh grip pose.
      this.anchor = next;
      if (next.time - this.gripSince >= 80) this.phase = "gripped";
      return result();
    }
    if (!this.anchor || !previous) return result();
    if (axis === "rotation") {
      if (precision || next.rotationDeadband != null) {
        // Spatial hysteresis: retain a bounded slack angle, never emit the slack
        // as a jump. Slow deliberate turns survive; bounded tremor does not drift.
        this.remainder.rotation += wrapAngle(next.angle - previous.angle);
        const excess =
          Math.sign(this.remainder.rotation) *
          Math.max(
            0,
            Math.abs(this.remainder.rotation) - (next.rotationDeadband ?? 0.8),
          );
        this.remainder.rotation -= excess;
        return result(Math.abs(excess) < 1e-9 ? 0 : excess * gain);
      }
      this.remainder.rotation += wrapAngle(next.angle - previous.angle) * gain;
      // Accumulate sub-threshold turns, preserving the full signed angle at any frame rate.
      if (Math.abs(this.remainder.rotation) < 0.25 * gain) return result();
      const delta = this.remainder.rotation;
      this.remainder.rotation = 0;
      return result(delta);
    }
    const travel =
      axis === "left"
        ? next.wrist.x - this.anchor.wrist.x
        : this.anchor.wrist.y - next.wrist.y;
    if (precision) {
      const error = travel - this.emittedTravel;
      const step = Math.sign(error) * Math.max(0, Math.abs(error) - 0.003);
      this.emittedTravel += step;
      return result(Math.abs(step) < 1e-9 ? 0 : step * 150 * gain);
    }
    if (!this.direction) {
      if (Math.abs(travel) < 0.012) return result();
      this.direction = Math.sign(travel);
    }
    // A held grip follows both directions. Repositioning is ignored only while released.
    // Keep a small reversal deadband to reject tremor, without locking the first direction.
    const step = travel - this.emittedTravel;
    const reversing = Math.sign(step) !== this.direction;
    if (Math.abs(step) < (reversing ? 0.004 : 0.002)) return result();
    this.direction = Math.sign(step);
    this.emittedTravel = travel;
    return result(step * 150 * gain);
  }
}
export class BimanualClutch {
  private push = new StrokeClutch();
  private rotation = new StrokeClutch();
  private precision = false;
  private rotationPrecision = false;
  reset() {
    this.push.reset();
    this.rotation.reset();
  }
  update(
    pair: HandPair | null,
    gain: number,
    swapRoles: boolean,
    axis: PushAxis,
    precision = false,
    rotationPrecision = precision,
  ) {
    if (
      precision !== this.precision ||
      rotationPrecision !== this.rotationPrecision
    ) {
      this.reset();
      this.precision = precision;
      this.rotationPrecision = rotationPrecision;
    }
    const push = this.push.update(
      pair?.[swapRoles ? 1 : 0] ?? null,
      axis,
      gain,
      precision,
    );
    const rotation = this.rotation.update(
      pair?.[swapRoles ? 0 : 1] ?? null,
      "rotation",
      gain,
      rotationPrecision,
    );
    return {
      push: push.delta,
      rotation: rotation.delta,
      pushPhase: push.phase,
      rotationPhase: rotation.phase,
      returning: push.returning,
    };
  }
}

/** Split within the same camera frame: no queued movement after release. */
export function splitPushDelta(delta: number): number[] {
  if (!Number.isFinite(delta) || Math.abs(delta) > 100) return [];
  const count = Math.ceil(Math.abs(delta) / 10);
  return count ? Array.from({ length: count }, () => delta / count) : [];
}

/** Reducer limits apply to each action, not to the total observed turn. */
export function splitRotationDelta(delta: number): number[] {
  if (!Number.isFinite(delta) || Math.abs(delta) > 100) return [];
  const count = Math.ceil(Math.abs(delta) / 30);
  return count ? Array.from({ length: count }, () => delta / count) : [];
}
