import type { ClutchPhase } from "./clutch.ts";
export const PUSH_INTENTS = [
  "push",
  "pull",
  "hold",
  "regrip",
  "uncertain",
] as const;
export const ROTATION_INTENTS = [
  "clockwise",
  "counterclockwise",
  "hold",
  "regrip",
  "uncertain",
] as const;
export type PushIntent = (typeof PUSH_INTENTS)[number];
export type RotationIntent = (typeof ROTATION_INTENTS)[number];
export interface MotionObservation {
  push: {
    grip: ClutchPhase;
    movement: "push" | "pull" | "still";
    returning: boolean;
  };
  rotation: {
    grip: ClutchPhase;
    movement: "clockwise" | "counterclockwise" | "still";
  };
}
export interface JevRequest {
  id: number;
  instrument: "wire" | "catheter";
  recent: MotionObservation[];
}
export interface IntentAnswer<T extends string> {
  choice: T;
  confidence: number;
  probability: number;
}
export interface JevResult {
  id: number;
  model: string;
  elapsedMs: number;
  push: IntentAnswer<PushIntent>;
  rotation: IntentAnswer<RotationIntent>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const phase = (value: unknown) =>
  ["released", "arming", "gripped", "regrip"].includes(value as string);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
/** A closed vocabulary prevents this local endpoint from becoming an arbitrary AI proxy. */
export function isJevRequest(value: unknown): value is JevRequest {
  if (
    !record(value) ||
    !exact(value, ["id", "instrument", "recent"]) ||
    !Number.isSafeInteger(value.id) ||
    (value.id as number) < 0 ||
    !["wire", "catheter"].includes(value.instrument as string) ||
    !Array.isArray(value.recent) ||
    value.recent.length < 1 ||
    value.recent.length > 6
  )
    return false;
  return value.recent.every(
    (v) =>
      record(v) &&
      exact(v, ["push", "rotation"]) &&
      record(v.push) &&
      exact(v.push, ["grip", "movement", "returning"]) &&
      record(v.rotation) &&
      exact(v.rotation, ["grip", "movement"]) &&
      phase(v.push.grip) &&
      phase(v.rotation.grip) &&
      typeof v.push.returning === "boolean" &&
      ["push", "pull", "still"].includes(v.push.movement as string) &&
      ["clockwise", "counterclockwise", "still"].includes(
        v.rotation.movement as string,
      ),
  );
}
const probability = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
export function isJevResult(v: unknown): v is JevResult {
  if (
    !record(v) ||
    !Number.isSafeInteger(v.id) ||
    typeof v.model !== "string" ||
    v.model.length > 80 ||
    typeof v.elapsedMs !== "number" ||
    !Number.isFinite(v.elapsedMs) ||
    v.elapsedMs < 0
  )
    return false;
  return (
    [
      [v.push, PUSH_INTENTS],
      [v.rotation, ROTATION_INTENTS],
    ] as const
  ).every(
    ([a, choices]) =>
      record(a) &&
      (choices as readonly unknown[]).includes(a.choice) &&
      probability(a.confidence) &&
      probability(a.probability),
  );
}
