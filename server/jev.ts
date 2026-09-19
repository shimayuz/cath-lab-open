import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import { isJevResult } from "../src/hand/jev-contract.ts";
import type { JevRequest, JevResult } from "../src/hand/jev-contract.ts";
export const JEV_MODEL = "jev-1.13.0";
export const questions = {
  push: choice(
    "Interpret the user's longitudinal hand-control intent from recent.push observations, oldest to newest. Is the user deliberately advancing, withdrawing, holding position, or repositioning the hand for another grip? While gripped, reversing direction is a valid push or pull: prefer the newest movement and do not interpret reversal alone as regripping. An explicitly released grip or returning:true means hold/regrip; never invent device motion. Choose uncertain when evidence conflicts. Do not judge clinical technique.",
    {
      push: "A maintained grip and deliberate advancing motion, without returning to regrip.",
      pull: "A maintained grip and deliberate withdrawing motion, without returning to regrip.",
      hold: "The hand is stationary or released; hold the device at its current position.",
      regrip:
        "The hand is arming a new grip, returning to its start, or repositioning; ignore this motion.",
      uncertain:
        "Ambiguous or contradictory observations; no confident interpretation.",
    },
  ),
  rotation: choice(
    "Interpret rotational hand-control intent from recent.rotation observations, oldest to newest. Is the user deliberately rotating clockwise, counterclockwise, holding, or regripping? Only a gripped hand can command rotation, and rotation always targets the catheter; instrument identifies only the push/pull target. Prefer the newest gripped clockwise or counterclockwise motion even when small or reversing; a direction change alone is not regripping. Choose uncertain for conflicting observations. Do not infer movement distances or clinical actions.",
    {
      clockwise:
        "A maintained grip with deliberate clockwise rotation of the catheter.",
      counterclockwise:
        "A maintained grip with deliberate counterclockwise rotation of the catheter.",
      hold: "Stationary or released rotation hand; hold the catheter angle.",
      regrip:
        "Arming or repositioning the rotation hand; ignore the placement motion.",
      uncertain:
        "Ambiguous or contradictory observations; no confident interpretation.",
    },
  ),
};
export function jevClient(apiKey: string, transport?: typeof fetch) {
  return new TypeSafeClient({
    apiKey,
    baseURL: "https://api.typesafe.ai",
    defaultModel: JEV_MODEL,
    timeout: 700,
    retry: { maxRetries: 0 },
    logLevel: "off",
    ...(transport ? { fetch: transport } : {}),
  });
}
export async function evaluateIntent(
  client: TypeSafeClient,
  request: JevRequest,
  signal: AbortSignal,
  timeout = 700,
): Promise<JevResult> {
  const start = performance.now();
  const response = await client.systemOne(
    {
      model: JEV_MODEL,
      state: {
        instrument: request.instrument,
        recent: request.recent.map(({ push, rotation }) => ({
          push: { ...push },
          rotation: { ...rotation },
        })),
      },
      questions,
    },
    { signal, timeout },
  );
  const answer = (
    a: typeof response.answers.push | typeof response.answers.rotation,
  ) => ({
    choice: a.choice,
    confidence: a.confidence,
    probability: (a.probabilities as Record<string, number>)[a.choice],
  });
  const result = {
    id: request.id,
    model: response.model,
    elapsedMs: Math.round(performance.now() - start),
    push: answer(response.answers.push),
    rotation: answer(response.answers.rotation),
  };
  if (!isJevResult(result)) throw new Error("invalid-response");
  return result;
}
