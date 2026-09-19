import { describe, it, expect } from "vitest";
import { readHandPair, cameraHandCategories } from "../src/hand/bimanual";
import type { ClassifiedHand, HandPair } from "../src/hand/bimanual";
import type { Landmark } from "../src/hand/gesture";
const frame = (identity: "Left" | "Right", time = 100): ClassifiedHand => ({
  identity,
  wrist: { x: identity === "Left" ? 0.75 : 0.25, y: 0.5, z: 0 },
  angle: 0,
  time,
  pinch: true,
  fingers: [1, 1, 1, 1, 1],
});
const pair = (time = 100): [ClassifiedHand, ClassifiedHand] => [
  frame("Left", time),
  frame("Right", time),
];
const hand = (x: number, y = 0.5): Landmark[] =>
  Array.from({ length: 21 }, (_, i) => ({ x, y: y - i * 0.007, z: 0 }));
const categories = [
  { categoryName: "Left", score: 0.99 },
  { categoryName: "Right", score: 0.99 },
];
describe("hand identity", () => {
  it("normalizes raw unmirrored camera classifications", () => {
    expect(
      cameraHandCategories(categories.map((c) => [c])).map(
        (c) => c.categoryName,
      ),
    ).toEqual(["Left", "Right"]);
  });
  it("assigns anatomical roles regardless of detector order or screen position", () => {
    const p = readHandPair([hand(0.75), hand(0.25)], 100, null, categories)!;
    const n = readHandPair([hand(0.26), hand(0.74)], 170, p, [
      categories[1],
      categories[0],
    ])!;
    expect(n.map((h) => h?.identity)).toEqual(["Left", "Right"]);
    const crossed = readHandPair(
      [hand(0.25), hand(0.75)],
      100,
      null,
      categories,
    )!;
    expect(crossed.map((h) => h?.identity)).toEqual(["Left", "Right"]);
    expect(crossed[0]?.wrist.x).toBe(0.25);
  });
  it("retains a single confidently identified hand in its fixed slot", () => {
    expect(
      readHandPair([hand(0.75)], 170, pair(), [categories[0]])?.[1],
    ).toBeNull();
    const p = readHandPair([hand(0.25)], 170, pair(), [categories[1]])!;
    expect(p[0]).toBeNull();
    expect(p[1]?.identity).toBe("Right");
  });
  it("drops uncertain input without disabling the other hand", () => {
    const p = readHandPair([hand(0.75), hand(0.25)], 170, pair(), [
      { ...categories[0], score: 0.6 },
      categories[1],
    ])!;
    expect(p[0]).toBeNull();
    expect(p[1]?.identity).toBe("Right");
  });
  it("rejects duplicates, missing labels, invalid points and discontinuities", () => {
    expect(
      readHandPair([hand(0.75), hand(0.25)], 100, null, [
        categories[0],
        categories[0],
      ]),
    ).toBeNull();
    expect(readHandPair([hand(0.75)], 100, null, [])).toBeNull();
    expect(readHandPair([[]], 100, null, [categories[0]])).toBeNull();
    expect(
      readHandPair([hand(0.75, 0.9), hand(0.25, 0.9)], 170, pair(), categories),
    ).toBeNull();
  });
  it("resets near wrists and crossings between frames", () => {
    expect(
      readHandPair([hand(0.51), hand(0.49)], 100, null, categories),
    ).toBeNull();
    const p: HandPair = pair();
    p[0]!.wrist.x = 0.56;
    p[1]!.wrist.x = 0.44;
    expect(
      readHandPair([hand(0.44), hand(0.56, 0.49)], 170, p, categories),
    ).toBeNull();
  });
});
