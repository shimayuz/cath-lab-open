import { useI18n } from "../i18n/I18n";
import { wireIsWithdrawn, wireInsertionLabel } from "../simulator/model";
import type { Action, SimulationState } from "../simulator/model";

/** Wire presence remains visible even when the wire is hidden inside a catheter. */
export function WireControl({
  state,
  disabled,
  onAction,
  compact = false,
}: {
  state: SimulationState;
  disabled: boolean;
  onAction: (action: Action) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const withdrawn = wireIsWithdrawn(state);
  return (
    <div className="wire-control" data-withdrawn={withdrawn}>
      <output aria-label={t("ワイヤー抜去の状態")} aria-live="polite">
        {withdrawn
          ? state.catheter > 0
            ? t("ワイヤー抜去完了（残量0%）")
            : t("ワイヤー未挿入（残量0%）")
          : t("ワイヤー残量 {0}%・未抜去", wireInsertionLabel(state.wire))}
      </output>
      {!compact && withdrawn && state.catheter > 0 && (
        <small>
          {t("手操作を再開するときは、指を開いてつまみ直してください。")}
        </small>
      )}
      {!withdrawn && (
        <>
          <button
            disabled={disabled}
            onClick={() => onAction({ type: "withdrawWire" })}
          >
            {t("ワイヤーを完全に抜く")}
          </button>
          {!compact && state.active !== "wire" && (
            <button
              disabled={disabled}
              onClick={() => onAction({ type: "select", instrument: "wire" })}
            >
              {t("ワイヤーを選んでPull")}
            </button>
          )}
          {!compact && (
            <small>
              {t("カテーテル内に残ったワイヤーも、残量0%まで抜きます。")}
            </small>
          )}
        </>
      )}
      {!compact &&
        withdrawn &&
        state.catheter > 0 &&
        state.active === "wire" && (
          <button
            disabled={disabled}
            onClick={() => onAction({ type: "select", instrument: "catheter" })}
          >
            {t("カテーテルの操作に戻る")}
          </button>
        )}
    </div>
  );
}
