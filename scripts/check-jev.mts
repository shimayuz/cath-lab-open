import { loadEnv } from "vite";
import { evaluateIntent, jevClient, JEV_MODEL } from "../server/jev.ts";
import type { MotionObservation } from "../src/hand/jev-contract.ts";
// Synthetic observations only; never log credentials or SDK error payloads.
const key = loadEnv(
  "development",
  process.cwd(),
  "TYPESAFE_",
).TYPESAFE_API_KEY?.trim();
if (!key) {
  console.error("TYPESAFE_API_KEY is missing in .env.local");
  process.exit(1);
}
const client = jevClient(key);
const cases: {
  name: string;
  observation: MotionObservation;
  expected: string[];
}[] = [
  {
    name: "advancing",
    observation: {
      push: { grip: "gripped", movement: "push", returning: false },
      rotation: { grip: "gripped", movement: "still" },
    },
    expected: ["push", "hold"],
  },
  {
    name: "released",
    observation: {
      push: { grip: "released", movement: "pull", returning: true },
      rotation: { grip: "released", movement: "clockwise" },
    },
    expected: ["hold|regrip", "hold|regrip"],
  },
  {
    name: "rotation",
    observation: {
      push: { grip: "gripped", movement: "still", returning: false },
      rotation: { grip: "gripped", movement: "clockwise" },
    },
    expected: ["hold", "clockwise"],
  },
];
const results: unknown[] = [];
let failures = 0;
for (const [id, c] of cases.entries()) {
  try {
    // Diagnostic only: 5 seconds reveals transport latency; live control accepts <500ms.
    const result = await evaluateIntent(
      client,
      { id, instrument: "catheter", recent: [c.observation, c.observation] },
      AbortSignal.timeout(5500),
      5000,
    );
    const matchesExpected =
      c.expected[0].split("|").includes(result.push.choice) &&
      c.expected[1].split("|").includes(result.rotation.choice);
    if (!matchesExpected) failures++;
    results.push({
      case: c.name,
      matchesExpected,
      ...result,
      expected: c.expected,
      withinLiveDeadline: result.elapsedMs <= 500,
    });
  } catch (error) {
    failures++;
    const status =
      typeof error === "object" && error && "status" in error
        ? error.status
        : null;
    results.push({
      case: c.name,
      error:
        typeof status === "number" ? `http-${status}` : "connection-or-timeout",
    });
  }
}
console.log(
  JSON.stringify({ model: JEV_MODEL, synthetic: true, results }, null, 2),
);
if (failures) process.exitCode = 1;
