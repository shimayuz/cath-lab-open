import { test, expect } from "@playwright/test";
import { mockHandCamera } from "./fixtures/hand-camera";

test("right fingers turn JL counterclockwise after wire removal without Bottom or switching the left-hand target", async ({
  page,
}) => {
  test.setTimeout(180000);
  await mockHandCamera(page, 30);
  await page.route("**/api/jev/status", (r) =>
    r.fulfill({ json: { configured: true, model: "jev-1.13.0" } }),
  );
  let requests = 0;
  const observedDirections = new Set<string>();
  await page.route("**/api/jev/intent", (r) => {
    requests++;
    for (const observation of r.request().postDataJSON().recent)
      observedDirections.add(observation.rotation.movement);
    return r.fulfill({
      json: {
        id: r.request().postDataJSON().id,
        model: "jev-1.13.0",
        elapsedMs: 10,
        push: { choice: "hold", confidence: 1, probability: 1 },
        rotation: { choice: "hold", confidence: 1, probability: 1 },
      },
    });
  });
  await page.goto("/");
  const click = async (label: string, n: number) =>
    page
      .getByRole("button", { name: label, exact: true })
      .evaluate((b: HTMLButtonElement, n) => {
        for (let i = 0; i < n; i++) b.click();
      }, n);
  await click("Push 進める", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await click("Push 進める", 31);
  await page.getByRole("checkbox", { name: "微調整", exact: true }).check();
  await click("Push 進める", 4);
  await page.getByRole("checkbox", { name: "微調整", exact: true }).uncheck();
  await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
  await click("Pull 引く", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await click("Counterclockwise 反時計回り", 16);
  const controls = page.getByLabel("カメラの操作対象");
  await controls.getByRole("button", { name: "ワイヤー", exact: true }).click();
  const canvas = page.getByTestId("anatomy-canvas");
  await expect(canvas).toHaveAttribute("data-catheter-phase", "descending");
  await page
    .getByRole("checkbox", { name: "Jevアシストを使う（試験）" })
    .check();
  await page
    .getByRole("button", { name: "カメラで操作を始める", exact: true })
    .click();
  await expect(page.getByText("2手・42点を追跡中")).toBeVisible();
  const motion = async (extra: Record<string, number | boolean> = {}) => {
    await page.evaluate(
      (extra) =>
        Object.assign(window, {
          __motion: {
            tick: 0,
            steps: 8,
            leftX: 0.7,
            leftY: 0.6,
            rightY: 0.6,
            leftAngle: 0,
            rightAngle: 0,
            pinch: true,
            ...extra,
          },
        }),
      extra,
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const m = (
              window as unknown as { __motion: { tick: number; steps: number } }
            ).__motion;
            return m.tick === m.steps;
          }),
        { timeout: 30000 },
      )
      .toBe(true);
  };
  await motion({ pinch: false });
  await motion();
  await expect(
    page
      .locator(".hand-readout .clutch-state")
      .filter({ hasText: "掴んでいます" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "測定を開始", exact: true }).click();
  await motion({ steps: 10, leftDX: -0.019, rightRollD: 31 / 180 / 10 });
  await expect
    .poll(() => observedDirections.has("counterclockwise"))
    .toBe(true);
  // Left still targets the empty wire. Right rotates the catheter, not the wire.
  await expect(
    controls.getByRole("button", { name: "ワイヤー", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-catheter-insertion", "95.000");
  await expect(canvas).toHaveAttribute("data-catheter-rotation", "-94.000");
  await expect(controls.getByLabel("ワイヤー抜去の状態")).toHaveText(
    "ワイヤー抜去完了（残量0%）",
  );
  await expect(page.getByLabel("回転入力の状態")).toContainText("-94.0°");
  await motion({ pinch: false, leftX: 0.7, rightRoll: 0 });
  await controls
    .getByRole("button", { name: "カテーテル", exact: true })
    .click();
  await motion();
  await motion({ steps: 10, leftDX: -0.014 });
  await expect(canvas).toHaveAttribute("data-catheter-phase", "engaged");
  const inject = page.getByRole("button", {
    name: "造影する LCA",
    exact: true,
  });
  await expect(inject).toBeEnabled({ timeout: 10000 });
  await inject.click();
  await expect(
    page.getByRole("status").filter({ hasText: "LCAの注入を終えました" }),
  ).toBeVisible({ timeout: 15000 });
  expect(requests).toBeGreaterThan(0);
  await page.screenshot({
    path: "../../work/independent-rotation/jl-lca.png",
    fullPage: true,
  });
  // Reverse the right finger movement while the left stays still: CW also responds.
  await motion({ steps: 8, leftX: 0.48, rightRollD: -0.01 });
  expect(
    Number(await canvas.getAttribute("data-catheter-rotation")),
  ).toBeGreaterThan(-90);
  await expect.poll(() => observedDirections.has("clockwise")).toBe(true);
  await page
    .getByRole("button", { name: "測定結果を見る", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "手操作の測定結果" });
  await dialog.getByLabel("評価範囲", { exact: true }).selectOption("root");
  await expect(dialog.getByRole("table")).toContainText("CCW");
  await expect(dialog.getByLabel("選択時点の測定値")).toContainText("95.000");
  await dialog.getByLabel("評価範囲", { exact: true }).selectOption("wire");
  await expect(dialog.getByRole("table")).not.toContainText("CCW");
  await dialog
    .getByRole("button", { name: "結果を閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "カメラを停止", exact: true }).click();
});
