import { rotationDirectionSign, type RotationMode } from "./rotation";
import {
  rootManeuver,
  wrapAngle,
  type SimulationState,
} from "../simulator/model";
import type { ClutchPhase, PushAxis } from "./clutch";
import type { JevStatus } from "./jev-assist";

export interface MeasurementSettings {
  gain: number;
  rotationMode?: RotationMode;
  pushAxis: PushAxis;
  swapRoles: boolean;
  reverse: boolean;
  requestedFps: number;
}
export interface MeasurementInput {
  time: number;
  pushHand: { position: number | null; phase: ClutchPhase };
  rotationHand: {
    angle: number | null;
    phase: ClutchPhase;
    fingerRoll?: number | null;
    wristAngle?: number | null;
  };
  simulation: SimulationState;
  commandPush: number;
  commandRotation: number;
  detectionMs: number;
  jev: JevStatus;
}
type Quality = "valid" | "baseline" | "released" | "missing" | "gap" | "jump";
export type MeasurementStopReason =
  "manual" | "camera" | "settings" | "hidden" | "limit";
export interface MeasurementSample {
  elapsedMs: number;
  dtMs: number | null;
  instrument: SimulationState["active"];
  rotationInstrument: "catheter";
  // Maps raw signed input to CW-positive control direction; raw values stay raw.
  rotationDirectionSign: 1 | -1;
  access: SimulationState["access"];
  catheterType: SimulationState["catheterType"];
  target: SimulationState["target"];
  rootPhase: ReturnType<typeof rootManeuver>;
  modelInsertion: number;
  modelCatheterInsertion: number;
  modelWireInsertion: number;
  modelRotation: number;
  pushPhase: ClutchPhase;
  rotationPhase: ClutchPhase;
  pushQuality: Quality;
  rotationQuality: Quality;
  handPosition: number | null;
  handAngle: number | null;
  fingerRoll: number | null;
  wristAngle: number | null;
  handPushStep: number | null;
  handSpeed: number | null;
  handAcceleration: number | null;
  handRotationStep: number | null;
  handAngularSpeed: number | null;
  handAngularAcceleration: number | null;
  commandPush: number;
  commandRotation: number;
  detectionMs: number;
  jevState: JevStatus["state"];
  jevLatencyMs: number | null;
  jevPush: string | null;
  jevRotation: string | null;
  jevPushConfidence: number | null;
  jevRotationConfidence: number | null;
}
const finite = (n: number | null | undefined): n is number =>
  n !== null && Number.isFinite(n);
const MAX_DURATION_MS = 300000;
const MAX_SAMPLES = 10000;
export class HandMeasurements {
  samples: MeasurementSample[] = [];
  recording = false;
  stopReason: MeasurementStopReason | null = null;
  private startTime = 0;
  private settings: MeasurementSettings | null = null;
  private segment = 0;
  private previousSegment = -1;
  get rotationMode(): RotationMode {
    return this.settings?.rotationMode ?? "wrist";
  }
  start(time: number, settings: MeasurementSettings) {
    this.startTime = time;
    this.settings = { ...settings };
    this.samples = [];
    this.recording = true;
    this.stopReason = null;
    this.segment++;
    this.previousSegment = -1;
  }
  stop(reason: MeasurementStopReason) {
    if (this.recording) {
      this.recording = false;
      this.stopReason = reason;
    }
  }
  breakContinuity() {
    this.segment++;
  }
  capture(input: MeasurementInput) {
    if (!this.recording || !Number.isFinite(input.time)) return;
    if (
      input.time - this.startTime > MAX_DURATION_MS ||
      this.samples.length >= MAX_SAMPLES
    ) {
      this.stop("limit");
      return;
    }
    const previous = this.samples.at(-1);
    const elapsedMs = input.time - this.startTime;
    if (elapsedMs < 0 || (previous && elapsedMs <= previous.elapsedMs)) return;
    const dtMs = previous ? elapsedMs - previous.elapsedMs : null;
    const state = input.simulation;
    const sameContext =
      previous &&
      this.segment === this.previousSegment &&
      previous.instrument === state.active &&
      previous.access === state.access &&
      previous.catheterType === state.catheterType &&
      previous.target === state.target;
    const position = finite(input.pushHand.position)
      ? input.pushHand.position * 100
      : null;
    const angle = finite(input.rotationHand.angle)
      ? input.rotationHand.angle
      : null;
    const axis = (
      value: number | null,
      prior: number | null | undefined,
      phase: ClutchPhase,
      priorPhase: ClutchPhase | undefined,
      rotational: boolean,
    ) => {
      let quality: Quality = "valid";
      let step: number | null = null;
      if (value === null) quality = "missing";
      else if (phase !== "gripped") quality = "released";
      else if (!sameContext || priorPhase !== "gripped" || prior == null)
        quality = "baseline";
      else if (dtMs === null || dtMs > 500) quality = "gap";
      else {
        const delta =
          rotational && this.rotationMode === "wrist"
            ? wrapAngle(value - prior)
            : value - prior;
        if (Math.abs(delta) > (rotational ? 35 : 15)) quality = "jump";
        else step = delta;
      }
      return {
        quality,
        step,
        speed: step !== null && dtMs ? (step * 1000) / dtMs : null,
      };
    };
    const push = axis(
      position,
      previous?.handPosition,
      input.pushHand.phase,
      previous?.pushPhase,
      false,
    );
    const rotation = axis(
      angle,
      previous?.handAngle,
      input.rotationHand.phase,
      previous?.rotationPhase,
      true,
    );
    // Velocities are interval averages. Differentiate at their interval midpoints.
    const acceleration = (
      speed: number | null,
      prior: number | null | undefined,
    ) =>
      speed !== null && prior != null && dtMs && previous?.dtMs
        ? ((speed - prior) * 2000) / (dtMs + previous.dtMs)
        : null;
    const result = input.jev.state === "active" ? input.jev.result : null;
    this.samples.push({
      elapsedMs,
      dtMs,
      instrument: state.active,
      rotationInstrument: "catheter",
      rotationDirectionSign: (rotationDirectionSign(
        this.rotationMode,
        this.settings?.swapRoles ? "Left" : "Right",
      ) * (this.settings?.reverse ? -1 : 1)) as 1 | -1,
      access: state.access,
      catheterType: state.catheterType,
      target: state.target,
      rootPhase: rootManeuver(state),
      modelInsertion: state[state.active],
      modelCatheterInsertion: state.catheter,
      modelWireInsertion: state.wire,
      modelRotation: state.rotation,
      pushPhase: input.pushHand.phase,
      rotationPhase: input.rotationHand.phase,
      pushQuality: push.quality,
      rotationQuality: rotation.quality,
      handPosition: position,
      handAngle: angle,
      fingerRoll: finite(input.rotationHand.fingerRoll)
        ? input.rotationHand.fingerRoll * 100
        : null,
      wristAngle: finite(input.rotationHand.wristAngle)
        ? input.rotationHand.wristAngle
        : this.rotationMode === "wrist"
          ? angle
          : null,
      handPushStep: push.step,
      handSpeed: push.speed,
      handAcceleration: acceleration(push.speed, previous?.handSpeed),
      handRotationStep: rotation.step,
      handAngularSpeed: rotation.speed,
      handAngularAcceleration: acceleration(
        rotation.speed,
        previous?.handAngularSpeed,
      ),
      commandPush: input.commandPush,
      commandRotation: input.commandRotation,
      detectionMs: input.detectionMs,
      jevState: input.jev.state,
      jevLatencyMs: input.jev.latencyMs,
      jevPush: result?.push.choice ?? null,
      jevRotation: result?.rotation.choice ?? null,
      jevPushConfidence: result?.push.confidence ?? null,
      jevRotationConfidence: result?.rotation.confidence ?? null,
    });
    this.previousSegment = this.segment;
  }
  export() {
    return {
      schema: "cath-lab-hand-measurements-v2",
      createdAt: new Date().toISOString(),
      units: {
        handTranslation: "image_axis_percent",
        handRotation:
          this.rotationMode === "fingers"
            ? "palm_length_percent"
            : "image_plane_degrees",
        fingerRoll: "palm_length_percent",
        force: "not_measured",
        torque: "not_measured",
        modelInsertion: "simulation_percent",
        modelRotation: "simulation_degrees",
      },
      settings: this.settings ? { ...this.settings } : null,
      stopReason: this.stopReason,
      samples: this.samples.map((s) => ({ ...s })),
    };
  }
}
/** Filter each physical axis, not only the selected push/pull device. */
export function filterMeasurementSamples(
  samples: readonly MeasurementSample[],
  scope: string,
): MeasurementSample[] {
  if (scope === "all") return [...samples];
  return samples
    .filter((s) =>
      scope === "wire"
        ? s.instrument === "wire"
        : scope === "root"
          ? s.modelCatheterInsertion > 0 && s.rootPhase !== "approach"
          : s.modelCatheterInsertion > 0,
    )
    .map((s) => {
      const includePush =
        s.instrument === (scope === "wire" ? "wire" : "catheter");
      const includeRotation = scope !== "wire";
      return {
        ...s,
        modelInsertion:
          scope === "wire" ? s.modelWireInsertion : s.modelCatheterInsertion,
        ...(!includePush
          ? {
              handPosition: null,
              handPushStep: null,
              handSpeed: null,
              handAcceleration: null,
              commandPush: 0,
              pushQuality: "missing" as const,
              pushPhase: "released" as const,
            }
          : {}),
        ...(!includeRotation
          ? {
              handAngle: null,
              handRotationStep: null,
              handAngularSpeed: null,
              handAngularAcceleration: null,
              commandRotation: 0,
              rotationQuality: "missing" as const,
              rotationPhase: "released" as const,
            }
          : {}),
      };
    });
}
export function summarizeMeasurements(samples: readonly MeasurementSample[]) {
  const peak = (
    key:
      | "handSpeed"
      | "handAcceleration"
      | "handAngularSpeed"
      | "handAngularAcceleration",
  ) => {
    const values = samples
      .map((s) => s[key])
      .filter(finite)
      .map(Math.abs);
    return values.length ? Math.max(...values) : null;
  };
  return {
    count: samples.length,
    durationMs: samples.length
      ? samples.at(-1)!.elapsedMs - samples[0].elapsedMs
      : 0,
    push: samples.reduce((n, s) => n + Math.max(0, s.handPushStep ?? 0), 0),
    pull: samples.reduce((n, s) => n + Math.max(0, -(s.handPushStep ?? 0)), 0),
    clockwise: samples.reduce(
      (n, s) =>
        n + Math.max(0, (s.handRotationStep ?? 0) * s.rotationDirectionSign),
      0,
    ),
    counterclockwise: samples.reduce(
      (n, s) =>
        n + Math.max(0, -(s.handRotationStep ?? 0) * s.rotationDirectionSign),
      0,
    ),
    rotationArc: samples.reduce(
      (n, s) => n + Math.abs(s.handRotationStep ?? 0),
      0,
    ),
    peakSpeed: peak("handSpeed"),
    peakAcceleration: peak("handAcceleration"),
    peakAngularSpeed: peak("handAngularSpeed"),
    validPush: samples.filter((s) => s.pushQuality === "valid").length,
    validRotation: samples.filter((s) => s.rotationQuality === "valid").length,
    gaps: samples.filter(
      (s) => s.pushQuality === "gap" || s.rotationQuality === "gap",
    ).length,
  };
}
export function measurementsCsv(data: ReturnType<HandMeasurements["export"]>) {
  const columns: [string, (sample: MeasurementSample) => unknown][] = [
    ["elapsed_ms", (s) => s.elapsedMs],
    ["dt_ms", (s) => s.dtMs],
    ["instrument", (s) => s.instrument],
    ["rotation_instrument", (s) => s.rotationInstrument],
    ["rotation_direction_sign", (s) => s.rotationDirectionSign],
    ["access", (s) => s.access],
    ["catheter_type", (s) => s.catheterType],
    ["target", (s) => s.target],
    ["root_phase", (s) => s.rootPhase],
    ["model_insertion_percent_observed", (s) => s.modelInsertion],
    ["model_rotation_degrees_observed", (s) => s.modelRotation],
    ["push_grip", (s) => s.pushPhase],
    ["rotation_grip", (s) => s.rotationPhase],
    ["push_quality", (s) => s.pushQuality],
    ["rotation_quality", (s) => s.rotationQuality],
    ["hand_position_image_percent", (s) => s.handPosition],
    ["hand_angle_image_degrees", (s) => s.wristAngle],
    ["finger_roll_palm_percent", (s) => s.fingerRoll],
    ["rotation_input_coordinate", (s) => s.handAngle],
    ["rotation_input_unit", () => data.units.handRotation],
    ["rotation_mode", () => data.settings?.rotationMode ?? "wrist"],
    ["hand_push_step_image_percent", (s) => s.handPushStep],
    ["hand_speed_image_percent_per_s", (s) => s.handSpeed],
    ["hand_acceleration_image_percent_per_s2", (s) => s.handAcceleration],
    [
      "hand_rotation_step_degrees",
      (s) =>
        data.units.handRotation === "image_plane_degrees"
          ? s.handRotationStep
          : null,
    ],
    ["rotation_input_step", (s) => s.handRotationStep],
    ["rotation_input_speed_per_s", (s) => s.handAngularSpeed],
    ["rotation_input_acceleration_per_s2", (s) => s.handAngularAcceleration],
    [
      "hand_angular_speed_degrees_per_s",
      (s) =>
        data.units.handRotation === "image_plane_degrees"
          ? s.handAngularSpeed
          : null,
    ],
    [
      "hand_angular_acceleration_degrees_per_s2",
      (s) =>
        data.units.handRotation === "image_plane_degrees"
          ? s.handAngularAcceleration
          : null,
    ],
    ["command_push_simulation_percent", (s) => s.commandPush],
    ["command_rotation_degrees", (s) => s.commandRotation],
    ["detection_ms", (s) => s.detectionMs],
    ["jev_state", (s) => s.jevState],
    ["jev_latency_ms", (s) => s.jevLatencyMs],
    ["jev_push", (s) => s.jevPush],
    ["jev_rotation", (s) => s.jevRotation],
    ["jev_push_confidence", (s) => s.jevPushConfidence],
    ["jev_rotation_confidence", (s) => s.jevRotationConfidence],
    ["gain", () => data.settings?.gain],
    ["push_axis", () => data.settings?.pushAxis],
    ["swap_roles", () => data.settings?.swapRoles],
    ["reverse_rotation", () => data.settings?.reverse],
    ["requested_fps", () => data.settings?.requestedFps],
    ["force", () => data.units.force],
    ["torque", () => data.units.torque],
  ];
  const cell = (v: unknown) =>
    '"' + (v == null ? "" : String(v)).replaceAll('"', '""') + '"';
  return (
    "\uFEFF" +
    [
      columns.map(([name]) => cell(name)).join(","),
      ...data.samples.map((s) =>
        columns.map(([, get]) => cell(get(s))).join(","),
      ),
    ].join("\r\n")
  );
}

export interface MeasuredMovement {
  axis: "push" | "rotation";
  direction: "push" | "pull" | "clockwise" | "counterclockwise";
  instrument: SimulationState["active"];
  startMs: number;
  endMs: number;
  rootPhase: MeasurementSample["rootPhase"];
  handAmount: number;
  handArc: number;
  commandAmount: number;
  peakSpeed: number;
}
/** Segment measured hand movement, independently of the device clutch deadband. */
export function measuredMovements(
  samples: readonly MeasurementSample[],
): MeasuredMovement[] {
  const movements: MeasuredMovement[] = [];
  for (const axis of ["push", "rotation"] as const) {
    let current: MeasuredMovement | null = null;
    let previous: MeasurementSample | undefined;
    let stillSince: number | null = null;
    for (const s of samples) {
      const command = axis === "push" ? s.commandPush : s.commandRotation;
      const step = axis === "push" ? s.handPushStep : s.handRotationStep;
      const speed = axis === "push" ? s.handSpeed : s.handAngularSpeed;
      if (
        step === null ||
        !previous ||
        s.elapsedMs - previous.elapsedMs > 500 ||
        s.instrument !== previous.instrument ||
        s.rootPhase !== previous.rootPhase ||
        s.access !== previous.access ||
        s.catheterType !== previous.catheterType ||
        s.target !== previous.target
      ) {
        current = null;
        stillSince = null;
      }
      if (step !== null && speed !== null) {
        if (Math.abs(step) <= 1e-9) {
          stillSince ??= s.elapsedMs - (s.dtMs ?? 0);
          if (current) current.commandAmount += command;
          if (s.elapsedMs - stillSince >= 250) current = null;
        } else {
          stillSince = null;
          const direction =
            axis === "push"
              ? step > 0
                ? "push"
                : "pull"
              : step * s.rotationDirectionSign > 0
                ? "clockwise"
                : "counterclockwise";
          if (!current || current.direction !== direction) {
            current = {
              axis,
              direction,
              instrument:
                axis === "rotation" ? s.rotationInstrument : s.instrument,
              startMs: s.elapsedMs - (s.dtMs ?? 0),
              endMs: s.elapsedMs,
              rootPhase: s.rootPhase,
              handAmount: 0,
              handArc: 0,
              commandAmount: 0,
              peakSpeed: 0,
            };
            movements.push(current);
          }
          current.endMs = s.elapsedMs;
          current.handAmount += step;
          current.handArc += Math.abs(step);
          current.commandAmount += command;
          current.peakSpeed = Math.max(current.peakSpeed, Math.abs(speed));
        }
      }
      previous = s;
    }
  }
  return movements.sort((a, b) => a.startMs - b.startMs);
}
export function movementsCsv(data: ReturnType<HandMeasurements["export"]>) {
  const header =
    "axis,direction,instrument,root_phase,start_ms,end_ms,hand_net,hand_arc,hand_unit,command_net,command_unit,peak_speed,force,torque";
  return (
    "\uFEFF" +
    [
      header,
      ...measuredMovements(data.samples).map((s) =>
        [
          s.axis,
          s.direction,
          s.instrument,
          s.rootPhase,
          s.startMs,
          s.endMs,
          s.handAmount,
          s.handArc,
          s.axis === "push" ? "image_axis_percent" : data.units.handRotation,
          s.commandAmount,
          s.axis === "push" ? "simulation_percent" : "simulation_degrees",
          s.peakSpeed,
          "not_measured",
          "not_measured",
        ].join(","),
      ),
    ].join("\r\n")
  );
}
