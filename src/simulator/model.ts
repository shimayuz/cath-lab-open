import { message } from "../i18n/messages";
import type { Message } from "../i18n/messages";
import vmr from "./vmr.json";
export type Access = "radial" | "femoral";
export type Coronary = "LCA" | "RCA";
export type Catheter = "JL" | "JR" | "AL";
export type Instrument = "wire" | "catheter";
export type Vec3 = [number, number, number];
export interface DeviceDefinition {
  id: string;
  label: Message | string;
  kind: "wire" | "diagnostic" | "balloon" | "stent" | "microcatheter";
  available: boolean;
  diameterInch?: number;
  supportedTargets?: readonly Coronary[];
}
export const DEVICES: readonly DeviceDefinition[] = [
  {
    id: "wire035",
    label: message("0.035″ J型ガイドワイヤー"),
    kind: "wire",
    available: true,
    diameterInch: 0.035,
  },
  {
    id: "JL",
    label: "Judkins left",
    kind: "diagnostic",
    available: true,
    supportedTargets: ["LCA"],
  },
  {
    id: "JR",
    label: "Judkins right",
    kind: "diagnostic",
    available: true,
    supportedTargets: ["RCA"],
  },
  {
    id: "AL",
    label: "Amplatz left",
    kind: "diagnostic",
    available: true,
    supportedTargets: ["LCA", "RCA"],
  },
  {
    id: "wire014",
    label: message("0.014″ PCIワイヤー"),
    kind: "wire",
    available: false,
    diameterInch: 0.014,
  },
  {
    id: "balloon",
    label: message("バルーン"),
    kind: "balloon",
    available: false,
  },
  {
    id: "des",
    label: message("薬剤溶出性ステント（DES）"),
    kind: "stent",
    available: false,
  },
  {
    id: "micro",
    label: message("マイクロカテーテル"),
    kind: "microcatheter",
    available: false,
  },
];
export const ROOT: Vec3 = [-0.35, 1.2, 0];
export const OSTIA: Record<Coronary, Vec3> = {
  LCA: vmr.ostia.LCA as Vec3,
  RCA: vmr.ostia.RCA as Vec3,
};
export const CATHETER_PHASE: Record<Catheter, number> = {
  JL: 30,
  JR: 60,
  AL: 65,
};
export interface RootContact {
  side: Coronary;
  capturedAt: number;
  seatAt: number | null;
  bottomAt?: number;
}
export interface SimulationState {
  access: Access;
  target: Coronary;
  catheterType: Catheter;
  active: Instrument;
  wire: number;
  catheter: number;
  rotation: number;
  imaged: Coronary[];
  injectionId: number;
  injectionTarget: Coronary | null;
  root: RootContact | null;
  kickbackCount: number;
  time: number;
  stableFor: number;
  contrastVolume: number;
  contrastDuration: number;
  contrastTotal: number;
  bolus: Bolus | null;
  bolusHistory: Bolus[];
  message: Message;
}
export interface Bolus {
  side: Coronary;
  start: number;
  volume: number;
  duration: number;
  delivered: number;
  stopped: boolean;
}
export const initialState: SimulationState = {
  access: "radial",
  target: "LCA",
  catheterType: "JL",
  active: "wire",
  wire: 0,
  catheter: 0,
  rotation: 0,
  imaged: [],
  injectionId: 0,
  injectionTarget: null,
  root: null,
  kickbackCount: 0,
  time: 0,
  stableFor: 0,
  contrastVolume: 6,
  contrastDuration: 2,
  contrastTotal: 0,
  bolus: null,
  bolusHistory: [],
  message: message(
    "ワイヤーを選んでPush。右橈骨動脈から心臓への経路をたどります。",
  ),
};
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function wrapAngle(deg: number) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
export function distalIsFree(s: SimulationState) {
  return s.catheter >= 82 && s.wire <= s.catheter - 14;
}
// Axes are measured from the source centerlines; thresholds below are teaching parameters.
const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return v.map((x) => x / Math.max(n, 1e-9)) as Vec3;
};
const dot = (a: Vec3, b: Vec3) => a.reduce((n, x, i) => n + x * b[i], 0);
export const OSTIAL_AXES = Object.fromEntries(
  (["LCA", "RCA"] as const).map((side) => {
    const b = vmr.branches.find(
      (b) => b.name === (side === "LCA" ? "LAD" : "RCA"),
    )!;
    return [side, norm(b.points[2].map((x, i) => x - OSTIA[side][i]) as Vec3)];
  }),
) as Record<Coronary, Vec3>;
export function ostialRotation(s: SimulationState, side: Coronary) {
  return wrapAngle(
    (Math.atan2(OSTIA[side][2] - ROOT[2], OSTIA[side][0] - ROOT[0]) * 180) /
      Math.PI -
      CATHETER_PHASE[s.catheterType],
  );
}
export function dropRotation(s: SimulationState) {
  return wrapAngle(desiredRotation(s) + (s.target === "LCA" ? 16 : -16));
}
// Longitudinal direction of the measured aortic root, not the world's vertical axis.
export const AORTIC_AXIS = norm(
  vmr.aorta[12].map((x, i) => x - vmr.aorta[0][i]) as Vec3,
);
export const CUSP_BOTTOM_INSERTION = 96;
export const OSTIAL_INSERTION = 93;
// Shared basal level from the measured aortic centerline; the two ostia are at different heights.
export const CUSP_FLOOR = dot(
  vmr.aorta[0].map((x, i) => x - ROOT[i]) as Vec3,
  AORTIC_AXIS,
);
function aroundRoot(v: Vec3, degrees: number): Vec3 {
  // Positive hand input is clockwise viewed from the proximal aorta.
  const a = (-degrees * Math.PI) / 180,
    c = Math.cos(a),
    sn = Math.sin(a),
    n = AORTIC_AXIS;
  const cross: Vec3 = [
    n[1] * v[2] - n[2] * v[1],
    n[2] * v[0] - n[0] * v[2],
    n[0] * v[1] - n[1] * v[0],
  ];
  return v.map(
    (x, i) => x * c + cross[i] * sn + n[i] * dot(n, v) * (1 - c),
  ) as Vec3;
}
function sinusTip(side: Coronary, error: number, insertion: number): Vec3 {
  const fromRoot = OSTIA[side].map((x, i) => x - ROOT[i]) as Vec3;
  const height = dot(fromRoot, AORTIC_AXIS);
  const radial = fromRoot.map((x, i) => x - AORTIC_AXIS[i] * height) as Vec3;
  const drop = clamp((insertion - OSTIAL_INSERTION) / 3, 0, 1);
  const turned = aroundRoot(
    radial.map((x) => x * (1 - 0.1 * drop)) as Vec3,
    error,
  );
  const axial =
    ((OSTIAL_INSERTION - Math.min(CUSP_BOTTOM_INSERTION, insertion)) *
      (height - CUSP_FLOOR)) /
    3;
  return ROOT.map(
    (x, i) => x + turned[i] + AORTIC_AXIS[i] * (height + axial),
  ) as Vec3;
}
export function cuspBottom(side: Coronary): Vec3 {
  return sinusTip(side, side === "LCA" ? 16 : -16, CUSP_BOTTOM_INSERTION);
}
export function rootManeuver(s: SimulationState) {
  if (s.root?.seatAt != null) return "engaged" as const;
  if (!s.root) return "approach" as const;
  if (s.root.capturedAt < CUSP_BOTTOM_INSERTION - 0.01)
    return "descending" as const;
  return s.catheter >= CUSP_BOTTOM_INSERTION - 0.01
    ? ("bottom" as const)
    : ("lifting" as const);
}
export function catheterPose(s: SimulationState) {
  const errors = (["LCA", "RCA"] as const).map((side) =>
    wrapAngle(s.rotation - ostialRotation(s, side)),
  );
  const distances = errors.map(Math.abs);
  const nearest: Coronary = distances[0] < distances[1] ? "LCA" : "RCA";
  // A flat region around either sinus preserves continuity when its support is acquired.
  const blend = clamp(
    (distances[0] - 30) / Math.max(1e-9, distances[0] + distances[1] - 60),
    0,
    1,
  );
  const weight = blend * blend * (3 - 2 * blend);
  const side = s.root?.side ?? nearest,
    axis = OSTIAL_AXES[side];
  const rawError = wrapAngle(s.rotation - ostialRotation(s, side));
  const seated = s.root?.seatAt != null;
  // A sinus constrains the free tip until the catheter is lifted above it.
  const blockedByCusp = !!s.root && !seated && Math.abs(rawError) > 50;
  const error = s.root && !seated ? clamp(rawError, -50, 50) : rawError;
  const perpendicular = norm(
    Math.abs(axis[1]) < 0.9 ? [axis[2], 0, -axis[0]] : [0, -axis[2], axis[1]],
  );
  let tip: Vec3;
  if (seated) {
    const depth = (s.catheter - s.root!.seatAt!) * 0.05;
    tip = OSTIA[side].map(
      (x, i) =>
        x +
        axis[i] * depth +
        perpendicular[i] * Math.sin((error * Math.PI) / 180) * 0.28,
    ) as Vec3;
  } else {
    if (s.root) tip = sinusTip(side, error, s.catheter);
    else {
      const left = sinusTip("LCA", errors[0], s.catheter),
        right = sinusTip("RCA", errors[1], s.catheter);
      tip = left.map((x, i) => x * (1 - weight) + right[i] * weight) as Vec3;
    }
    if (!s.root && s.catheter < 94) {
      const fromRoot = tip.map((x, i) => x - ROOT[i]) as Vec3;
      const height = dot(fromRoot, AORTIC_AXIS);
      const radial = norm(
        fromRoot.map((x, i) => x - AORTIC_AXIS[i] * height) as Vec3,
      );
      const inset = 0.08 * clamp((94 - s.catheter) / 2, 0, 1);
      tip = tip.map((x, i) => x - radial[i] * inset) as Vec3;
    }
  }
  const direction = (which: Coronary, err: number): Vec3 => {
    const oa = OSTIAL_AXES[which];
    if (s.catheterType === "JL") return aroundRoot(oa, err);
    const perpendicular = norm(
      Math.abs(oa[1]) < 0.9 ? [oa[2], 0, -oa[0]] : [0, -oa[2], oa[1]],
    );
    const a = (err * 4 * Math.PI) / 180;
    return norm(
      oa.map(
        (x, i) => x * Math.cos(a) + perpendicular[i] * Math.sin(a),
      ) as Vec3,
    );
  };
  const leftHeading = direction("LCA", errors[0]),
    rightHeading = direction("RCA", errors[1]);
  const heading = s.root
    ? direction(side, error)
    : norm(
        leftHeading.map(
          (x, i) => x * (1 - weight) + rightHeading[i] * weight,
        ) as Vec3,
      );
  const supportStrength = s.root
    ? (seated ? 1 : clamp((s.root.capturedAt - 94) / 2, 0, 1)) *
      clamp((s.catheter - 91.5) / 1.5, 0, 1)
    : 0;
  const compression = supportStrength * clamp((s.catheter - 91) / 5, 0, 1);
  const fromRoot = OSTIA[side].map((x, i) => x - ROOT[i]) as Vec3;
  const height = dot(fromRoot, AORTIC_AXIS);
  const radial = norm(
    fromRoot.map((x, i) => x - AORTIC_AXIS[i] * height) as Vec3,
  );
  const supportPoint = ROOT.map(
    (x, i) => x - radial[i] * 0.42 + AORTIC_AXIS[i] * (height + 0.55),
  ) as Vec3;
  return {
    tip,
    heading,
    side,
    axis,
    error,
    blockedByCusp,
    compression,
    supportStrength,
    supportPoint,
  };
}
export function tipPosition(s: SimulationState): Vec3 {
  return catheterPose(s).tip;
}
export function engagement(s: SimulationState) {
  const p = catheterPose(s),
    v = p.tip.map((x, i) => x - OSTIA[p.side][i]) as Vec3;
  const depth = dot(v, p.axis);
  const offset = Math.sqrt(Math.max(0, dot(v, v) - depth * depth));
  const angle =
    (Math.acos(clamp(dot(p.heading, p.axis), -1, 1)) * 180) / Math.PI;
  const near = distalIsFree(s) && Math.hypot(...v) < 0.38;
  const ostialApproach =
    near && (s.root?.seatAt != null || Math.hypot(...v) < 0.12);
  const wallContact =
    ostialApproach && depth > -0.04 && (offset > 0.065 || angle > 24);
  const deep = s.root?.seatAt != null && near && depth > 0.085;
  const damping = near
    ? clamp(
        (deep ? (depth - 0.07) * 6 + 0.25 : 0) + (wallContact ? 0.65 : 0),
        0,
        0.95,
      )
    : 0;
  const support = clamp(
    (s.root ? { JL: 0.88, JR: 0.82, AL: 0.95 }[s.catheterType] : 0.2) *
      (1 - angle / 60 - offset * 2 - Math.abs(depth) * 1.5),
    0,
    1,
  );
  const seated =
    s.root?.seatAt != null &&
    near &&
    angle < 18 &&
    offset < 0.055 &&
    depth >= -0.065 &&
    depth <= 0.075 &&
    !wallContact &&
    !deep &&
    support >= 0.45;
  return {
    ...p,
    depth,
    offset,
    angle,
    near,
    wallContact,
    deep,
    damping,
    support,
    seated,
  };
}
export function targetDistance(s: SimulationState) {
  const tip = tipPosition(s),
    ostium = OSTIA[s.target];
  return Math.hypot(...tip.map((v, i) => v - ostium[i]));
}
export function supportsTarget(s: SimulationState) {
  return (
    DEVICES.find((d) => d.id === s.catheterType)?.supportedTargets?.includes(
      s.target,
    ) ?? false
  );
}
export function isEngaged(s: SimulationState) {
  const e = engagement(s);
  return e.seated && e.side === s.target && supportsTarget(s);
}
export function wireIsWithdrawn(s: SimulationState) {
  return s.wire === 0;
}
// Never round a nonzero wire remainder to a displayed zero.
export function wireInsertionLabel(wire: number) {
  return wire > 0 && wire < 0.1 ? "<0.1" : wire.toFixed(1);
}
export function canInject(s: SimulationState) {
  return (
    isEngaged(s) &&
    wireIsWithdrawn(s) &&
    s.stableFor >= 0.6 &&
    (!s.bolus || s.bolus.stopped)
  );
}
export function stage(s: SimulationState): number {
  if (s.imaged.includes(s.target)) return 4;
  if (isEngaged(s)) return 3;
  if (distalIsFree(s)) return 2;
  if (s.wire >= 96 || s.catheter > 0) return 1;
  return 0;
}
export function desiredRotation(s: SimulationState) {
  return wrapAngle(
    (Math.atan2(OSTIA[s.target][2] - ROOT[2], OSTIA[s.target][0] - ROOT[0]) *
      180) /
      Math.PI -
      CATHETER_PHASE[s.catheterType],
  );
}
export function hint(s: SimulationState) {
  if (s.imaged.length === 2)
    return message(
      "左右の冠動脈を造影できました。視点やアプローチを変えて、もう一度たどってみましょう。",
    );
  if (!supportsTarget(s))
    return message(
      "{0}の基本コースには{1}、形状比較にはALを選びます。カテーテル交換で挿入状態をリセットします。",
      s.target,
      s.target === "LCA" ? "JL" : "JR",
    );
  if (s.catheter < 82)
    return s.wire < 96
      ? message("ワイヤーを先行させます。PushでAoまで進めてみましょう。")
      : message("次はカテーテルを選択。ワイヤーに沿ってAoまで進めます。");
  if (!distalIsFree(s))
    return message(
      "ワイヤーをPullしてカテーテルの先端形状を戻します。造影前にはワイヤーを完全に引き抜きます。",
    );
  const e = engagement(s);
  if (e.damping > 0)
    return message(
      "圧がdampingしています。注入せず、少しPullして深さ・同軸性を見直します。",
    );
  if (isEngaged(s))
    return s.wire > 0
      ? message("入口に合っています。造影前にワイヤーを完全に抜きます。")
      : s.stableFor < 0.6
        ? message("先端が入口に収まりました。手を止めて圧と支持を確認します。")
        : message("Engageできました。圧波形と支持を確認して造影します。");
  if (e.blockedByCusp || (s.root && s.root.side !== s.target))
    return message(
      "冠尖を越える前に少しPullして引き上げます。宙に浮いたら、反対側へ回します。",
    );
  if (!s.root) {
    if (s.catheter > 93)
      return message(
        "少しPullして冠尖の上へ。先端を入口側へ向けてから、Pushで冠尖へ落とします。",
      );
    const delta = wrapAngle(dropRotation(s) - s.rotation);
    if (Math.abs(wrapAngle(desiredRotation(s) - s.rotation)) > 30)
      return message(
        "{0}に回し、{1}冠尖へ先端を向けます。",
        delta >= 0 ? message("時計回り") : message("反時計回り"),
        s.target === "LCA" ? message("左") : message("右"),
      );
    return message(
      "ゆっくりPushして{0}冠尖へ落とし、カーブを支えます。",
      s.target === "LCA" ? message("左") : message("右"),
    );
  }
  if (rootManeuver(s) === "descending")
    return message(
      "入口へ先端の向きと高さを合わせます。Bottomへの到達は必須ではありません。",
    );
  if (s.root.seatAt != null)
    return message(
      "入口への向きがずれています。少し回し、同軸性と圧波形を確認します。",
    );
  return s.target === "LCA"
    ? message(
        "左冠尖に落ちました。少しずつPullしながら反時計回りへ。後ろ上方の入口を捉えます。",
      )
    : message(
        "右冠尖に落ちました。少しずつPullしながら時計回りへ。先端と入口の向きを合わせます。",
      );
}
export type Action =
  | { type: "move"; delta: number; instrument?: Instrument }
  | { type: "rotate"; delta: number; instrument?: Instrument }
  | { type: "select"; instrument: Instrument }
  | { type: "catheter"; value: Catheter }
  | { type: "access"; value: Access }
  | { type: "target"; value: Coronary }
  | { type: "inject" }
  | { type: "withdrawWire" }
  | { type: "tick"; dt: number }
  | { type: "contrast"; volume?: number; duration?: number }
  | { type: "handMotion"; push: number; rotation: number }
  | { type: "stopInjection" }
  | { type: "reset" };
function reduceState(s: SimulationState, a: Action): SimulationState {
  if (a.type === "withdrawWire") {
    if (wireIsWithdrawn(s)) return s;
    // An explicit full removal, not a relaxed injection threshold. Preserve the
    // catheter and selection; the next hand stroke must not silently move it.
    const held =
      s.bolus && !s.bolus.stopped
        ? reduceState(s, { type: "stopInjection" })
        : s;
    return resolveRoot({
      ...held,
      wire: 0,
      stableFor: 0,
      injectionTarget: null,
      message: message(
        "ワイヤーの抜去が完了しました。カテーテルの位置は保持しています。",
      ),
    });
  }

  if (a.type === "contrast")
    return {
      ...s,
      contrastVolume: Number.isFinite(a.volume)
        ? clamp(a.volume!, 2, 12)
        : s.contrastVolume,
      contrastDuration: Number.isFinite(a.duration)
        ? clamp(a.duration!, 1, 4)
        : s.contrastDuration,
    };
  if (a.type === "stopInjection")
    return s.bolus
      ? {
          ...s,
          bolus: {
            ...s.bolus,
            stopped: true,
            duration: Math.max(0.01, s.time - s.bolus.start),
            volume: s.bolus.delivered,
          },
          message: message(
            "注入を止めました。流入済みの造影剤は洗い出されます。",
          ),
        }
      : s;
  if (a.type === "tick") {
    if (!Number.isFinite(a.dt) || a.dt <= 0) return s;
    const dt = a.dt,
      time = s.time + dt;
    const stableFor = isEngaged(s) ? Math.min(2, s.stableFor + dt) : 0;
    let bolus = s.bolus,
      contrastTotal = s.contrastTotal,
      imaged = s.imaged;
    let root = s.root,
      catheter = s.catheter,
      kickbackCount = s.kickbackCount;
    let kicked = false;
    if (bolus && !bolus.stopped) {
      const rate = bolus.volume / bolus.duration;
      const overload = engagement(s).support < 0.25 + rate * 0.085;
      const eventTime = bolus.start + 0.35;
      const endTime = overload ? Math.min(time, eventTime) : time;
      const delivered = Math.min(
        bolus.volume,
        Math.max(0, endTime - bolus.start) * rate,
      );
      contrastTotal += delivered - bolus.delivered;
      kicked = overload && time >= eventTime;
      const stopped = kicked || time - bolus.start >= bolus.duration;
      bolus = {
        ...bolus,
        delivered,
        stopped,
        ...(kicked ? { duration: 0.35, volume: delivered } : {}),
      };
      if (kicked) {
        catheter = Math.max(82, (s.root?.seatAt ?? s.catheter) - 3);
        root = null;
        kickbackCount++;
      }
      if (stopped && !kicked && !imaged.includes(bolus.side))
        imaged = [...imaged, bolus.side];
    }
    return {
      ...s,
      time,
      root,
      catheter,
      kickbackCount,
      stableFor: kicked ? 0 : stableFor,
      bolus,
      contrastTotal,
      imaged,
      message: kicked
        ? message(
            "造影の押し返しでカテーテルが外れました。注入を止めました。入口の向きと大動脈壁の支えを見直します。",
          )
        : s.bolus && !s.bolus.stopped && bolus?.stopped
          ? message(
              "{0}の注入を終えました。流入と洗い出しを観察できます。",
              bolus.side,
            )
          : s.message,
    };
  }

  if (a.type === "reset")
    return {
      ...initialState,
      access: s.access,
      message: message("新しい体験を始めます。ワイヤーをPushしてみましょう。"),
    };
  if (a.type === "select") return { ...s, active: a.instrument };
  if (a.type === "access")
    return {
      ...initialState,
      access: a.value,
      message: message("アプローチを変更しました。穿刺部位から始めます。"),
    };
  if (a.type === "target")
    return {
      ...s,
      target: a.value,
      injectionTarget: null,
      message: message(
        "{0}を選択しました。使用するカテーテルを確認しましょう。",
        a.value,
      ),
    };
  if (a.type === "catheter")
    return {
      ...s,
      catheterType: a.value,
      root: null,
      catheter: 0,
      wire: 0,
      rotation: 0,
      stableFor: 0,
      active: "wire",
      injectionTarget: null,
      message: message(
        "{0}に交換しました。練習用にワイヤーとカテーテルを体外へ戻しました。",
        a.value,
      ),
    };
  if (a.type === "rotate") {
    if (!Number.isFinite(a.delta)) return s;
    if ((a.instrument ?? s.active) === "wire")
      return {
        ...s,
        message: message(
          "0.035″ワイヤーはJ型先端とAo内のたわみを表示します。回旋はカテーテルを選んで操作します。",
        ),
      };
    return {
      ...s,
      stableFor: 0,
      rotation: wrapAngle(s.rotation + clamp(a.delta, -30, 30)),
      injectionTarget: null,
    };
  }
  if (a.type === "move") {
    if (!Number.isFinite(a.delta)) return s;
    const delta = clamp(a.delta, -10, 10);
    if ((a.instrument ?? s.active) === "wire") {
      // The diagnostic wire follows the access route and never enters a coronary branch.
      return {
        ...s,
        stableFor: 0,
        wire:
          Math.abs(s.wire + delta) < 1e-9 ? 0 : clamp(s.wire + delta, 0, 100),
        injectionTarget: null,
        message:
          delta > 0
            ? s.wire + delta >= 89
              ? message(
                  "Ao内でワイヤーのたわみ・ループが広がります。離すとその形を保持します。",
                )
              : message("J型先端のワイヤーを進めています。")
            : s.wire + delta <= 1e-9
              ? message(
                  "ワイヤーの抜去が完了しました。カテーテルの位置は保持しています。",
                )
              : s.wire > 88
                ? message("ワイヤーを引き、Ao内のループをほどいています。")
                : message("ワイヤーを引いています。"),
      };
    }
    let maximum = Math.max(0, s.wire - 2);
    // Once in the aortic root and the wire is withdrawn, allow local engagement motion.
    if (distalIsFree(s)) maximum = 98;
    if (delta > 0 && s.catheter + delta > maximum) {
      return {
        ...s,
        stableFor: 0,
        catheter: Math.max(s.catheter, maximum),
        injectionTarget: null,
        message:
          maximum < 82
            ? message(
                "先にワイヤーを進めてください。カテーテルの先行を止めました。",
              )
            : message("Aoに到達しました。ワイヤーを引き、先端を形成します。"),
      };
    }
    return {
      ...s,
      stableFor: 0,
      catheter: clamp(s.catheter + delta, 0, 98),
      injectionTarget: null,
      message:
        delta > 0
          ? message("カテーテルをPush。")
          : message("カテーテルをPull。"),
    };
  }
  if (a.type === "inject") {
    if (!canInject(s))
      return {
        ...s,
        message:
          s.wire > 0
            ? message("造影の前にワイヤーを完全に引き抜いてください。")
            : message("先端の位置と向きを冠動脈の入口に合わせてください。"),
      };
    return {
      ...s,
      injectionId: s.injectionId + 1,
      injectionTarget: s.target,
      bolusHistory: [...s.bolusHistory, ...(s.bolus ? [s.bolus] : [])]
        .filter((b) => s.time - b.start < b.duration + 8)
        .slice(-8),
      bolus: {
        side: s.target,
        start: s.time,
        volume: s.contrastVolume,
        duration: s.contrastDuration,
        delivered: 0,
        stopped: false,
      },
      message: message("{0}に造影剤を注入しています。", s.target),
    };
  }
  return s;
}

function resolveRoot(s: SimulationState): SimulationState {
  if (!distalIsFree(s)) return s.root ? { ...s, root: null } : s;
  if (s.root && s.catheter < 91.5) return { ...s, root: null };
  if (!s.root) {
    const p = catheterPose(s);
    if (s.catheter >= 94 && Math.abs(p.error) <= 30)
      return {
        ...s,
        root: {
          side: p.side,
          capturedAt: s.catheter,
          seatAt: null,
          ...(s.catheter >= CUSP_BOTTOM_INSERTION ? { bottomAt: s.time } : {}),
        },
      };
    return s;
  }
  if (s.catheter > s.root.capturedAt)
    s = {
      ...s,
      root: {
        ...s.root,
        capturedAt: s.catheter,
        ...(s.root.bottomAt == null && s.catheter >= CUSP_BOTTOM_INSERTION
          ? { bottomAt: s.time }
          : {}),
      },
    };
  const contact = s.root!;
  const p = catheterPose(s);
  if (contact.seatAt != null) {
    if ((s.catheter - contact.seatAt) * 0.05 < -0.11 || Math.abs(p.error) > 28)
      return { ...s, root: { ...contact, seatAt: null } };
    return s;
  }
  const distance = Math.hypot(...p.tip.map((x, i) => x - OSTIA[p.side][i]));
  const e = engagement(s);
  // Small passive seating allowance for the matching Judkins curve. These are
  // teaching model coordinates, not calibrated catheter stiffness or millimetres.
  // Keep the original angular limit and all post-seating injection checks.
  const judkins =
    (s.catheterType === "JL" || s.catheterType === "JR") &&
    supportsTarget(s) &&
    contact.side === s.target;
  const insertionMargin = judkins ? 0.1 : 0.025;
  const captureDistance = judkins ? 0.035 : 0.02;
  if (
    s.catheter <= OSTIAL_INSERTION + insertionMargin &&
    Math.abs(p.error) < 4.5 &&
    distance < captureDistance &&
    e.angle < 18 &&
    !e.wallContact &&
    e.support >= 0.45
  )
    return {
      ...s,
      root: { ...contact, seatAt: s.catheter },
      stableFor: 0,
      message: message(
        "{0}の入口を捉えました。圧とカテーテルの支えを確認します。",
        contact.side,
      ),
    };
  return s;
}
/** Resolve contact along a commanded path, not just at camera frame endpoints.
 * Uses the same capture tolerances as endpoint contact. The final command is still applied,
 * including withdrawal, misalignment and loss of support after contact.
 */
function resolveRootPath(
  previous: SimulationState,
  next: SimulationState,
): SimulationState {
  const endpoint = resolveRoot(next);
  if (
    !previous.root ||
    previous.root.seatAt != null ||
    !distalIsFree(previous) ||
    !distalIsFree(next) ||
    endpoint.root?.seatAt != null
  )
    return endpoint;
  const travel = next.catheter - previous.catheter;
  const turn = wrapAngle(next.rotation - previous.rotation);
  const steps = Math.ceil(
    Math.max(Math.abs(travel) / 0.025, Math.abs(turn) / 0.25),
  );
  for (let i = 1; i < steps; i++) {
    const contact = resolveRoot({
      ...previous,
      catheter: previous.catheter + (travel * i) / steps,
      wire: previous.wire + ((next.wire - previous.wire) * i) / steps,
      rotation: wrapAngle(previous.rotation + (turn * i) / steps),
    });
    if (contact.root?.seatAt != null)
      return resolveRoot({
        ...next,
        root: contact.root,
        message: contact.message,
      });
  }
  return endpoint;
}
export function reducer(s: SimulationState, a: Action): SimulationState {
  if (a.type === "handMotion") {
    if (
      ![a.push, a.rotation].every(
        (x) => Number.isFinite(x) && Math.abs(x) <= 100,
      )
    )
      return s;
    const count = Math.ceil(
      Math.max(Math.abs(a.push) / 10, Math.abs(a.rotation) / 30),
    );
    // A camera frame is one simultaneous motion, not a move-then-turn staircase.
    // Split proportionally within this dispatch to retain reducer action limits.
    const advance = (state: SimulationState) => {
      const moved = a.push
        ? reduceState(state, { type: "move", delta: a.push / count })
        : state;
      return a.rotation && moved.catheter > 0
        ? reduceState(moved, {
            type: "rotate",
            delta: a.rotation / count,
            instrument: "catheter",
          })
        : moved;
    };
    let current = s;
    for (let i = 0; i < count; i++) {
      let next = advance(current);
      if (
        next.wire === current.wire &&
        next.catheter === current.catheter &&
        next.rotation === current.rotation
      ) {
        current = {
          ...next,
          stableFor: current.stableFor,
          injectionTarget: current.injectionTarget,
        };
        continue;
      }
      if (current.bolus && !current.bolus.stopped)
        next = advance(reduceState(current, { type: "stopInjection" }));
      current = resolveRootPath(current, next);
    }
    return current;
  }
  const next = reduceState(s, a);
  if (a.type === "move" || a.type === "rotate") {
    const changed =
      next.wire !== s.wire ||
      next.catheter !== s.catheter ||
      next.rotation !== s.rotation;
    if (next === s) return s;
    if (!changed)
      return {
        ...next,
        stableFor: s.stableFor,
        injectionTarget: s.injectionTarget,
      };
    if (s.bolus && !s.bolus.stopped)
      return resolveRootPath(
        s,
        reduceState(reduceState(s, { type: "stopInjection" }), a),
      );
  }
  if (a.type === "catheter" && s.bolus && !s.bolus.stopped)
    return reduceState(reduceState(s, { type: "stopInjection" }), a);
  return a.type === "move" || a.type === "rotate"
    ? resolveRootPath(s, next)
    : next;
}
