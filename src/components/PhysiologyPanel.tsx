import { useI18n } from "../i18n/I18n";
import { useEffect, useRef } from "react";
import { engagement, isEngaged } from "../simulator/model";
import type { SimulationState, Action } from "../simulator/model";
import { ecgAt, pressureAt, hemodynamics } from "../simulator/imaging";
export function PhysiologyPanel({
  state,
  disabled,
  onAction,
}: {
  state: SimulationState;
  disabled: boolean;
  onAction: (a: Action) => void;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null),
    values = useRef<{ t: number; p: number | null; e: number }[]>([]),
    last = useRef(-1);
  const h = hemodynamics(state),
    e = engagement(state);
  useEffect(() => {
    const c = canvas.current,
      ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (state.time < last.current) values.current = [];
    if (state.time !== last.current) {
      const from =
        last.current < 0 || state.time < last.current
          ? Math.max(0, state.time - 6)
          : Math.max(state.time - 6, last.current);
      for (let t = from; t <= state.time; t += 1 / 160)
        values.current.push({
          t,
          p: h.connected ? pressureAt(t, h.damping) : null,
          e: ecgAt(t),
        });
      last.current = state.time;
    }
    values.current = values.current.filter((v) => v.t >= state.time - 6);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#253d45";
    ctx.lineWidth = 0.5;
    for (let x = 0; x < c.width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    for (let y = 0; y < c.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(c.width, y);
      ctx.stroke();
    }
    for (const channel of ["e", "p"] as const) {
      ctx.beginPath();
      ctx.strokeStyle = channel === "e" ? "#6bdfa8" : "#ffab90";
      ctx.lineWidth = 2;
      let pen = false;
      values.current.forEach((v) => {
        const a = v[channel];
        if (a === null) {
          pen = false;
          return;
        }
        const x = ((v.t - state.time + 6) / 6) * c.width,
          y = channel === "e" ? 46 - a * 29 : 150 - (a - 40) * 0.63;
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      });
      ctx.stroke();
    }
  }, [state.time, h.connected, h.damping]);
  return (
    <section className="physiology-panel" aria-label={t("圧波形とEngage評価")}>
      <div className="physiology-head">
        <b>{t("ECG・カテーテル先端圧")}</b>
        <span>{t("正常バイタルの教材シナリオ")}</span>
      </div>
      <div className="monitor">
        <canvas
          ref={canvas}
          width="720"
          height="160"
          aria-label={t("心電図とカテーテル圧の波形")}
        />
        <div className="vital-values">
          <span>
            HR <b>72</b> /min
          </span>
          <span>
            SpO₂ <b>98</b> %
          </span>
          <span className={h.damping > 0 ? "damped" : ""}>
            {t("先端圧")}{" "}
            <b data-testid="pressure-value">
              {h.connected ? `${h.systolic}/${h.diastolic}` : "—/—"}
            </b>
          </span>
          <small>{t("mmHg · 全身血圧 120/80")}</small>
        </div>
      </div>
      <div
        className={`pressure-state ${h.damping > 0 ? "warning" : ""}`}
        data-testid="pressure-state"
      >
        {!h.connected
          ? t("カテーテルがAoに達すると圧を表示")
          : h.damping > 0
            ? t("Damping：注入を止め、深さ・壁への向きを確認")
            : t("Ao型の圧波形")}
      </div>
      <div className="engage-metrics" data-testid="engage-metrics">
        <span>
          {t("入口との角度")}
          <b>{e.near ? `${e.angle.toFixed(0)}°` : "—"}</b>
        </span>
        <span>
          {t("深さ")}{" "}
          <b>
            {!e.near
              ? "—"
              : e.deep
                ? t("深い")
                : e.depth < -0.065
                  ? t("手前")
                  : t("入口付近")}
          </b>
        </span>
        <span>
          {t("壁への向き")}
          <b>{e.wallContact ? t("接触判定") : t("接触なし")}</b>
        </span>
        <span>
          {t("支持")}{" "}
          <b>
            {isEngaged(state)
              ? state.stableFor >= 0.6
                ? t("安定")
                : t("安定待ち")
              : t("未成立")}
          </b>
        </span>
      </div>
      {state.kickbackCount > 0 && (
        <p className="pressure-state warning" data-testid="kickback-status">
          {t(
            "注入の反作用でカテーテルが外れました（{0}回）。再び着座し、支持と注入条件を見直します。",
            state.kickbackCount,
          )}
        </p>
      )}
      <div className="contrast-settings">
        <label>
          {t("注入量")}
          <b>{state.contrastVolume} mL</b>
          <input
            aria-label={t("造影剤の注入量")}
            type="range"
            min="2"
            max="12"
            step="1"
            value={state.contrastVolume}
            disabled={disabled || (!!state.bolus && !state.bolus.stopped)}
            onChange={(e) =>
              onAction({ type: "contrast", volume: +e.target.value })
            }
          />
        </label>
        <label>
          {t("注入時間")}
          <b>
            {state.contrastDuration.toFixed(1)}
            {t("秒")}
          </b>
          <input
            aria-label={t("造影剤の注入時間")}
            type="range"
            min="1"
            max="4"
            step=".5"
            value={state.contrastDuration}
            disabled={disabled || (!!state.bolus && !state.bolus.stopped)}
            onChange={(e) =>
              onAction({ type: "contrast", duration: +e.target.value })
            }
          />
        </label>
        <div>
          <span>
            {(state.contrastVolume / state.contrastDuration).toFixed(1)}
            {t("mL/秒")}
          </span>
          <small>
            {t("累計")} {state.contrastTotal.toFixed(1)} mL
          </small>
          {state.bolus && !state.bolus.stopped && (
            <button
              disabled={disabled}
              onClick={() => onAction({ type: "stopInjection" })}
            >
              {t("注入を止める")}
            </button>
          )}
        </div>
      </div>
      <p className="field-note">
        {t(
          "角度・深さ・支持の判定と圧応答は教材用の近似です。数値は臨床での推奨注入条件ではありません。",
        )}
      </p>
    </section>
  );
}
