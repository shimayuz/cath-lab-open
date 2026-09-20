import { test, expect } from "@playwright/test";

test.skip(
  !process.env.CATH_TEST_ORIGIN,
  "Requires the hosted Pages server and D1",
);

test("hosted guest keeps free simulator and fluoroscopy while Jev stays locked", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?lang=ja");
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-model-state",
    "ready",
  );
  await expect(
    page.getByRole("checkbox", { name: "Jevアシストを使う（試験）" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "カメラで操作を始める", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Push 進める", exact: true })
    .press("Enter");
  await expect(page.getByTestId("insertion-value")).not.toHaveText(
    /^0(?:\.0)?%$/,
  );
  await page.getByRole("button", { name: "透視", exact: true }).click();
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-model-state",
    "ready",
  );
  await page
    .getByRole("button", { name: "Flat panel 10 inch", exact: true })
    .click();
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-field-of-view",
    "10",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Create account with a passkey",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../work/hosted/mobile-free.png",
    fullPage: true,
  });
  await page.goto("/about/?lang=ja");
  await expect(
    page.getByRole("link", { name: "シミュレーターを使う", exact: true }),
  ).toHaveAttribute("href", "/");
  expect(errors).toEqual([]);
});

test("real WebAuthn registration, login and recovery preserve the account", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto("/?lang=ja#jev-access");
  await page
    .getByRole("button", { name: "パスキーで登録", exact: true })
    .click();
  const code = page.locator(".recovery-code code");
  await expect(code).toBeVisible();
  const original = (await code.textContent())!;
  await page
    .getByRole("button", { name: "復旧コードを保存", exact: true })
    .click();
  await expect(code).toHaveCount(0);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await page
    .getByRole("button", { name: "パスキーでログイン", exact: true })
    .click();
  await expect(
    page.getByText("無料プランで利用中", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await page
    .getByRole("button", { name: "復旧コードでログイン", exact: true })
    .click();
  await page.getByLabel("復旧コード", { exact: true }).fill(original);
  await page
    .getByRole("button", { name: "アカウントを復旧", exact: true })
    .click();
  await expect(code).toBeVisible();
  await expect(
    page.getByRole("button", { name: "復旧コードを保存", exact: true }),
  ).toBeEnabled();
  expect(await code.textContent()).not.toBe(original);
  await page
    .getByRole("button", { name: "復旧コードを保存", exact: true })
    .click();
  await expect(code).toHaveCount(0);
  await expect(page.locator(".jev-account [role=alert]")).toHaveCount(0);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await page
    .getByRole("button", { name: "パスキーでログイン", exact: true })
    .click();
  await expect(
    page.getByText("無料プランで利用中", { exact: true }),
  ).toBeVisible();
});

test("only active hosted membership unlocks Jev and revocation turns it off", async ({
  page,
}) => {
  let subscribed = true;
  await page.route("**/api/jev/status", (route) =>
    route.fulfill({
      json: {
        mode: "hosted",
        configured: subscribed,
        signedIn: true,
        subscribed,
        billingReady: true,
        recoveryConfirmed: true,
        hasCustomer: true,
        usage: 0,
        limit: 50000,
      },
    }),
  );
  await page.goto("/?lang=ja");
  const toggle = page.getByRole("checkbox", {
    name: "Jevアシストを使う（試験）",
  });
  await expect(toggle).toBeEnabled();
  await toggle.check();
  await expect(toggle).toBeChecked();
  subscribed = false;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("cath-subscription-recheck")),
  );
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Push 進める", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "カメラで操作を始める", exact: true }),
  ).toBeEnabled();
});

test("hosted CSP allows the real MediaPipe runtime without a Jev subscription", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    setInterval(() => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 640, 480);
    }, 50);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => canvas.captureStream(20),
    });
  });
  await page.goto("/?lang=ja");
  await page
    .getByRole("button", { name: "カメラで操作を始める", exact: true })
    .click();
  await expect(
    page.getByText("操作する手を探しています", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("手の処理速度")).toContainText("回/秒", {
    timeout: 15000,
  });
  await expect(
    page.getByRole("checkbox", { name: "Jevアシストを使う（試験）" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "カメラを停止", exact: true }).click();
  expect(errors).toEqual([]);
});
