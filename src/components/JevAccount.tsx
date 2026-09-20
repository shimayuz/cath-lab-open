import { useState } from "react";
import { useI18n } from "../i18n/I18n";
import type { useJevAssist } from "../hand/useJevAssist";
import { accountPost, openStripe } from "../billing/client";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
export function JevAccount({ jev }: { jev: ReturnType<typeof useJevAssist> }) {
  const { t } = useI18n(),
    access = jev.hosted;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [recovery, setRecovery] = useState(""),
    [recoveryInput, setRecoveryInput] = useState(""),
    [recovering, setRecovering] = useState(false);
  if (!access) return null;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      await jev.refresh();
      setBusy(false);
    }
  };
  const passkey = async (kind: "register" | "login") => {
    const webauthn = await import("@simplewebauthn/browser");
    if (!webauthn.browserSupportsWebAuthn()) throw Error("passkey-unavailable");
    const result =
      kind === "register"
        ? await webauthn.startRegistration({
            optionsJSON:
              await accountPost<PublicKeyCredentialCreationOptionsJSON>(
                "auth/register/options",
              ),
          })
        : await webauthn.startAuthentication({
            optionsJSON:
              await accountPost<PublicKeyCredentialRequestOptionsJSON>(
                "auth/login/options",
              ),
          });
    const verified = await accountPost<{ recovery?: string | null }>(
      `auth/${kind}/verify`,
      result,
    );
    if (verified.recovery) setRecovery(verified.recovery);
  };
  const errorText =
    error === "reauthenticate"
      ? t("パスキーで再ログインしてから、もう一度お試しください。")
      : error === "recovery-confirmation-failed"
        ? t(
            "この端末のパスキーを追加し、最後に発行された復旧コードを保存してください。",
          )
        : error === "billing-not-configured"
          ? t("Stripeの接続待ちです。基本シミュレーターは利用できます。")
          : error === "existing-subscription-use-portal"
            ? t(
                "契約が登録されています。「契約・支払いを管理」から確認してください。",
              )
            : error === "rate-limited"
              ? t("しばらく待ってから、もう一度お試しください。")
              : error === "invalid-recovery"
                ? t("復旧コードを確認してください。")
                : error === "save-recovery-code"
                  ? t("復旧コードを保存してから契約へ進んでください。")
                  : error === "checkout-busy" ||
                      error === "checkout-reconciliation-required"
                    ? t(
                        "決済の状態を確認しています。少し待って契約状態を更新してください。",
                      )
                    : error === "passkey-unavailable"
                      ? t("パスキーに対応したブラウザでお試しください。")
                      : t(
                          "操作を完了できませんでした。通信とパスキーを確認して、再度お試しください。",
                        );
  return (
    <section className="jev-account" aria-label={t("Jev Proの契約")}>
      <div className="jev-account-title">
        <strong>Jev Pro</strong>
        <span>{t("月額5ドル（USD）")}</span>
      </div>
      <p>
        {t(
          "基本機能はログイン不要・無料です。Jevだけ、有効な契約がある方がONにできます。",
        )}
      </p>
      {!access.signedIn ? (
        <>
          <div className="jev-account-actions">
            <button
              disabled={busy}
              onClick={() => void run(() => passkey("register"))}
            >
              {t("パスキーで登録")}
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => passkey("login"))}
            >
              {t("パスキーでログイン")}
            </button>
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setRecovering(!recovering)}
          >
            {t("復旧コードでログイン")}
          </button>
          {recovering && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const data = await accountPost<{ recovery: string }>(
                    "auth/recover",
                    { recovery: recoveryInput },
                  );
                  setRecovery(data.recovery);
                  setRecoveryInput("");
                  setRecovering(false);
                  await passkey("register");
                });
              }}
            >
              <label>
                {t("復旧コード")}
                <input
                  type="password"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <button disabled={busy}>{t("アカウントを復旧")}</button>
            </form>
          )}
        </>
      ) : (
        <>
          <p className="jev-plan-status">
            {access.subscribed ? t("Jev Pro 契約中") : t("無料プランで利用中")}
          </p>
          {access.subscribed && (
            <p>
              {t(
                "今月のJev判定：{0} / {1}回",
                access.usage.toLocaleString(),
                access.limit.toLocaleString(),
              )}
            </p>
          )}
          <div className="jev-account-actions">
            <button
              disabled={busy}
              onClick={() => void run(() => passkey("login"))}
            >
              {t("パスキーでログイン")}
            </button>
            {!access.subscribed && (
              <button
                disabled={
                  busy || !access.billingReady || !access.recoveryConfirmed
                }
                onClick={() =>
                  void run(async () =>
                    openStripe((await accountPost("billing/checkout")).url),
                  )
                }
              >
                {t("月額5ドルでJevを有効にする")}
              </button>
            )}
            {access.hasCustomer && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    openStripe((await accountPost("billing/portal")).url),
                  )
                }
              >
                {t("契約・支払いを管理")}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await accountPost("billing/refresh");
                })
              }
            >
              {t("契約状態を更新")}
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => passkey("register"))}
            >
              {t("この端末のパスキーを追加")}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  jev.setEnabled(false);
                  await accountPost("auth/logout");
                  setRecovery("");
                })
              }
            >
              {t("ログアウト")}
            </button>
          </div>
        </>
      )}
      {recovery && (
        <div className="recovery-code">
          <strong>{t("復旧コードを保存してください")}</strong>
          <p>
            {t(
              "パスキーを失った場合に必要です。一度しか表示しません。誰にも共有しないでください。",
            )}
          </p>
          <code>{recovery}</code>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const url = URL.createObjectURL(
                  new Blob(
                    [
                      `Cath Lab recovery code\n${recovery}\nhttps://cath-lab.pages.dev/\n`,
                    ],
                    { type: "text/plain" },
                  ),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "cath-lab-recovery.txt";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                await accountPost("auth/confirm-recovery", { recovery });
                setRecovery("");
              })
            }
          >
            {t("復旧コードを保存")}
          </button>
        </div>
      )}
      {access.signedIn && !access.recoveryConfirmed && !recovery && (
        <p>
          {t(
            "復旧コードが未確認です。新しいコードを発行して保存してください。",
          )}

          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setRecovery(
                  (await accountPost<{ recovery: string }>("auth/new-recovery"))
                    .recovery,
                );
              })
            }
          >
            {t("復旧コードを再発行")}
          </button>
        </p>
      )}
      {!access.billingReady && (
        <p role="status">
          {t("Stripeの接続待ちです。基本シミュレーターは利用できます。")}
        </p>
      )}
      <p className="jev-plan-terms">
        {t(
          "月50,000回までのJev判定を含みます（UTC暦月）。追加請求なし。解約は契約管理から行えます。カメラ映像は送信しません。",
        )}
      </p>
      {busy && <p role="status">{t("処理しています…")}</p>}
      {error && <p role="alert">{errorText}</p>}
    </section>
  );
}
