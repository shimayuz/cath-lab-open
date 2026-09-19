import { useI18n } from "./i18n/I18n";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  Hand,
  Heart,
  LocateFixed,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  ScanLine,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { FluoroPanel } from "./components/FluoroPanel";
import { EngagementGuide } from "./components/EngagementGuide";
import { PhysiologyPanel } from "./components/PhysiologyPanel";
import { AnatomyView } from "./components/AnatomyView";
import type { ViewMode } from "./components/AnatomyView";
import { WireControl } from "./components/WireControl";
import { HandCamera } from "./components/HandCamera";
import {
  DEVICES,
  canInject,
  wireIsWithdrawn,
  wireInsertionLabel,
  hint,
  initialState,
  isEngaged,
  reducer,
  stage,
} from "./simulator/model";
import type { Action, Catheter } from "./simulator/model";
import { catheterIconPath } from "./simulator/catheters";
import { wireShape } from "./simulator/anatomy";
import { hemodynamics } from "./simulator/imaging";
import { nextDemoStep } from "./simulator/demo";
const CATH_NAMES = {
  JL: "Judkins left",
  JR: "Judkins right",
  AL: "Amplatz left",
};
function CatheterIcon({ kind }: { kind: Catheter }) {
  return (
    <svg viewBox="0 0 140 54" fill="none" aria-hidden="true">
      <path
        d={catheterIconPath(kind)}
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function HoldButton({
  onStep,
  children,
  label,
  disabled = false,
  className = "",
}: {
  onStep: () => void;
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const latest = useRef(onStep);
  latest.current = onStep;
  const stop = useCallback(() => {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
  }, []);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stop();
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [stop]);
  return (
    <button
      className={className}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        stop();
        latest.current();
        interval.current = setInterval(() => latest.current(), 90);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onClick={(e) => {
        if (e.detail === 0) latest.current();
      }}
    >
      {children}
    </button>
  );
}
export default function App() {
  const { t, format, locale, setLocale } = useI18n();
  const PHASES = [
    t("経路をたどる"),
    t("Aoへデリバリー"),
    t("先端を形成・Engage"),
    t("冠動脈を造影"),
  ];

  const [state, reduce] = useReducer(reducer, initialState);
  const [handEpoch, setHandEpoch] = useState(0);
  const [wireRemovalEpoch, setWireRemovalEpoch] = useState(0);
  const dispatch = useCallback((action: Action) => {
    if (["reset", "access", "catheter"].includes(action.type))
      setHandEpoch((value) => value + 1);
    reduce(action);
  }, []);
  const stateRef = useRef(state);
  stateRef.current = state;
  const demoNextStep = useRef(0);
  const [view, setView] = useState<ViewMode>("route");
  const [centerView, setCenterView] = useState<"model" | "fluoro">("model");
  const [fluoroStage, setFluoroStage] = useState<HTMLDivElement | null>(null);
  const [heartVisible, setHeartVisible] = useState(false),
    [resetKey, setResetKey] = useState(0),
    [paused, setPaused] = useState(false),
    [demo, setDemo] = useState(false),
    [fine, setFine] = useState(false),
    [help, setHelp] = useState(false);
  const helpRef = useRef<HTMLDialogElement>(null),
    helpTrigger = useRef<HTMLButtonElement>(null);
  const manualDisabled = paused || demo || help;
  const control = useCallback(
    (a: Action) => {
      if (!paused && !demo && !help) {
        if (a.type === "withdrawWire") {
          setHandEpoch((n) => n + 1);
          setWireRemovalEpoch((n) => n + 1);
        }
        dispatch(a);
      }
    },
    [paused, demo, help],
  );
  useEffect(() => {
    if (help) {
      helpRef.current?.showModal();
    } else if (helpRef.current?.open) {
      helpRef.current.close();
      helpTrigger.current?.focus();
    }
  }, [help]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.altKey ||
        e.metaKey ||
        e.ctrlKey ||
        manualDisabled ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,select,textarea,button,[contenteditable]"))
      )
        return;
      const actions: Record<string, Action> = {
        ArrowUp: { type: "move", delta: fine ? 0.5 : 3 },
        ArrowDown: { type: "move", delta: fine ? -0.5 : -3 },
        ArrowLeft: { type: "rotate", delta: fine ? -1 : -5 },
        ArrowRight: { type: "rotate", delta: fine ? 1 : 5 },
        w: { type: "select", instrument: "wire" },
        c: { type: "select", instrument: "catheter" },
      };
      if (actions[e.key]) {
        e.preventDefault();
        dispatch(actions[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manualDisabled, fine]);
  useEffect(() => {
    if (!demo || paused || help) return;
    const id = setInterval(() => {
      if (document.hidden || performance.now() < demoNextStep.current) return;
      const step = nextDemoStep(stateRef.current);
      step.actions.forEach(dispatch);
      if (step.view) setView(step.view);
      if (step.waitMs) demoNextStep.current = performance.now() + step.waitMs;
      if (step.complete) setDemo(false);
    }, 145);
    return () => clearInterval(id);
  }, [demo, paused, help]);
  useEffect(() => {
    if (paused || help) return;
    let previous = performance.now();
    const resetClock = () => {
      previous = performance.now();
    };
    document.addEventListener("visibilitychange", resetClock);
    const id = setInterval(() => {
      const now = performance.now(),
        dt = (now - previous) / 1000;
      previous = now;
      if (!document.hidden) reduce({ type: "tick", dt });
    }, 40);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", resetClock);
    };
  }, [paused, help]);
  const currentPhase = Math.min(stage(state), 3),
    engaged = isEngaged(state);
  function startDemo() {
    if (demo) {
      setDemo(false);
      return;
    }
    if (state.imaged.length === 2) dispatch({ type: "reset" });
    demoNextStep.current = 0;
    setPaused(false);
    setDemo(true);
  }
  return (
    <div className="app-shell" data-sim-time={state.time.toFixed(2)}>
      <header className="app-header">
        <a href="./" className="brand" aria-label={t("Cath Lab ホーム")}>
          <span className="brand-mark">
            <Activity size={25} />
          </span>
          <span>
            Cath<span className="brand-light">Lab</span>
            <small>{t("心臓への、一歩。")}</small>
          </span>
        </a>
        <nav aria-label={t("学習モード")}>
          <span className="nav-active">{t("CAGを体験する")}</span>
          <span className="nav-future">
            PCI <small>{t("今後追加")}</small>
          </span>
        </nav>
        <div className="header-actions">
          <div className="language-switch" role="group" aria-label={t("言語")}>
            <button
              type="button"
              lang="ja"
              aria-pressed={locale === "ja"}
              onClick={() => setLocale("ja")}
            >
              日本語
            </button>
            <button
              type="button"
              lang="en"
              aria-pressed={locale === "en"}
              onClick={() => setLocale("en")}
            >
              English
            </button>
          </div>
          <span className="education-badge">{t("医学教育プロトタイプ")}</span>
          <button
            ref={helpTrigger}
            className="help-button"
            onClick={() => setHelp(true)}
            aria-label={t("使い方と再現範囲")}
          >
            <CircleHelp size={19} />
            <span>{t("使い方")}</span>
          </button>
        </div>
      </header>
      <div className="intro-row">
        <div>
          <h1>{t("その手で、心臓につながる。")}</h1>
          <p>{t("血管をたどり、入口を捉え、冠動脈を描き出す。")}</p>
        </div>
        <button
          className={`demo-button ${demo ? "running" : ""}`}
          onClick={startDemo}
        >
          {demo ? <Pause size={16} /> : <Play size={16} />}{" "}
          {demo ? t("デモを止めて操作する") : t("操作デモを見る")}
        </button>
      </div>
      <main className="lab-layout">
        <aside className="setup-panel">
          <div className="setup-title">
            <SlidersHorizontal size={17} />
            <h2>{t("体験の準備")}</h2>
          </div>
          <fieldset disabled={manualDisabled}>
            <legend>{t("アプローチ")}</legend>
            <div className="access-options">
              <button
                aria-pressed={state.access === "radial"}
                onClick={() => {
                  control({ type: "access", value: "radial" });
                  setView("route");
                }}
              >
                <span className="access-symbol">R</span>
                <span>
                  {t("右橈骨動脈")}
                  <small>{t("手首からのアプローチ")}</small>
                </span>
                {state.access === "radial" && <Check size={15} />}
              </button>
              <button
                aria-pressed={state.access === "femoral"}
                onClick={() => {
                  control({ type: "access", value: "femoral" });
                  setView("route");
                }}
              >
                <span className="access-symbol">F</span>
                <span>
                  {t("右鼠径部")}
                  <small>{t("大腿動脈からのアプローチ")}</small>
                </span>
                {state.access === "femoral" && <Check size={15} />}
              </button>
            </div>
          </fieldset>
          <fieldset disabled={manualDisabled}>
            <legend>{t("造影する冠動脈")}</legend>
            <div className="segmented target-options">
              {(["LCA", "RCA"] as const).map((side) => (
                <button
                  key={side}
                  aria-pressed={state.target === side}
                  onClick={() => control({ type: "target", value: side })}
                >
                  <b>{side}</b>
                  <small>
                    {side === "LCA" ? t("左冠動脈") : t("右冠動脈")}
                    {state.imaged.includes(side) && <Check size={12} />}
                  </small>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={manualDisabled}>
            <legend>
              {t("診断カテーテル")}
              <span>{t("形状を選ぶ")}</span>
            </legend>
            <div className="catheter-options">
              {(["JL", "JR", "AL"] as const).map((kind) => (
                <button
                  key={kind}
                  aria-label={`${kind} ${CATH_NAMES[kind]}`}
                  aria-pressed={state.catheterType === kind}
                  onClick={() => control({ type: "catheter", value: kind })}
                >
                  <CatheterIcon kind={kind} />
                  <b>{kind}</b>
                </button>
              ))}
            </div>
            <p className="field-note">
              {CATH_NAMES[state.catheterType]}
              <br />
              {state.catheterType === "AL"
                ? t("曲がりの違いを体験するコース")
                : t("基本形の操作を体験するコース")}
            </p>
          </fieldset>
          <div className="lesson-progress">
            <h2>{t("今日の体験")}</h2>
            <ol>
              {PHASES.map((phase, i) => (
                <li
                  key={phase}
                  className={
                    i === currentPhase
                      ? "current"
                      : i < currentPhase
                        ? "done"
                        : ""
                  }
                >
                  <span>{i < currentPhase ? <Check size={13} /> : i + 1}</span>
                  <div>
                    {phase}
                    {i === currentPhase && (
                      <small>
                        {
                          [
                            t("穿刺部位 → 大動脈"),
                            t("ワイヤーに沿って進める"),
                            t("入口に高さ・向きを合わせる"),
                            t("LCAとRCAを観察"),
                          ][i]
                        }
                      </small>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="completion-mini">
            <Heart size={17} />
            <span>{t("造影できた冠動脈")}</span>
            <b>
              {state.imaged.length}
              <small> / 2</small>
            </b>
          </div>
        </aside>
        <section className="main-column" aria-label={t("シミュレータ")}>
          <div
            className="center-view-switch"
            role="group"
            aria-label={t("中央画面の切り替え")}
          >
            <button
              aria-pressed={centerView === "model"}
              onClick={() => setCenterView("model")}
            >
              <Heart size={17} />
              {t("3Dモデル")}
            </button>
            <button
              aria-pressed={centerView === "fluoro"}
              onClick={() => setCenterView("fluoro")}
            >
              <ScanLine size={17} />
              {t("透視")}
            </button>
            <span>
              {centerView === "model"
                ? t("形と動きを立体で確かめる")
                : t("カテ先と造影を大画面で観察")}
            </span>
          </div>
          <div
            className={`viewport-card center-${centerView}`}
            data-testid="center-viewport"
            data-view={centerView}
          >
            <div
              ref={setFluoroStage}
              className="center-fluoro-stage"
              aria-hidden={centerView !== "fluoro"}
            />
            <div
              className="center-model-stage"
              aria-hidden={centerView !== "model"}
            >
              <div className="viewport-toolbar">
                <div className="segmented view-switch">
                  <button
                    aria-pressed={view === "route"}
                    onClick={() => setView("route")}
                  >
                    {t("アプローチ全体")}
                  </button>
                  <button
                    aria-pressed={view === "heart"}
                    onClick={() => setView("heart")}
                  >
                    {t("心臓を拡大")}
                  </button>
                  <button
                    aria-pressed={view === "root"}
                    onClick={() => setView("root")}
                  >
                    {t("冠尖を拡大")}
                  </button>
                </div>
                <div className="viewport-tools">
                  <button
                    aria-label={t("心臓の表面を表示")}
                    aria-pressed={heartVisible}
                    title={t("心臓の表面")}
                    onClick={() => setHeartVisible((v) => !v)}
                  >
                    <Eye size={17} />
                  </button>
                  <button
                    aria-label={t("視点をリセット")}
                    title={t("視点をリセット")}
                    onClick={() => setResetKey((v) => v + 1)}
                  >
                    <LocateFixed size={17} />
                  </button>
                </div>
              </div>
              <AnatomyView
                state={state}
                view={view}
                projection="AP"
                heartVisible={heartVisible}
                resetKey={resetKey}
                visible={centerView === "model"}
              />
            </div>
            <div
              className={`pressure-mini ${hemodynamics(state).damping > 0 ? "warning" : ""}`}
            >
              <span>{t("カテーテル先端圧")}</span>
              <b>
                {hemodynamics(state).connected
                  ? `${hemodynamics(state).systolic}/${hemodynamics(state).diastolic}`
                  : "—/—"}{" "}
                <small>mmHg</small>
              </b>
              {hemodynamics(state).damping > 0 && (
                <strong>{t("Damping · 注入不可")}</strong>
              )}
            </div>
            <div className="view-label">
              <span className="live-dot" />
              <b>
                {view === "route"
                  ? t("心臓までの道のり")
                  : t("冠動脈の入口を見つける")}
              </b>
              <span>
                {state.access === "radial"
                  ? t("右橈骨動脈アプローチ")
                  : t("右大腿動脈アプローチ")}
              </span>
            </div>
            <div className="model-provenance">
              {t("冠動脈・上行Ao：VMR正常例の実形状")}
              <br />
              {t("弓部・アクセス経路／心臓表面：模式")}
            </div>
            {view === "route" && (
              <div className="route-map-caption">
                {state.access === "radial"
                  ? t("橈骨 → 上腕 → 鎖骨下 → 腕頭 → 上行大動脈")
                  : t("大腿 → 腸骨 → 腹部大動脈 → 下行大動脈 → 上行大動脈")}
              </div>
            )}
            <div
              className={`engagement-badge ${engaged ? "engaged" : ""}`}
              data-testid="engagement-status"
            >
              {engaged ? <Check size={15} /> : <LocateFixed size={15} />}{" "}
              {engaged ? `${state.target} Engaged` : t("Engageを待っています")}
            </div>
            <div
              className={`inject-control viewport-inject ${engaged ? "ready" : ""}`}
            >
              <span className="control-label">{t("冠動脈を観察")}</span>
              <button
                className="inject-button"
                disabled={manualDisabled || !canInject(state)}
                onClick={() => control({ type: "inject" })}
              >
                <ScanLine size={20} />
                <b>{t("造影する")}</b>
                <span>{state.target}</span>
              </button>
              <p>
                {!wireIsWithdrawn(state)
                  ? t("造影前にワイヤーを抜きます")
                  : engaged
                    ? state.stableFor < 0.6
                      ? t("手を止めて先端の安定を確認します")
                      : t("入口に合っています")
                    : t("Engage後に使えます")}
              </p>
              <WireControl
                compact
                state={state}
                disabled={manualDisabled}
                onAction={control}
              />
            </div>
            <div className="viewport-bottom">
              <div className="legend">
                <span>
                  <i className="wire-color" />
                  {t("ワイヤー（J型）")}
                </span>
                <span>
                  <i className="catheter-color" />
                  {t("カテーテル")}
                </span>
                <span>
                  <i className="coronary-color" />
                  {t("冠動脈")}
                </span>
              </div>
              {state.wire > 0 && (
                <span
                  className="wire-shape-status"
                  aria-label={t("ワイヤーの形状")}
                >
                  {wireShape(state).phase === "loop"
                    ? t("Ao内でループ形成")
                    : wireShape(state).phase === "contact"
                      ? t("J先端が大動脈基部に到達")
                      : wireShape(state).phase === "sheathed"
                        ? t("カテーテル内で先端を保持")
                        : t("J型先端で経路を進む")}
                </span>
              )}
              <span className="orbit-help">
                <MousePointer2 size={12} />
                {t("ドラッグで回転 / スクロールで拡大")}
              </span>
            </div>
          </div>
          <div
            className={`coach-strip ${state.imaged.length === 2 ? "complete" : ""}`}
          >
            <span className="coach-icon">
              {state.imaged.length === 2 ? (
                <Check size={19} />
              ) : (
                <ChevronRight size={21} />
              )}
            </span>
            <div>
              <strong>
                {state.imaged.length === 2
                  ? t("左右の造影を達成しました")
                  : demo
                    ? t("操作デモを再生中")
                    : PHASES[currentPhase]}
              </strong>
              <p data-testid="coach-hint">{format(hint(state))}</p>
            </div>
          </div>
          <section className="controls-panel" aria-label={t("カテーテル操作")}>
            <div className="controls-top">
              <h2>
                <MousePointer2 size={16} />
                {t("手元の操作")}
              </h2>
              <div className="controls-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={fine}
                    onChange={(e) => setFine(e.target.checked)}
                  />{" "}
                  {t("微調整")}
                </label>
                <button
                  aria-pressed={paused}
                  onClick={() => setPaused((p) => !p)}
                >
                  {paused ? <Play size={14} /> : <Pause size={14} />}{" "}
                  {paused ? t("再開") : t("一時停止")}
                </button>
                <button
                  onClick={() => {
                    setDemo(false);
                    setPaused(false);
                    dispatch({ type: "reset" });
                    setView("route");
                  }}
                  aria-label={t("体験を最初からやり直す")}
                >
                  <RotateCcw size={14} />
                  {t("最初から")}
                </button>
              </div>
            </div>
            <div className="controls-body">
              <div className="instrument-selection">
                <span className="control-label">{t("操作するデバイス")}</span>
                <div className="instrument-buttons">
                  <button
                    disabled={manualDisabled}
                    aria-pressed={state.active === "wire"}
                    onClick={() =>
                      control({ type: "select", instrument: "wire" })
                    }
                  >
                    <i className="wire-color" />
                    <span>
                      {t("ガイドワイヤー")}
                      <small>{t("0.035 inch · J型")}</small>
                    </span>
                    <kbd>W</kbd>
                  </button>
                  <button
                    disabled={manualDisabled}
                    aria-pressed={state.active === "catheter"}
                    onClick={() =>
                      control({ type: "select", instrument: "catheter" })
                    }
                  >
                    <i className="catheter-color" />
                    <span>
                      {t("診断カテーテル")}
                      <small>{state.catheterType}</small>
                    </span>
                    <kbd>C</kbd>
                  </button>
                </div>
              </div>
              <div className="push-control">
                <span className="control-label">{t("進める / 引く")}</span>
                <div className="push-buttons">
                  <HoldButton
                    disabled={manualDisabled}
                    label={t("Pull 引く")}
                    onStep={() =>
                      control({ type: "move", delta: fine ? -0.5 : -3 })
                    }
                  >
                    <ArrowDown size={19} />
                    <b>Pull</b>
                    <span>{t("引く")}</span>
                  </HoldButton>
                  <HoldButton
                    disabled={manualDisabled}
                    label={t("Push 進める")}
                    className="push"
                    onStep={() =>
                      control({ type: "move", delta: fine ? 0.5 : 3 })
                    }
                  >
                    <ArrowUp size={19} />
                    <b>Push</b>
                    <span>{t("進める")}</span>
                  </HoldButton>
                </div>
                <div className="progress-readout">
                  <span>{t("挿入の進み具合")}</span>
                  <b data-testid="insertion-value">
                    {state.active === "wire"
                      ? wireInsertionLabel(state.wire)
                      : Math.round(state.catheter)}
                    %
                  </b>
                </div>
                <progress
                  max="100"
                  value={state[state.active]}
                  aria-label={t("挿入の進み具合")}
                />
              </div>
              <div className="rotation-control">
                <span className="control-label">
                  {t("回す")} <small>{t("カテーテル")}</small>
                </span>
                <div className="rotation-buttons">
                  <HoldButton
                    disabled={manualDisabled || state.active !== "catheter"}
                    label={t("Counterclockwise 反時計回り")}
                    onStep={() =>
                      control({ type: "rotate", delta: fine ? -1 : -5 })
                    }
                  >
                    <RotateCcw size={21} />
                    <small>CCW</small>
                  </HoldButton>
                  <div className="rotation-dial">
                    <i style={{ transform: `rotate(${state.rotation}deg)` }} />
                    <b data-testid="rotation-value">
                      {Math.round(state.rotation)}°
                    </b>
                  </div>
                  <HoldButton
                    disabled={manualDisabled || state.active !== "catheter"}
                    label={t("Clockwise 時計回り")}
                    onStep={() =>
                      control({ type: "rotate", delta: fine ? 1 : 5 })
                    }
                  >
                    <RotateCw size={21} />
                    <small>CW</small>
                  </HoldButton>
                </div>
                <span className="model-angle">{t("教材内の回転角")}</span>
              </div>
              <div className="inject-reminder">
                <ScanLine size={19} />
                <span>
                  {t("Engage後は")}
                  <br />
                  {t("中央画面の「造影する」")}
                </span>
              </div>
            </div>
            <div className="operation-status" role="status">
              {paused
                ? t("一時停止中。デバイスは動きません。")
                : format(state.message)}
            </div>
          </section>
          <EngagementGuide state={state} />
          <PhysiologyPanel
            state={state}
            disabled={manualDisabled}
            onAction={control}
          />
        </section>
        <aside className="observe-panel">
          <FluoroPanel
            state={state}
            paused={paused || help}
            stage={fluoroStage}
            visible={centerView === "fluoro"}
            onShow={() => setCenterView("fluoro")}
          />
          <HandCamera
            onAction={control}
            simulation={state}
            wireRemovalEpoch={wireRemovalEpoch}
            paused={manualDisabled}
            contextKey={`${handEpoch}-${state.active}-${state.access}-${state.catheterType}-${state.target}`}
          />
        </aside>
      </main>
      <footer className="app-footer">
        <span>
          <CircleHelp size={14} />{" "}
          {t(
            "学生・研修医のための操作体験。公開正常例の血管形状を使用。アクセス経路と操作は簡略化しています。",
          )}
        </span>
        <button onClick={() => setHelp(true)}>
          {t("再現範囲と出典")}
          <ChevronRight size={13} />
        </button>
      </footer>
      <dialog
        ref={helpRef}
        className="help-dialog"
        onCancel={(e) => {
          e.preventDefault();
          setHelp(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setHelp(false);
        }}
      >
        <button
          className="dialog-close"
          aria-label={t("説明を閉じる")}
          onClick={() => setHelp(false)}
        >
          <X size={20} />
        </button>
        <div className="dialog-brand">
          <Activity size={24} /> Cath Lab
        </div>
        <h2>{t("手を動かして、循環器の世界へ。")}</h2>
        <p>
          {t(
            "学生や若手研修医が、心臓への経路とカテーテルの動きに親しむための体験教材です。",
          )}
        </p>
        <h3>{t("はじめての操作")}</h3>
        <ol>
          <li>
            {t(
              "アプローチとLCA / RCA、カテーテルを選びます。基本コースはLCAにJL、RCAにJRです。ALでは形状の違いを体験できます。",
            )}
          </li>
          <li>
            {t(
              "ワイヤーをPushし、進み具合を100%へ。次にカテーテルへ切り替え、AoまでPushします。",
            )}
          </li>
          <li>
            {t(
              "ワイヤーをPullして抜きます。「心臓を拡大」で先端を見て、カテーテルのPush / Pullと回旋で入口に合わせます。",
            )}
          </li>
          <li>
            {t(
              "「造影する」で血管を観察します。別の冠動脈とカテーテルを選び、反対側も体験しましょう。",
            )}
          </li>
        </ol>
        <p>
          {t(
            "画面のボタンは長押しできます。キーボードは↑↓で前後、←→で回旋、W / Cでデバイス切り替え。「操作デモを見る」でも一連の流れを確認できます。",
          )}
        </p>
        <h3>{t("カメラ操作")}</h3>
        <p>
          {t(
            "左手でつかんで送る、離して位置を保持する、手を戻してつかみ直し続きを送る、という順で操作します。Pushは既定で画面の左方向。カメラ横で上方向にも変更できます。握ったまま逆方向へ動かすとPullできます。持ち直すときは離してから手を戻すと、ワイヤーの位置を保てます。右手は回転。各手を離すと担当操作が止まり、左右の役割も交換できます。映像は保存・送信しません。",
          )}
        </p>
        <h3>{t("この初版で再現する範囲")}</h3>
        <p>
          {t(
            "2つのアクセス経路、JL / JR / ALの参照画像に基づく形状、ワイヤーによる先端の直線化、手元の前後・回旋、入口の軸・深さ・壁への向き・安定によるEngage判定、位置に連動したカテーテル圧波形、注入量・時間に応じた造影と洗い出し、連続したCアーム角度、寝台・拡大・絞り、静止画保存と撮影再生です。進み具合と角度は教材内の値で、臨床での挿入長や推奨操作量ではありません。",
          )}
        </p>
        <p>
          {t(
            "穿刺はシースを確保した状態から始まります。0.035″ワイヤーはJ型先端を持ち、大動脈基部に達した後の送りで遠位部のたわみ・ループが増え、引くとほどける形状モデルです。弁尖は分割されていないため、基部の停止面は模式的に設定しています。患者別の接触力・摩擦・剛性、触覚・トルク伝達、損傷、弁通過は再現しません。圧と造影は教材用の近似です。深い位置・壁への向きで先端圧にdampingを表示しますが、狭窄・攣縮など他の原因や実際の血流計算は含みません。心電図と全身バイタルは正常値のシナリオで、患者の状態変化を計算するものではありません。製品の性能・臨床手技の習熟度を評価するものではなく、指導医による内容・操作の妥当性確認は未実施です。",
          )}
        </p>
        <h3>{t("PCIへの拡張")}</h3>
        <div className="future-devices">
          {DEVICES.filter((d) => !d.available).map((d) => (
            <span key={d.id}>
              {format(d.label)}
              <small>{t("未実装")}</small>
            </span>
          ))}
        </div>
        <p>
          {t(
            "デバイス定義、操作入力、3D表示、造影状態を分けています。PCI追加時には冠動脈内ワイヤーの経路、デバイスの追従、バルーン拡張・ステント留置を追加できます。",
          )}
        </p>
        <h3>{t("参照資料")}</h3>
        <ul className="source-links">
          <li>
            <a
              href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4696973/"
              target="_blank"
              rel="noreferrer"
            >
              {t("圧波形のdamping：入口・深い挿入・壁への接触")}
            </a>
          </li>
          <li>
            <a
              href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8518823/"
              target="_blank"
              rel="noreferrer"
            >
              {t("冠動脈入口と同軸性・深い挿入に関する研究")}
            </a>
          </li>
          <li>
            <a
              href="https://www.terumois.com/products/product-type/catheters/optitorque.html"
              target="_blank"
              rel="noreferrer"
            >
              {t("Terumo：診断カテーテルの形状・製品仕様")}
            </a>
          </li>
          <li>
            <a
              href="https://www.ncbi.nlm.nih.gov/books/NBK543597/"
              target="_blank"
              rel="noreferrer"
            >
              {t("Primary Angioplasty：アクセスとカテーテル選択")}
            </a>
          </li>
          <li>
            <a
              href="https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js"
              target="_blank"
              rel="noreferrer"
            >
              {t("Google MediaPipe：手のランドマーク検出")}
            </a>
          </li>
        </ul>
        <p className="field-note">
          {t(
            "形状・操作モデルは独自に簡略化したものです。実製品のデジタルツインではありません。",
          )}
        </p>
        <button className="dialog-start" onClick={() => setHelp(false)}>
          <Hand size={18} />
          {t("体験に戻る")}
        </button>
      </dialog>
    </div>
  );
}
