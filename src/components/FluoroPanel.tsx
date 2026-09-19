import { useI18n } from "../i18n/I18n";
import { useEffect, useRef, useState } from "react";
import { ScanLine, Camera, Circle, Square, Play, Pause } from "lucide-react";
import { createPortal } from "react-dom";
import { AnatomyView } from "./AnatomyView";
import {
  defaultImaging,
  projectionCaption,
  FLAT_PANEL_SIZES,
} from "../simulator/imaging";
import type {
  ImagingSettings,
  CapturedFrame,
  Cine,
} from "../simulator/imaging";
import type { SimulationState } from "../simulator/model";
export function FluoroPanel({
  state,
  paused,
  stage,
  visible,
  onShow,
}: {
  state: SimulationState;
  paused: boolean;
  stage: HTMLElement | null;
  visible: boolean;
  onShow: () => void;
}) {
  const { t, locale } = useI18n();
  const [im, setIm] = useState(defaultImaging),
    [stills, setStills] = useState<CapturedFrame[]>([]),
    [clips, setClips] = useState<Cine[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [lightbox, setLightbox] = useState<CapturedFrame | null>(null);
  const captureRendered = useRef<(() => CapturedFrame | null) | null>(null),
    [hold, setHold] = useState<CapturedFrame | null>(null);
  const clip = selected === null ? null : clips[selected];
  useEffect(() => {
    if (!playing || !clip || paused) return;
    const id = setTimeout(
      () => {
        if (frame >= clip.frames.length - 1) {
          setPlaying(false);
          return;
        }
        setFrame(frame + 1);
      },
      Math.max(
        40,
        ((clip.frames[frame + 1]?.time ?? 0) - clip.frames[frame].time) * 1000,
      ),
    );
    return () => clearTimeout(id);
  }, [playing, clip, frame, paused]);
  const patch = (v: Partial<ImagingSettings>) => setIm((s) => ({ ...s, ...v }));
  const slider = (
    label: string,
    key: "yaw" | "pitch" | "zoom" | "width" | "height" | "panX" | "panY",
    min: number,
    max: number,
    step: number,
    value: string,
  ) => (
    <label className="imaging-slider">
      {label}
      <b>{value}</b>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={im[key]}
        onChange={(e) => patch({ [key]: +e.target.value })}
      />
    </label>
  );
  return (
    <section className="fluoro-section">
      <div className="panel-heading">
        <span>
          <ScanLine size={17} />
          {t("透視の操作・撮影")}
        </span>
        <button
          className="show-fluoro"
          aria-label={t("透視を中央に表示")}
          onClick={onShow}
        >
          {visible ? t("中央に表示中") : t("中央で見る")}
        </button>
      </div>
      {stage &&
        createPortal(
          <div className="fluoro-viewport fluoro-main-viewport">
            <AnatomyView
              state={state}
              view="heart"
              projection="AP"
              heartVisible={false}
              fluoro
              visible={visible}
              imaging={im}
              onSnapshotReady={(capture) => {
                captureRendered.current = capture;
              }}
              onCapture={(f) => setStills((s) => [f, ...s].slice(0, 6))}
              onCine={(c) => {
                setClips((s) => [c, ...s].slice(0, 3));
                setSelected(null);
                setPlaying(false);
                patch({ recording: false });
              }}
            />
            {!im.enabled && hold && (
              <img
                className="held-fluoro"
                src={hold.image}
                alt={t("透視OFF時の最終画像")}
              />
            )}
            <span className="fluoro-caption">
              {!im.enabled && hold
                ? projectionCaption(hold.projection, locale)
                : projectionCaption(im, locale)}
            </span>
            <span className="fluoro-side">
              R<span>L</span>
            </span>
            <span className="fluoro-target">
              {im.recording
                ? t("● 撮影中")
                : im.enabled
                  ? state.bolus &&
                    state.time - state.bolus.start < state.bolus.duration + 6
                    ? t("{0} 造影", state.bolus.side)
                    : t("透視 ON")
                  : t("透視 OFF · 最終画像を保持")}
            </span>
          </div>,
          stage,
        )}
      <fieldset className="fpd-controls">
        <legend>{t("Flat panel 視野")}</legend>
        <div className="fpd-sizes">
          {FLAT_PANEL_SIZES.map((size) => (
            <button
              key={size}
              aria-label={`Flat panel ${size} inch`}
              aria-pressed={im.fieldOfViewInch === size}
              onClick={() => patch({ fieldOfViewInch: size })}
            >
              {size}
              <small>inch</small>
            </button>
          ))}
        </div>
        <p>{t("6 inchで拡大、10 inchで広い範囲を表示")}</p>
      </fieldset>
      <div
        className="projection-switch"
        role="group"
        aria-label={t("透視角度")}
      >
        {(["AP", "LAO", "RAO"] as const).map((p) => (
          <button
            key={p}
            aria-pressed={
              im.yaw === (p === "AP" ? 0 : p === "LAO" ? 45 : -30) &&
              im.pitch === 0
            }
            onClick={() =>
              patch({ yaw: p === "AP" ? 0 : p === "LAO" ? 45 : -30, pitch: 0 })
            }
          >
            {p}
            <small>
              {p === "AP" ? t("正面") : p === "LAO" ? "45°" : "30°"}
            </small>
          </button>
        ))}
      </div>
      <div className="imaging-angles">
        {slider(
          "LAO / RAO",
          "yaw",
          -90,
          90,
          1,
          `${im.yaw < 0 ? "RAO" : "LAO"} ${Math.abs(im.yaw)}°`,
        )}
        {slider(
          "CRA / CAU",
          "pitch",
          -45,
          45,
          1,
          `${im.pitch < 0 ? "CAU" : "CRA"} ${Math.abs(im.pitch)}°`,
        )}
      </div>
      <details className="imaging-details">
        <summary>{t("寝台・拡大・絞り")}</summary>
        <div className="imaging-angles">
          {slider(t("寝台 左右"), "panX", -3, 3, 0.1, im.panX.toFixed(1))}
          {slider(t("寝台 上下"), "panY", -3, 3, 0.1, im.panY.toFixed(1))}
          {slider(t("拡大"), "zoom", 1, 2.5, 0.1, `${im.zoom.toFixed(1)}×`)}
          {slider(
            t("左右の絞り"),
            "width",
            0.3,
            1,
            0.05,
            `${Math.round(im.width * 100)}%`,
          )}
          {slider(
            t("上下の絞り"),
            "height",
            0.3,
            1,
            0.05,
            `${Math.round(im.height * 100)}%`,
          )}
        </div>
        <button
          className="text-button"
          onClick={() =>
            patch({ panX: 0, panY: 0, zoom: 1, width: 1, height: 1 })
          }
        >
          {t("寝台・拡大・絞りを戻す")}
        </button>
      </details>
      <div className="capture-controls">
        <button
          aria-pressed={im.enabled}
          onClick={() => {
            if (im.enabled) setHold(captureRendered.current?.() ?? null);
            patch({ enabled: !im.enabled, recording: false });
          }}
        >
          {im.enabled ? t("透視をOFF") : t("透視をON")}
        </button>
        <button
          disabled={!im.enabled || paused}
          onClick={() => patch({ captureId: im.captureId + 1 })}
        >
          <Camera size={14} />
          {t("保存")}
        </button>
        <button
          disabled={!im.enabled || paused}
          aria-pressed={im.recording}
          onClick={() => patch({ recording: !im.recording })}
        >
          {im.recording ? <Square size={12} /> : <Circle size={12} />}{" "}
          {im.recording ? t("撮影終了") : t("撮影開始")}
        </button>
      </div>
      {stills.length > 0 && (
        <div className="stills" aria-label={t("保存画像")}>
          {stills.map((f, i) => (
            <button key={`${f.time}-${i}`} onClick={() => setLightbox(f)}>
              <img
                src={f.image}
                alt={t(
                  "保存画像 {0} {1}",
                  i + 1,
                  projectionCaption(f.projection, locale),
                )}
              />
            </button>
          ))}
        </div>
      )}
      {clips.length > 0 && (
        <div className="cine-library">
          <label>
            {t("撮影を見返す")}
            <select
              aria-label={t("撮影した動画")}
              value={selected ?? ""}
              onChange={(e) => {
                setSelected(e.target.value === "" ? null : +e.target.value);
                setFrame(0);
                setPlaying(false);
              }}
            >
              <option value="">{t("動画を選択")}</option>
              {clips.map((c, i) => (
                <option key={i} value={i}>
                  {t("撮影")} {clips.length - i} · {c.duration.toFixed(1)}
                  {t("秒")}
                </option>
              ))}
            </select>
          </label>
          {clip && (
            <div className="cine-player">
              <img
                src={clip.frames[frame]?.image}
                alt={t("撮影動画の再生フレーム")}
              />
              <div>
                <button
                  aria-label={playing ? t("動画を一時停止") : t("動画を再生")}
                  onClick={() => {
                    if (frame >= clip.frames.length - 1) setFrame(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <input
                  type="range"
                  aria-label={t("動画の再生位置")}
                  min="0"
                  max={clip.frames.length - 1}
                  value={frame}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrame(+e.target.value);
                  }}
                />
                <span>
                  {(
                    (clip.frames[frame]?.time ?? 0) - clip.frames[0].time
                  ).toFixed(1)}
                  {t("秒")}
                </span>
              </div>
              <small>
                {clip.frames[frame] &&
                  projectionCaption(clip.frames[frame].projection, locale)}
              </small>
            </div>
          )}
        </div>
      )}
      <p className="field-note">
        {t(
          "撮影は最大15秒。画像6枚・動画3本をこの画面に保持します。ページを閉じると消えます。X線量・実際の画像濃度は再現しません。",
        )}
      </p>
      {lightbox && (
        <dialog
          className="image-lightbox"
          aria-label={t("保存画像の表示")}
          ref={(el) => {
            if (el && !el.open) el.showModal();
          }}
          onCancel={(e) => {
            e.preventDefault();
            setLightbox(null);
          }}
        >
          <img
            src={lightbox.image}
            alt={projectionCaption(lightbox.projection, locale)}
          />
          <span>{projectionCaption(lightbox.projection, locale)}</span>
          <a href={lightbox.image} download="cath-lab-capture.jpg">
            {t("画像をダウンロード")}
          </a>
          <button autoFocus onClick={() => setLightbox(null)}>
            {t("閉じる")}
          </button>
        </dialog>
      )}
    </section>
  );
}
