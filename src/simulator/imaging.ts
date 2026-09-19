import { translator } from "../i18n/messages";
import type { Locale } from "../i18n/messages";
import { clamp, engagement } from "./model";
import type { Bolus, SimulationState } from "./model";
export const FLAT_PANEL_SIZES = [6, 7, 8, 9, 10] as const;
export type FlatPanelSize = (typeof FLAT_PANEL_SIZES)[number];
export interface ImagingSettings {
  yaw: number;
  pitch: number;
  panX: number;
  panY: number;
  zoom: number;
  fieldOfViewInch: FlatPanelSize;
  width: number;
  height: number;
  enabled: boolean;
  captureId: number;
  recording: boolean;
}
export const defaultImaging: ImagingSettings = {
  yaw: 0,
  pitch: 0,
  panX: 0,
  panY: 0,
  zoom: 1,
  fieldOfViewInch: 6,
  width: 1,
  height: 1,
  enabled: true,
  captureId: 0,
  recording: false,
};
export type ProjectionSettings = Pick<
  ImagingSettings,
  "yaw" | "pitch" | "fieldOfViewInch" | "zoom"
>;
export interface CapturedFrame {
  image: string;
  time: number;
  projection: ProjectionSettings;
}
export interface Cine {
  frames: CapturedFrame[];
  duration: number;
}
/** Relative detector field at fixed projection geometry; 10 inch is the baseline. */
export function fluoroMagnification(s: ImagingSettings) {
  return (10 / s.fieldOfViewInch) * s.zoom;
}
export function projectionCaption(
  s: ProjectionSettings,
  locale: Locale = "ja",
) {
  const t = translator(locale);
  return `${s.yaw === 0 ? "AP" : `${s.yaw > 0 ? "LAO" : "RAO"} ${Math.abs(s.yaw)}°`} / ${s.pitch === 0 ? t("水平") : `${s.pitch > 0 ? "CRA" : "CAU"} ${Math.abs(s.pitch)}°`} / FPD ${s.fieldOfViewInch} inch${s.zoom !== 1 ? ` / ${s.zoom.toFixed(1)}×` : ""}`;
}
/** A delayed bolus with washout; concentration is illustrative, not CFD or X-ray attenuation. */
export function contrastAt(b: Bolus | null, time: number, delay: number) {
  if (!b || b.volume <= 0) return { front: 0, opacity: 0 };
  const elapsed = time - b.start - delay;
  const front = clamp(elapsed * 1.8, 0, 1);
  const rate = b.volume / Math.max(0.01, b.duration);
  const rise = 1 - Math.exp(-Math.max(0, elapsed) * 4);
  const washout = Math.exp(-Math.max(0, elapsed - b.duration) / 1.05);
  const opacity = clamp(rate / 4, 0.08, 1) * rise * washout;
  return { front, opacity: opacity < 0.012 ? 0 : opacity };
}
export function hemodynamics(s: SimulationState) {
  const e = engagement(s),
    damping = e.damping;
  // Only catheter-transduced pressure changes; systemic vitals are a fixed normal teaching scenario.
  return {
    connected: s.catheter >= 82,
    damping,
    systolic: Math.round(120 - damping * 52),
    diastolic: Math.round(80 - damping * 23),
    hr: 72,
    spo2: 98,
    systemic: "120/80",
  };
}
export function ecgAt(time: number) {
  const p = ((((time * 72) / 60) % 1) + 1) % 1;
  const g = (m: number, w: number) => Math.exp(-(((p - m) / w) ** 2));
  return (
    0.12 * g(0.16, 0.035) -
    0.16 * g(0.285, 0.012) +
    g(0.31, 0.01) -
    0.3 * g(0.335, 0.015) +
    0.24 * g(0.57, 0.075)
  );
}
export function pressureAt(time: number, damping: number) {
  const p = ((((time * 72) / 60) % 1) + 1) % 1;
  const knots = [
    [0, 0],
    [0.1, 1],
    [0.22, 0.83],
    [0.36, 0.53],
    [0.39, 0.43],
    [0.415, 0.5],
    [0.5, 0.38],
    [0.75, 0.15],
    [1, 0],
  ];
  const i = Math.max(0, knots.findIndex((k) => k[0] >= p) - 1),
    a = knots[i],
    b = knots[i + 1];
  const pulse = a[1] + ((b[1] - a[1]) * (p - a[0])) / (b[0] - a[0]);
  const smooth = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
  return (
    80 -
    damping * 23 +
    (40 - damping * 29) * (pulse * (1 - damping) + smooth * damping)
  );
}

export function contrastField(
  s: SimulationState,
  side: "LCA" | "RCA",
  delay: number,
) {
  let opacity = 0,
    front = 0;
  for (const b of [...s.bolusHistory, ...(s.bolus ? [s.bolus] : [])]) {
    if (b.side !== side) continue;
    const c = contrastAt(b, s.time, delay);
    opacity = 1 - (1 - opacity) * (1 - c.opacity);
    if (c.opacity > 0) front = Math.max(front, c.front);
  }
  return { opacity, front };
}
