import { WireControl } from "./WireControl";
import { wireInsertionLabel } from "../simulator/model";
import { rotationInputHand, type RotationMode } from "../hand/rotation";
import { HandMeasurementPanel } from "./HandMeasurementPanel";
import { HandMeasurements } from "../hand/measurements";
import { JevPanel } from "./JevPanel";
import { useJevAssist } from "../hand/useJevAssist";
import { message } from "../i18n/messages";
import type { Message } from "../i18n/messages";
import { useI18n } from "../i18n/I18n";
import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Hand, RotateCcw } from "lucide-react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { HAND_CONNECTIONS } from "../hand/gesture";
import { readHandPair, cameraHandCategories } from "../hand/bimanual";
import { BimanualClutch } from "../hand/clutch";
import {
  cameraPushDelta,
  cameraRotationDelta,
  fineCatheterControl,
} from "../hand/control";
import type { PushAxis, ClutchPhase } from "../hand/clutch";
import type { HandPair } from "../hand/bimanual";
import type { Action, SimulationState } from "../simulator/model";
interface Props {
  onAction: (action: Action) => void;
  paused: boolean;
  contextKey: string;
  wireRemovalEpoch: number;
  simulation: SimulationState;
}
export function HandCamera({
  onAction,
  paused,
  contextKey,
  wireRemovalEpoch,
  simulation,
}: Props) {
  const { t, format } = useI18n();
  const jev = useJevAssist();
  const [measurements] = useState(() => new HandMeasurements());
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [reviewingMeasurements, setReviewingMeasurements] = useState(false);
  const measurementLastUpdate = useRef(0);
  function finishMeasurement(reason: "camera" | "settings" | "hidden") {
    measurements.stop(reason);
    setMeasurementRevision((v) => v + 1);
  }
  const [rate, setRate] = useState(30);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const simulationRef = useRef(simulation);
  simulationRef.current = simulation;
  const [metrics, setMetrics] = useState<{
    detectionMs: number;
    fps: number;
  } | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const video = useRef<HTMLVideoElement>(null),
    overlay = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null),
    tracker = useRef<HandLandmarker | null>(null),
    frame = useRef(0),
    generation = useRef(0);
  const previous = useRef<HandPair | null>(null);
  const removalEpoch = useRef(wireRemovalEpoch);
  const needsRelease = useRef([false, false]);
  useEffect(() => {
    if (removalEpoch.current !== wireRemovalEpoch) {
      removalEpoch.current = wireRemovalEpoch;
      needsRelease.current = [true, true];
    }
  }, [wireRemovalEpoch]);
  const clutch = useRef(new BimanualClutch());
  const [motion, setMotion] = useState({
    push: 0,
    rotation: 0,
    pushPhase: "released" as ClutchPhase,
    rotationPhase: "released" as ClutchPhase,
    returning: false,
  });
  function resetMotion() {
    previous.current = null;
    clutch.current.reset();
    jev.assist.reset();
  }
  const pausedRef = useRef(paused);
  pausedRef.current = paused || reviewingMeasurements;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const [status, setStatus] = useState<"off" | "loading" | "ready" | "error">(
    "off",
  );
  const [error, setError] = useState<Message | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [fingerRotationAvailable, setFingerRotationAvailable] = useState(false);
  const [tracked, setTracked] = useState(0),
    [fingers, setFingers] = useState<(number[] | null)[]>([]);
  const [gain, setGain] = useState(1),
    [reverse, setReverse] = useState(false);
  const [swapRoles, setSwapRoles] = useState(false);
  const [pushAxis, setPushAxis] = useState<PushAxis>("left");
  const [rotationMode, setRotationMode] = useState<RotationMode>("fingers");
  const config = useRef({ gain, reverse, swapRoles, pushAxis, rotationMode });
  config.current = { gain, reverse, swapRoles, pushAxis, rotationMode };
  function cleanup() {
    finishMeasurement("camera");
    generation.current++;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    tracker.current?.close();
    tracker.current = null;
    resetMotion();
    if (video.current) video.current.srcObject = null;
  }
  function stop() {
    cleanup();
    setStatus("off");
    setMetrics(null);
    setTracked(0);
    setFingers([]);
    overlay.current?.getContext("2d")?.clearRect(0, 0, 640, 480);
  }
  useEffect(() => () => cleanup(), []);
  useEffect(() => {
    resetMotion();
    finishMeasurement("settings");
  }, [
    paused,
    reviewingMeasurements,
    contextKey,
    gain,
    reverse,
    swapRoles,
    pushAxis,
    rotationMode,
    rate,
  ]);
  useEffect(() => {
    const reset = () => {
      if (document.hidden) {
        resetMotion();
        finishMeasurement("hidden");
      }
    };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);
  async function start() {
    cleanup();
    const id = generation.current;
    setStatus("loading");
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("camera-unavailable");
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });
      if (id !== generation.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      const { FilesetResolver, HandLandmarker } =
        await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks(
        new URL(`${import.meta.env.BASE_URL}mediapipe/`, document.baseURI).href,
      );
      if (id !== generation.current) return;
      const model = await HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: new URL(
            `${import.meta.env.BASE_URL}models/hand_landmarker.task`,
            document.baseURI,
          ).href,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.65,
        minHandPresenceConfidence: 0.65,
        minTrackingConfidence: 0.65,
      });
      if (id !== generation.current) {
        model.close();
        return;
      }
      tracker.current = model;
      setStatus("ready");
      let last = -1,
        lastTime = 0,
        windowStart = performance.now(),
        sampleCount = 0,
        detectionSum = 0;
      const loop = (time: number) => {
        if (id !== generation.current) return;
        frame.current = requestAnimationFrame(loop);
        if (document.hidden) {
          return;
        }
        if (
          time - lastTime < 1000 / rateRef.current - 1 ||
          !video.current ||
          video.current.readyState < 2 ||
          last === video.current.currentTime
        )
          return;
        last = video.current.currentTime;
        lastTime = time;
        try {
          const started = performance.now();
          const result = model.detectForVideo(video.current, time);
          const detectionMs = performance.now() - started;
          detectionSum += detectionMs;
          sampleCount++;
          if (time - windowStart >= 500) {
            setMetrics({
              detectionMs: detectionSum / sampleCount,
              fps: (sampleCount * 1000) / (time - windowStart),
            });
            windowStart = time;
            sampleCount = 0;
            detectionSum = 0;
          }
          const pair = readHandPair(
            result.landmarks,
            time,
            previous.current,
            cameraHandCategories(result.handedness),
            result.worldLandmarks,
          );
          const ctx = overlay.current?.getContext("2d");
          ctx?.clearRect(0, 0, 640, 480);
          setTracked(result.landmarks.length);
          setAmbiguous(result.landmarks.length > 0 && !pair);
          setFingers(pair ? pair.map((h) => h?.fingers ?? null) : []);
          if (ctx) {
            ctx.lineWidth = 3;
            result.landmarks.forEach((points) => {
              const current = pair?.find((h) => h?.wrist === points[0]);
              const isLeft = current?.identity === "Left";
              ctx.strokeStyle = !current
                ? "#a9b4c0"
                : isLeft
                  ? "#ffc879"
                  : "#5bf2c5";
              ctx.fillStyle = current?.pinch ? ctx.strokeStyle : "#fff";
              for (const [a, b] of HAND_CONNECTIONS) {
                ctx.beginPath();
                ctx.moveTo(points[a].x * 640, points[a].y * 480);
                ctx.lineTo(points[b].x * 640, points[b].y * 480);
                ctx.stroke();
              }
              points.forEach((p, i) => {
                ctx.beginPath();
                ctx.arc(p.x * 640, p.y * 480, i === 0 ? 6 : 3, 0, Math.PI * 2);
                ctx.fill();
              });
              if (current) {
                ctx.font = "bold 20px sans-serif";
                ctx.save();
                ctx.translate(
                  current.wrist.x * 640,
                  current.wrist.y * 480 + 25,
                );
                ctx.scale(-1, 1);
                ctx.fillStyle = ctx.strokeStyle;
                ctx.fillText(
                  current.identity === "Left"
                    ? tRef.current("左手")
                    : tRef.current("右手"),
                  -20,
                  0,
                );
                ctx.restore();
              }
            });
          }
          const rotationSlot = config.current.swapRoles ? 0 : 1;
          const controlPair: HandPair | null = pair ? [...pair] : null;
          if (controlPair)
            controlPair[rotationSlot] = rotationInputHand(
              pair![rotationSlot],
              config.current.rotationMode,
            );
          setFingerRotationAvailable(
            !!pair?.[rotationSlot] &&
              (!pair[rotationSlot]!.pinch ||
                pair[rotationSlot]!.fingerRoll != null),
          );
          // A shortcut must not apply a still-held stroke to the preserved catheter.
          // Each anatomical hand resumes only after an observed opening.
          if (controlPair)
            for (const slot of [0, 1]) {
              if (!needsRelease.current[slot]) continue;
              if (pair?.[slot]?.pinch === false)
                needsRelease.current[slot] = false;
              else controlPair[slot] = null;
            }
          const delta = clutch.current.update(
            controlPair,
            config.current.gain,
            config.current.swapRoles,
            config.current.pushAxis,
            fineCatheterControl(simulationRef.current),
            fineCatheterControl({
              ...simulationRef.current,
              active: "catheter",
            }),
          );
          const rotation = delta.rotation * (config.current.reverse ? -1 : 1);
          if (!pausedRef.current)
            jev.assist.observe(
              {
                push: {
                  grip: delta.pushPhase,
                  movement:
                    delta.push > 0 ? "push" : delta.push < 0 ? "pull" : "still",
                  returning: delta.returning,
                },
                rotation: {
                  grip: delta.rotationPhase,
                  movement:
                    rotation > 0
                      ? "clockwise"
                      : rotation < 0
                        ? "counterclockwise"
                        : "still",
                },
              },
              simulationRef.current.active,
            );
          const applied = jev.assist.filter({ ...delta, rotation });
          setMotion(applied);
          previous.current = pair;
          const commandPush = pausedRef.current
            ? 0
            : cameraPushDelta(simulationRef.current, applied.push);
          const commandRotation = pausedRef.current
            ? 0
            : cameraRotationDelta(simulationRef.current, applied.rotation);
          if (measurements.recording) {
            const pushHand = pair?.[config.current.swapRoles ? 1 : 0];
            const rotationHand = pair?.[config.current.swapRoles ? 0 : 1];
            measurements.capture({
              time,
              detectionMs,
              simulation: simulationRef.current,
              commandPush,
              commandRotation,
              pushHand: {
                position: pushHand
                  ? config.current.pushAxis === "left"
                    ? pushHand.wrist.x
                    : -pushHand.wrist.y
                  : null,
                phase: delta.pushPhase,
              },
              rotationHand: {
                angle:
                  config.current.rotationMode === "fingers"
                    ? rotationHand?.fingerRoll == null
                      ? null
                      : rotationHand.fingerRoll * 100
                    : (rotationHand?.angle ?? null),
                fingerRoll: rotationHand?.fingerRoll ?? null,
                wristAngle: rotationHand?.angle ?? null,
                phase: delta.rotationPhase,
              },
              jev: jev.assist.snapshot(),
            });
            if (
              time - measurementLastUpdate.current >= 200 ||
              !measurements.recording
            ) {
              measurementLastUpdate.current = time;
              setMeasurementRevision((v) => v + 1);
            }
          }
          if (!pausedRef.current) {
            if (commandPush || commandRotation)
              actionRef.current({
                type: "handMotion",
                push: commandPush,
                rotation: commandRotation,
              });
          }
        } catch (e) {
          cleanup();
          setStatus("error");
          setError(
            e instanceof Error
              ? message(
                  "手の認識が停止しました。カメラを再開してください。 ({0})",
                  e.name,
                )
              : message("手の認識が停止しました。カメラを再開してください。"),
          );
        }
      };
      frame.current = requestAnimationFrame(loop);
    } catch (e) {
      if (id !== generation.current) return;
      cleanup();
      setStatus("error");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? message(
              "カメラの使用が許可されませんでした。ブラウザのカメラ設定から許可すると再開できます。画面操作はそのまま使えます。",
            )
          : e instanceof DOMException && e.name === "NotFoundError"
            ? message(
                "カメラが見つかりません。接続を確認してください。画面操作でも体験できます。",
              )
            : e instanceof Error && e.message === "camera-unavailable"
              ? message("カメラにはHTTPSまたはlocalhostが必要です。")
              : message(
                  "カメラを開始できませんでした。画面操作をお使いください。",
                ),
      );
    }
  }
  return (
    <section className="camera-section" aria-label={t("ハンドトラッキング")}>
      <div className="panel-heading">
        <span>
          <Hand size={17} />
          {t("手で操作する")}
        </span>
        <span className={`tiny-status ${tracked ? "live" : ""}`}>
          {status === "loading"
            ? t("準備中")
            : status === "ready"
              ? tracked
                ? t("{0}手・{1}点を追跡中", tracked, tracked * 21)
                : t("操作する手を探しています")
              : t("カメラOFF")}
        </span>
      </div>
      <div className={`camera-preview ${status === "ready" ? "active" : ""}`}>
        <video
          ref={video}
          muted
          playsInline
          aria-label={t("カメラのプレビュー")}
        />
        <canvas ref={overlay} width="640" height="480" />
        {status !== "ready" && (
          <div className="camera-placeholder">
            <Hand size={36} strokeWidth={1.25} />
            <p>
              {t("あなたの手が、")}
              <br />
              {t("カテーテルの操作になる。")}
            </p>
          </div>
        )}
        {status === "ready" && (
          <span className="grip-status">
            {paused
              ? t("一時停止中")
              : ambiguous
                ? t("両手を離し、手のひらを映してください")
                : motion.pushPhase === "regrip"
                  ? t("位置保持中・手を開いて持ち直す")
                  : motion.returning
                    ? t("位置保持中・離してつかみ直す")
                    : motion.push > 0
                      ? t("押し送り中")
                      : motion.push < 0
                        ? t("引き戻し中")
                        : motion.pushPhase === "arming"
                          ? t("新しい握り位置を確認中")
                          : motion.pushPhase === "released"
                            ? t("位置保持中・つかみ直せます")
                            : t("掴んでいます・現在位置を保持")}
          </span>
        )}
      </div>
      <JevPanel jev={jev} rate={rate} onRate={setRate} metrics={metrics} />
      <HandMeasurementPanel
        measurements={measurements}
        revision={measurementRevision}
        ready={status === "ready" && !paused}
        onReviewChange={setReviewingMeasurements}
        settings={{
          gain,
          reverse,
          swapRoles,
          pushAxis,
          rotationMode,
          requestedFps: rate,
        }}
        onChange={() => setMeasurementRevision((v) => v + 1)}
      />
      <div className="regrip-guide">
        <strong>{t("つかむ → 送る → 離して保持 → 持ち直す")}</strong>
        <p aria-label={t("左右の手の役割")}>
          {swapRoles ? t("右手：Push / Pull") : t("左手：Push / Pull")}
          {" · "}
          {rotationMode === "fingers"
            ? swapRoles
              ? t("左手の親指・人差し指：Clock / Counter")
              : t("右手の親指・人差し指：Clock / Counter")
            : swapRoles
              ? t("左手：手首でClock / Counter")
              : t("右手：手首でClock / Counter")}
        </p>
        <label>
          {t("Pushの方向")}
          <select
            aria-label={t("Pushの方向")}
            value={pushAxis}
            onChange={(e) => setPushAxis(e.target.value as PushAxis)}
          >
            <option value="left">{t("← 画面の左へ送る")}</option>
            <option value="up">{t("↑ 画面の上へ送る")}</option>
          </select>
        </label>
        <label>
          {t("回転の入力")}
          <select
            aria-label={t("回転の入力")}
            value={rotationMode}
            onChange={(e) => setRotationMode(e.target.value as RotationMode)}
          >
            <option value="fingers">{t("指先で転がす")}</option>
            <option value="wrist">{t("手首を傾ける")}</option>
          </select>
        </label>
        {rotationMode === "fingers" && (
          <p>
            {t(
              "親指と人差し指でつまみ、指をずらして回します。手全体を動かしても回転しません。指を開くと保持し、つまみ直して続けられます。向きが逆なら「回旋を反転」を選んでください。",
            )}
          </p>
        )}
        {rotationMode === "fingers" &&
          status === "ready" &&
          !fingerRotationAvailable && (
            <p role="status">
              {t(
                "指先を確認できません。親指と人差し指が見える向きにし、一度開いてつまみ直してください。",
              )}
            </p>
          )}
      </div>
      <div className="camera-device" aria-label={t("カメラの操作対象")}>
        <span>{t("操作するデバイス")}</span>
        <div className="camera-device-buttons">
          <button
            disabled={paused}
            aria-pressed={simulation.active === "wire"}
            onClick={() => onAction({ type: "select", instrument: "wire" })}
          >
            {t("ワイヤー")}
          </button>
          <button
            disabled={paused}
            aria-pressed={simulation.active === "catheter"}
            onClick={() => onAction({ type: "select", instrument: "catheter" })}
          >
            {t("カテーテル")}
          </button>
        </div>
        <output aria-label={t("カメラ操作の挿入量")}>
          {simulation.active === "wire" ? t("ワイヤー") : t("カテーテル")}{" "}
          {simulation.active === "wire"
            ? wireInsertionLabel(simulation.wire)
            : simulation.catheter.toFixed(1)}
          % · {simulation.rotation.toFixed(1)}°
        </output>
        <p>{format(simulation.message)}</p>
        <WireControl
          state={simulation}
          disabled={paused || reviewingMeasurements}
          onAction={onAction}
        />
        {fineCatheterControl(simulation) && (
          <p>
            {t(
              "冠尖付近は微調整：押し引きは約1/10、回転は1/2。小さな手ぶれを抑え、指を開くとその場で保持します。",
            )}
          </p>
        )}
        <p>
          {t("回転はカテーテル、Push / Pullは選択中のデバイスを操作します。")}
        </p>
        {status === "ready" && (
          <output aria-label={t("回転入力の状態")}>
            {t("カテーテル回転 {0}°", simulation.rotation.toFixed(1))}
            {" · "}
            {motion.rotationPhase === "gripped"
              ? motion.rotation < 0
                ? "Counter"
                : motion.rotation > 0
                  ? "Clock"
                  : t("回転の動きを待っています")
              : t("親指と人差し指を開いて、つまみ直してください")}
          </output>
        )}
      </div>
      {status === "ready" &&
        fingers.map(
          (hand, side) =>
            hand && (
              <div className="hand-readout" key={side}>
                <span>
                  {side === 0 ? t("左手") : t("右手")} ·{" "}
                  {side === (swapRoles ? 1 : 0) ? t("押し引き") : t("回転")}
                </span>
                <small className="clutch-state">
                  {needsRelease.current[side]
                    ? t("一度開いて、つかみ直してください")
                    : (side === (swapRoles ? 1 : 0)
                          ? motion.pushPhase
                          : motion.rotationPhase) === "gripped"
                      ? t("掴んでいます")
                      : (side === (swapRoles ? 1 : 0)
                            ? motion.pushPhase
                            : motion.rotationPhase) === "arming"
                        ? t("握り位置を確認中")
                        : (side === (swapRoles ? 1 : 0)
                              ? motion.pushPhase
                              : motion.rotationPhase) === "regrip"
                          ? t("一度開いて、つかみ直してください")
                          : t("離しています・位置保持")}
                </small>
                <div className="finger-bars">
                  {[
                    t("親指"),
                    t("人差指"),
                    t("中指"),
                    t("薬指"),
                    t("小指"),
                  ].map((name, i) => (
                    <div key={name}>
                      <i style={{ height: `${7 + hand[i] * 20}px` }} />
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ),
        )}
      {error && (
        <p className="error-text" role="alert">
          {format(error)}
        </p>
      )}
      <button
        className="camera-button"
        onClick={status === "ready" || status === "loading" ? stop : start}
      >
        {status === "ready" || status === "loading" ? (
          <CameraOff size={16} />
        ) : (
          <Camera size={16} />
        )}{" "}
        {status === "ready"
          ? t("カメラを停止")
          : status === "loading"
            ? t("準備をキャンセル")
            : t("カメラで操作を始める")}
      </button>
      <p className="camera-help">
        {t(
          "左手でつかみ、選んだ方向へ動かすとPush、握ったまま反対方向へ動かすとPull。手を離すと位置を保持します。持ち直すときは離してから手を戻し、再びつかんでください。右手は回転を担当します。",
        )}
      </p>
      {status === "ready" && (
        <div className="camera-options">
          <label>
            <input
              type="checkbox"
              checked={swapRoles}
              onChange={(e) => setSwapRoles(e.target.checked)}
            />{" "}
            {t("右手で押し引き・左手で回転（左右を交換）")}
          </label>
          <label>
            {t("感度")}{" "}
            <input
              aria-label={t("手の操作感度")}
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={gain}
              onChange={(e) => setGain(Number(e.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={reverse}
              onChange={(e) => setReverse(e.target.checked)}
            />{" "}
            {t("回旋を反転")}
          </label>
          <button
            onClick={() => {
              resetMotion();
            }}
          >
            <RotateCcw size={13} />
            {t("基準を取り直す")}
          </button>
        </div>
      )}
      <p className="privacy-note">
        {t("映像はこのブラウザ内で処理。録画・送信はしません。")}
        <br />
        {t("単眼カメラでの推定です。実際の移動量・トルクは測れません。")}
      </p>
    </section>
  );
}
