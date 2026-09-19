import { fingerRollCoordinate } from "./rotation";
import { readGesture, MAX_HAND_FRAME_GAP_MS } from "./gesture";
import type { GestureFrame, Landmark } from "./gesture";
export interface ClassifiedHand extends GestureFrame {
  identity: "Left" | "Right";
}
// Fixed anatomical roles: [user's left hand, user's right hand].
export type HandPair = [ClassifiedHand | null, ClassifiedHand | null];
export interface HandCategory {
  categoryName: string;
  score: number;
}
// Tasks Vision 0.10.32 already reports anatomical Left/Right on raw video.
// Unlike legacy Solutions Hands, its labels must not be inverted for a CSS mirror.
export function cameraHandCategories(
  categories: HandCategory[][],
): HandCategory[] {
  return categories.map(
    ([category]) => category ?? { categoryName: "Unknown", score: 0 },
  );
}
export function readHandPair(
  hands: Landmark[][],
  time: number,
  previous: HandPair | null,
  categories: HandCategory[],
  worldHands?: Landmark[][],
): HandPair | null {
  if (!hands.length || hands.length > 2 || categories.length !== hands.length)
    return null;
  const pair: HandPair = [null, null];
  const seen = new Set<string>();
  for (let i = 0; i < hands.length; i++) {
    const c = categories[i];
    if (!["Left", "Right"].includes(c.categoryName)) continue;
    if (seen.has(c.categoryName)) return null;
    seen.add(c.categoryName);
    if (!Number.isFinite(c.score) || c.score < 0.8) continue;
    const slot = c.categoryName === "Left" ? 0 : 1;
    const old = previous?.[slot];
    const g = readGesture(hands[i], time, old ?? null);
    if (!g) continue;
    if (
      old &&
      time - old.time <= MAX_HAND_FRAME_GAP_MS &&
      Math.hypot(g.wrist.x - old.wrist.x, g.wrist.y - old.wrist.y) > 0.15
    )
      continue;
    pair[slot] = {
      ...g,
      fingerRoll: fingerRollCoordinate(worldHands?.[i]),
      identity: c.categoryName as ClassifiedHand["identity"],
    };
  }
  if (pair[0] && pair[1]) {
    if (
      Math.hypot(
        pair[0].wrist.x - pair[1].wrist.x,
        pair[0].wrist.y - pair[1].wrist.y,
      ) < 0.1
    )
      return null;
    if (
      previous?.[0] &&
      previous[1] &&
      time - previous[0].time <= MAX_HAND_FRAME_GAP_MS &&
      time - previous[1].time <= MAX_HAND_FRAME_GAP_MS &&
      Math.sign(pair[0].wrist.x - pair[1].wrist.x) !==
        Math.sign(previous[0].wrist.x - previous[1].wrist.x)
    )
      return null;
  }
  return pair.some(Boolean) ? pair : null;
}
