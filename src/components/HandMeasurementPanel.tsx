import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n";
import {
  HandMeasurements,
  filterMeasurementSamples,
  summarizeMeasurements,
  measurementsCsv,
  measuredMovements,
  movementsCsv,
} from "../hand/measurements";
import type {
  MeasurementSample,
  MeasurementSettings,
} from "../hand/measurements";
const number = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : v.toFixed(digits);
function download(text: string, extension: string, suffix: string) {
  const url = URL.createObjectURL(
    new Blob([text], {
      type:
        extension === "json" ? "application/json" : "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `cath-lab-hand-${suffix}-${Date.now()}.${extension}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Trace({
  samples,
  field,
  label,
  unit,
  selected,
}: {
  samples: readonly MeasurementSample[];
  field: "handSpeed" | "handAngularSpeed";
  label: string;
  unit: string;
  selected: number;
}) {
  const values = samples
    .map((s) => s[field])
    .filter((v): v is number => v !== null);
  const extent = Math.max(1, ...values.map(Math.abs));
  const from = samples[0]?.elapsedMs ?? 0,
    to = samples.at(-1)?.elapsedMs ?? 1;
  const x = (time: number) =>
    52 + ((time - from) / Math.max(1, to - from)) * 630;
  const y = (value: number) => 85 - (value / extent) * 52;
  // Retain gaps between valid runs. Limit SVG density without joining over missing samples.
  const stride = Math.max(1, Math.ceil(samples.length / 450));
  let path = "",
    pen = false;
  samples.forEach((s, i) => {
    if (
      s[field] === null ||
      (i && s.elapsedMs - samples[i - 1].elapsedMs > 500)
    )
      pen = false;
    if (s[field] !== null && (i % stride === 0 || i === samples.length - 1)) {
      path += `${pen ? "L" : "M"}${x(s.elapsedMs).toFixed(2)},${y(s[field]!).toFixed(2)} `;
      pen = true;
    }
  });
  return (
    <figure className="measurement-trace">
      <figcaption>
        {label} <small>{unit}</small>
      </figcaption>
      <svg viewBox="0 0 710 168" role="img" aria-label={label}>
        <line x1="52" y1="85" x2="682" y2="85" stroke="#c7d7de" />
        <path d={path} stroke="#087e78" strokeWidth="2" fill="none" />
        {samples[selected] && (
          <line
            x1={x(samples[selected].elapsedMs)}
            x2={x(samples[selected].elapsedMs)}
            y1="25"
            y2="140"
            stroke="#a26230"
            strokeDasharray="4 3"
          />
        )}
        <text x="2" y="38">
          {number(extent)}
        </text>
        <text x="18" y="89">
          0
        </text>
        <text x="0" y="139">
          −{number(extent)}
        </text>
        <text x="52" y="161">
          {number(from / 1000)} s
        </text>
        <text x="635" y="161">
          {number(to / 1000)} s
        </text>
      </svg>
    </figure>
  );
}
export function HandMeasurementPanel({
  measurements,
  revision,
  ready,
  settings,
  onChange,
  onReviewChange,
}: {
  measurements: HandMeasurements;
  revision: number;
  ready: boolean;
  settings: MeasurementSettings;
  onChange: () => void;
  onReviewChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false),
    [scope, setScope] = useState("all"),
    [selected, setSelected] = useState(0);
  const samples = useMemo(
    () => filterMeasurementSamples(measurements.samples, scope),
    [measurements, revision, scope],
  );
  const fingerMode = measurements.rotationMode === "fingers";
  const rotationUnit = fingerMode ? t("% 手のひら長") : "°";
  const stats = useMemo(() => summarizeMeasurements(samples), [samples]);
  const movements = useMemo(() => measuredMovements(samples), [samples]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => setSelected(Math.max(0, samples.length - 1)), [scope, open]);
  const sample = samples[Math.min(selected, Math.max(0, samples.length - 1))];
  const direction = (key: string | null) =>
    key === "push"
      ? t("Push 押す")
      : key === "pull"
        ? t("Pull 引く")
        : key === "clockwise"
          ? t("CW 時計回り")
          : key === "counterclockwise"
            ? t("CCW 反時計回り")
            : key === "hold"
              ? t("保持")
              : key === "regrip"
                ? t("持ち直し")
                : key === "uncertain"
                  ? t("判定不確実")
                  : "—";
  const close = () => {
    setOpen(false);
    onReviewChange(false);
  };
  const save = (kind: "samples" | "movements" | "json") => {
    const data = measurements.export();
    download(
      kind === "json"
        ? JSON.stringify(
            { ...data, movements: measuredMovements(data.samples) },
            null,
            2,
          )
        : kind === "samples"
          ? measurementsCsv(data)
          : movementsCsv(data),
      kind === "json" ? "json" : "csv",
      kind,
    );
  };
  return (
    <section className="hand-measurement-panel" aria-label={t("操作の測定")}>
      <strong>{t("操作の測定")}</strong>
      <p>
        {t(
          "押し引き・回転の量と速さを記録します。力・トルクの測定ではありません。",
        )}
      </p>
      <div className="measurement-buttons">
        <button
          disabled={!ready && !measurements.recording}
          onClick={() => {
            if (measurements.recording) measurements.stop("manual");
            else {
              measurements.start(performance.now(), settings);
              setScope("all");
            }
            onChange();
          }}
        >
          {measurements.recording
            ? t("測定を停止")
            : measurements.samples.length
              ? t("新しく測定する")
              : t("測定を開始")}
        </button>
        <button
          disabled={!measurements.samples.length}
          onClick={() => {
            measurements.stop("manual");
            onChange();
            setOpen(true);
            onReviewChange(true);
          }}
        >
          {t("測定結果を見る")}
        </button>
      </div>
      <output aria-label={t("測定の状態")}>
        {measurements.recording
          ? t("記録中 · {0} サンプル", measurements.samples.length)
          : measurements.samples.length
            ? t("記録済み · {0} サンプル", measurements.samples.length)
            : t("カメラを開始し、測定を開始してください。")}
      </output>
      {measurements.stopReason && measurements.stopReason !== "manual" && (
        <p>{t("カメラ停止・設定変更・画面非表示・上限で記録を終了します。")}</p>
      )}
      <p>
        {t(
          "最大5分。新しい測定で前の記録を置き換えます。必要な記録はCSVで保存してください。",
        )}
      </p>
      <dialog
        ref={dialog}
        className="measurement-dialog"
        onCancel={close}
        onClose={close}
        aria-label={t("手操作の測定結果")}
      >
        <div className="measurement-heading">
          <h2>{t("手操作の測定結果")}</h2>
          <button onClick={close}>{t("結果を閉じる")}</button>
        </div>
        <p>
          {fingerMode
            ? t(
                "指先のずれは手のひら長に対する割合です。カテーテルの実回転角・力・トルクではありません。",
              )
            : t(
                "手の移動は画面軸の割合、回転は画面内の手の傾きです。mm・押す力・軸トルクではありません。",
              )}
        </p>
        <label>
          {t("評価範囲")}{" "}
          <select
            aria-label={t("評価範囲")}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">{t("全記録")}</option>
            <option value="root">{t("冠尖付近のカテーテル")}</option>
            <option value="catheter">{t("カテーテル")}</option>
            <option value="wire">{t("ワイヤー")}</option>
          </select>
        </label>
        <p>
          {t(
            "選択範囲 {0} サンプル · 押し引き有効 {1} · 回転有効 {2} · 長い間隔 {3}",
            stats.count,
            stats.validPush,
            stats.validRotation,
            stats.gaps,
          )}
        </p>
        <div className="measurement-cards">
          <div>
            <span>{t("手のPush / Pull累積")}</span>
            <strong>
              {number(stats.push)} / {number(stats.pull)} %
            </strong>
          </div>
          <div>
            <span>
              {fingerMode ? t("指先のずれ（累積）") : t("回転Arc（累積）")}
            </span>
            <strong>
              {number(stats.rotationArc)} {rotationUnit}
            </strong>
            <small>
              CW {number(stats.clockwise)} {rotationUnit} / CCW{" "}
              {number(stats.counterclockwise)} {rotationUnit}
            </small>
          </div>
          <div>
            <span>{t("最大の押し引き速度")}</span>
            <strong>{number(stats.peakSpeed)} %/s</strong>
          </div>
          <div>
            <span>{t("最大の加速度（強弱の代替）")}</span>
            <strong>{number(stats.peakAcceleration)} %/s²</strong>
          </div>
          <div>
            <span>
              {fingerMode ? t("最大の指先ずれ速度") : t("最大角速度")}
            </span>
            <strong>
              {number(stats.peakAngularSpeed)} {rotationUnit}/s
            </strong>
          </div>
        </div>
        <p>
          {t(
            "小さい値ほど上手いという採点ではありません。認識の揺れや低い更新頻度も数値に影響します。500msを超える間隔と認識ロストを微分計算から除外しています。",
          )}
        </p>
        {!samples.length ? (
          <p>{t("この範囲の記録はありません。")}</p>
        ) : (
          <>
            <Trace
              samples={samples}
              field="handSpeed"
              label={t("押し引き速度の推移")}
              unit="%/s"
              selected={selected}
            />
            <Trace
              samples={samples}
              field="handAngularSpeed"
              label={fingerMode ? t("指先ずれ速度の推移") : t("角速度の推移")}
              unit={`${rotationUnit}/s`}
              selected={selected}
            />
            <label className="measurement-scrubber">
              {t("記録の時点")}{" "}
              <input
                aria-label={t("記録の時点")}
                type="range"
                min="0"
                max={samples.length - 1}
                value={Math.min(selected, samples.length - 1)}
                onChange={(e) => setSelected(+e.target.value)}
              />
            </label>
            {sample && (
              <dl
                className="measurement-sample"
                aria-label={t("選択時点の測定値")}
              >
                <dt>{t("経過時間")}</dt>
                <dd>{number(sample.elapsedMs / 1000, 2)} s</dd>
                <dt>
                  {fingerMode
                    ? t("手の移動 / 指先のずれ")
                    : t("手の移動 / 回転")}
                </dt>
                <dd>
                  {number(sample.handPushStep, 3)} % /{" "}
                  {number(sample.handRotationStep, 3)} {rotationUnit}
                </dd>
                <dt>{t("送信した操作量")}</dt>
                <dd>
                  {number(sample.commandPush, 3)} % /{" "}
                  {number(sample.commandRotation, 3)}°
                </dd>
                <dt>{t("シミュレータの観測値")}</dt>
                <dd>
                  {number(sample.modelInsertion, 3)} % /{" "}
                  {number(sample.modelRotation, 3)}°
                </dd>
                <dt>{t("Jevの分類")}</dt>
                <dd>
                  {direction(sample.jevPush)} / {direction(sample.jevRotation)}
                </dd>
                <dt>{t("Jevの確信度 / 応答")}</dt>
                <dd>
                  {number(sample.jevPushConfidence, 2)} /{" "}
                  {number(sample.jevRotationConfidence, 2)} ·{" "}
                  {number(sample.jevLatencyMs, 0)} ms
                </dd>
              </dl>
            )}
            <h3>{t("動作ごとの一覧")}</h3>
            <p>
              {t(
                "同方向の手の動きを1動作としてまとめます。持ち直し・方向変更・観測した250ms以上の静止で区切ります。微小な揺れも含み、直近20件を表示。",
              )}
            </p>
            <div className="measurement-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("開始")}</th>
                    <th>{t("動作")}</th>
                    <th>{t("時間")}</th>
                    <th>{t("手の移動量 / Arc")}</th>
                    <th>{t("操作指令量")}</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.slice(-20).map((m, i) => (
                    <tr key={i}>
                      <td>{number(m.startMs / 1000, 2)} s</td>
                      <td>{direction(m.direction)}</td>
                      <td>{number((m.endMs - m.startMs) / 1000, 2)} s</td>
                      <td>
                        {number(
                          m.axis === "rotation" ? m.handArc : m.handAmount,
                          2,
                        )}{" "}
                        {m.axis === "rotation" ? rotationUnit : "%"}
                      </td>
                      <td>
                        {number(m.commandAmount, 2)}{" "}
                        {m.axis === "rotation" ? "°" : "%"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p>
          {t(
            "送信した指令と、次の処理で観測するシミュレータ値は別です。観測値には画面ボタンの操作も含みます。",
          )}
        </p>
        <div className="measurement-buttons">
          <button onClick={() => save("movements")}>
            {t("CSV保存（動作ごと・全記録）")}
          </button>
          <button onClick={() => save("samples")}>
            {t("CSV保存（時系列・全記録）")}
          </button>
          <button onClick={() => save("json")}>
            {t("JSON保存（全記録）")}
          </button>
        </div>
        <p>
          {t(
            "測定値はこのページ内に保持します。映像は記録しません。JevをONにした場合のみ、従来の動作分類用の要約を送信します。",
          )}
        </p>
      </dialog>
    </section>
  );
}
