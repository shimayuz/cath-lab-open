import { useI18n } from "../i18n/I18n";
import {
  catheterPose,
  engagement,
  rootManeuver,
  clamp,
  CUSP_BOTTOM_INSERTION,
  OSTIAL_INSERTION,
} from "../simulator/model";
import type { SimulationState } from "../simulator/model";

/** Two schematic projections separate clockwise motion from longitudinal pull. */
export function EngagementGuide({ state }: { state: SimulationState }) {
  const { t } = useI18n();
  const pose = catheterPose(state),
    e = engagement(state),
    phase = rootManeuver(state);
  const side = state.root?.side ?? state.target,
    left = side === "LCA";
  const lift = clamp(
    (CUSP_BOTTOM_INSERTION - state.catheter) /
      (CUSP_BOTTOM_INSERTION - OSTIAL_INSERTION),
    0,
    1,
  );
  const seated = phase === "engaged";
  const aligning =
    !!state.root && !seated && state.catheter >= OSTIAL_INSERTION;
  const labels = {
    approach: t("冠尖へ向ける"),
    descending: t("入口へ合わせる"),
    bottom: t("冠尖に着座"),
    lifting: left ? t("反時計回り＋引き上げ") : t("時計回り＋引き上げ"),
    engaged: t("入口を捉えた"),
  };
  // Proximal view: positive screen angles turn clockwise, matching the hand input.
  const goal = left ? -35 : 35,
    angle = ((goal + pose.error) * Math.PI) / 180;
  const tipX = 116 + 67 * Math.cos(angle),
    tipY = 107 + 67 * Math.sin(angle);
  const goalX = 116 + 67 * Math.cos((goal * Math.PI) / 180),
    goalY = 107 + 67 * Math.sin((goal * Math.PI) / 180);
  const y = 158 - (seated ? 1 : lift) * 53;
  return (
    <details className="engagement-guide">
      <summary>
        {t("Engageの図解")}{" "}
        <span data-testid="root-phase" data-phase={phase}>
          {labels[phase]}
        </span>
      </summary>
      <div className="engagement-guide-body">
        <svg
          viewBox="0 0 510 220"
          role="img"
          aria-label={t(
            "{0}の冠尖から回しながら引き上げる二方向の模式図",
            side,
          )}
        >
          <text x="22" y="20" fill="#486b66" fontSize="11">
            {left
              ? t("上から：反時計回り（CCW）")
              : t("上から：時計回り（CW）")}
          </text>
          <path
            d="M116 44 C164 37 195 75 182 112 C192 155 157 181 116 166 C72 186 38 151 50 112 C35 72 69 37 116 44Z"
            fill="#e5f2ef"
            stroke="#8cafaa"
            strokeWidth="2"
          />
          <path
            d="M116 107L116 45 M116 107L54 145 M116 107L177 145"
            fill="none"
            stroke="#bdccae"
            strokeWidth="2"
          />
          <path
            d={`M${goalX} ${goalY}l32 ${left ? -22 : 22}`}
            stroke="#8cafaa"
            strokeWidth="12"
          />
          <path
            d={`M68 37 C78 70 65 101 82 117 Q108 135 ${tipX} ${tipY}`}
            fill="none"
            stroke="#d59a4c"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx={tipX} cy={tipY} r="4" fill="#0d8278" />
          <path
            d={
              left
                ? "M69 176 A66 66 0 0 0 159 163 l-2 11 m2-11-12 2"
                : "M159 176 A66 66 0 0 1 69 163 l2 11 m-2-11 12 2"
            }
            fill="none"
            stroke="#167b76"
            strokeWidth="2"
          />
          <text x="270" y="20" fill="#486b66" fontSize="11">
            {t("横から：先端の高さを調整")}
          </text>
          <path
            d="M330 36V129 Q311 179 350 179 Q376 177 392 159 Q423 180 435 158 Q445 141 424 128V36"
            fill="#e5f2ef"
            stroke="#8cafaa"
            strokeWidth="2"
          />
          <path d="M424 105L474 88" stroke="#8cafaa" strokeWidth="12" />
          <path
            d="M394 166Q416 178 435 158"
            fill="none"
            stroke="#d8aa45"
            strokeWidth="4"
          />
          <path
            d="M361 37 C362 82 337 121 347 151 Q366 178 424 158"
            fill="none"
            stroke="#c8d6d2"
            strokeWidth="3"
            strokeDasharray="5 4"
          />
          <path
            d={`M361 37 C362 83 337 ${y - 26} 347 ${y - 6} Q365 ${y + 18} 424 ${y}`}
            fill="none"
            stroke="#d59a4c"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="424" cy={y} r="4" fill="#0d8278" />
          <path
            d={
              state.catheter < OSTIAL_INSERTION
                ? "M302 80V142l-6-9m6 9 6-9"
                : "M302 142V80l-6 9m6-9 6 9"
            }
            fill="none"
            stroke="#167b76"
            strokeWidth="2"
          />
          <text x="274" y="63" fill="#167b76" fontSize="11">
            {state.catheter < OSTIAL_INSERTION ? "Push ↓" : "Pull ↑"}
          </text>
          <text x="389" y="195" fill="#947131" fontSize="10">
            {left ? t("左冠尖 Bottom") : t("右冠尖 Bottom")}
          </text>
        </svg>
        <p className="diagram-caption">
          {t("二方向へ展開した模式図。緑の点は先端、点線は底にあるときの形。")}
        </p>
        <p>
          {t(
            "Bottomへの到達は任意です。入口で位置・向き・支持が合えばEngageできます。",
          )}
        </p>
        <ol>
          <li className={!seated && !aligning ? "current" : ""}>
            {left ? t("左冠尖に先端を持ち込む") : t("右冠尖に先端を持ち込む")}{" "}
            {t("— ワイヤーを抜いて先端を形成し、Push。")}
          </li>
          <li className={aligning ? "current" : ""}>
            {left
              ? t("反時計回りに回しながら、引き上げる")
              : t("時計回りに回しながら、引き上げる")}{" "}
            {t(
              "— 回転とPullを同時に少しずつ。先端が入口へせり上がる様子を確認します。",
            )}
          </li>
          <li className={seated ? "current" : ""}>
            {t(
              "入口を捉えたら静止 — 同軸性・圧波形・カーブの支持を確認します。",
            )}
          </li>
        </ol>
        <p className="support-feedback">
          {t("カーブの支持：")}
          <b>
            {state.root
              ? e.support >= 0.6
                ? t("保たれている")
                : t("弱い")
              : t("まだない")}
          </b>
          {t("。注入の押し返しが支持を上回ると先端が外れます。")}
        </p>
        <p className="field-note">
          {t(
            "ジャドキンスの操作順は、指定された講義図と録画・修正指示を反映しています。ALは別形状の比較用です。冠尖と力学は教材用の近似で、実製品・症例の再現ではありません。デモの6 mL / 2秒は教材内の設定です。",
          )}
        </p>
      </div>
    </details>
  );
}
