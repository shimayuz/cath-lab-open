import { reducer } from "../src/simulator/model";
import type { SimulationState } from "../src/simulator/model";
export function tick(s: SimulationState, seconds: number) {
  for (let n = 0; n < Math.round(seconds * 20); n++)
    s = reducer(s, { type: "tick", dt: 0.05 });
  return s;
}
