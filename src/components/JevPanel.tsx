import { useI18n } from "../i18n/I18n";
import type { useJevAssist } from "../hand/useJevAssist";
export function JevPanel({
  jev,
  rate,
  onRate,
  metrics,
}: {
  jev: ReturnType<typeof useJevAssist>;
  rate: number;
  onRate: (rate: number) => void;
  metrics: { detectionMs: number; fps: number } | null;
}) {
  const { t } = useI18n();
  const status = {
    off: t("Jevアシスト OFF"),
    waiting: t("手の動きを待っています"),
    active: t("Jev判定を受信"),
    stale: t("古い判定は使わず、手元の処理を継続"),
    fallback: t("Jevに接続できないため、手元の処理を継続"),
  };
  return (
    <div className="jev-panel">
      <label>
        {t("反応速度")}
        <select
          aria-label={t("手の更新頻度")}
          value={rate}
          onChange={(e) => onRate(+e.target.value)}
        >
          <option value="30">{t("高頻度（最大30回/秒）")}</option>
          <option value="15">{t("従来（最大15回/秒）")}</option>
        </select>
      </label>
      {metrics && (
        <output aria-label={t("手の処理速度")}>
          {t(
            "手の解析 {0} ms · 更新 {1} 回/秒",
            metrics.detectionMs.toFixed(1),
            metrics.fps.toFixed(1),
          )}
        </output>
      )}
      <label className="jev-toggle">
        <input
          type="checkbox"
          checked={jev.enabled}
          disabled={!jev.enabled && jev.connection !== "ready"}
          onChange={(e) => jev.setEnabled(e.target.checked)}
        />
        {t("Jevアシストを使う（試験）")}
      </label>
      <p>
        {t(
          "ONにすると、手の動きの要約をTypeSafeへ送って持ち直しを判定します。映像は送信しません。握った手の押し引き・回転を優先し、Jevの判定や通信で止めません。",
        )}
      </p>
      <output aria-label={t("Jevの状態")}>
        {jev.connection === "ready"
          ? status[jev.status.state]
          : jev.connection === "checking"
            ? t("Jev接続設定を確認中")
            : t("この端末でJevの接続設定が必要です")}
        {jev.enabled && jev.status.latencyMs !== null && (
          <span> · {t("応答 {0} ms", jev.status.latencyMs)}</span>
        )}
      </output>
      <button className="text-button" onClick={() => void jev.refresh()}>
        {t("接続設定を再確認")}
      </button>
    </div>
  );
}
