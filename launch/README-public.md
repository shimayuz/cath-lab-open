# Cath Lab

Explore coronary catheter movements in 3D. A learning prototype for medical students and early-career trainees, built with GPT-6-Astra.

[Open simulator](https://cath-lab.pages.dev) · [日本語](https://cath-lab.pages.dev/?lang=ja) · [About](https://cath-lab.pages.dev/about/)

## What you can explore

- Radial/femoral access, JL/JR/AL catheters and a J-tip guidewire.
- Push/pull and catheter rotation; 3D and simulated fluoroscopy with a 6–10 inch field of view.
- Camera hand controls using local MediaPipe processing.
- Movement graphs and CSV/JSON exports; English and Japanese interfaces.

This is a research and development prototype. It is **not clinically validated**, not a medical device, and not a clinical competency assessment. It does not measure physical force or catheter torque. PCI devices are not implemented.

## Quick start

Requires Node.js 22.22+ and Git LFS (binary models use LFS).

```sh
git lfs install
git clone https://github.com/shimayuz/cath-lab-open.git
cd cath-lab-open
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The core simulator and local hand tracking do not require an API key or a subscription. Camera access requires a secure browser context (localhost works).

```sh
npm test
npm run build
npm run prepare:test
npm run test:e2e
```

The E2E suite uses an installed Chrome browser and downloads a public MediaPipe hand image to ignored test fixtures. Synthetic hand fixtures are not evidence of real-hand control accuracy.

## Jev and pricing

**Free:** the complete browser simulator, local camera hand controls, graphs and exports. No account is needed. The public root serves the simulator; the separate product page lives at `/about/`.

**Jev Pro: USD $5/month through Stripe**, only for the operator-hosted Jev feature. An active, paid subscription enables the Jev toggle. A free account or a client-side flag cannot enable the API. Passkey sign-in, recovery codes, durable account mapping, atomic usage limits and server-side payment checks are implemented. The included allowance is 50,000 intent requests per UTC month with no overage charge.

**Live checkout remains disabled until the operator connects Stripe and completes payment setup/testing.** The simulator remains fully usable during this setup. See [hosted setup and billing status](launch/BILLING.md).

For local development, you may bring your own TypeSafe API key in `.env.local` (copy `.env.example`). This sends hand movement summaries, not camera frames, to TypeSafe when Jev is explicitly enabled. Provider fees are your responsibility. Self-hosting does not grant access to our hosted API. Never use a `VITE_` prefix for a secret key. The existing Vite Jev endpoint deliberately accepts loopback traffic only; do not expose it as a production service.

Jev-assisted intent classification is experimental. Better precision, latency and educational outcomes have not been demonstrated.

## Licenses and data

Original application code is MIT-licensed; **vascular data and third-party software have separate terms**. Read [NOTICE.md](NOTICE.md) before redistributing or deploying. The included Vascular Model Repository data is permitted for research and development under its supplied license. Commercial/paid hosting has not been cleared. No private user videos, original lecture slides, or catheter reference image are included in this public snapshot.

## 日本語

医学生・若手研修医が、カテーテルの押し引き・回転と冠動脈への経路を体験するための研究・開発用プロトタイプです。画面で日本語／英語を切り替えられます。公開サイトで基本シミュレーターをログイン不要・無料で利用できます。Jevだけを月額5ドルの契約者がONにできる構成です。認証・利用権の仕組みは実装済みですが、Stripe本番接続が完了するまで契約・請求は無効です。コードの公開は、運営者のAPIキーや有料サービスの利用権の提供を意味しません。

臨床的な妥当性、実手技の技能評価、Jevによる精度向上は未実証です。血管データには研究・開発目的の利用条件があります。有料版への使用可否を確認するまで商用サービスとして提供しません。
