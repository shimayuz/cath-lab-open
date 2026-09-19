import { test, expect } from "@playwright/test";
import { mockHandCamera } from "./fixtures/hand-camera";
for (const [cat, side, turn, count, arc] of [
  ["JL", "LCA", "Counterclockwise 反時計回り", 16, -28.8],
  ["JR", "RCA", "Clockwise 時計回り", 5, 26.8],
] as const) {
  test(`${cat}: camera fine turn and Pull engage, hold with noise and complete injection (${cat === "JR" ? "Jev on" : "Jev off"})`, async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await mockHandCamera(page, 30);
    await page.route("**/api/jev/status", (r) =>
      r.fulfill({ json: { configured: true, model: "jev-1.13.0" } }),
    );
    let requests = 0;
    await page.route("**/api/jev/intent", (r) => {
      requests++;
      const { id } = r.request().postDataJSON();
      return r.fulfill({
        json: {
          id,
          model: "jev-1.13.0",
          elapsedMs: 10,
          push: { choice: "hold", confidence: 1, probability: 1 },
          rotation: { choice: "hold", confidence: 1, probability: 1 },
        },
      });
    });
    await page.goto("/");
    await page.getByLabel("回転の入力", { exact: true }).selectOption("wrist");
    if (cat === "JR") {
      await page
        .getByRole("button", { name: "F 右鼠径部 大腿動脈からのアプローチ" })
        .click();
      await page.getByRole("button", { name: /RCA 右冠動脈/ }).click();
      await page
        .getByRole("button", { name: "JR Judkins right", exact: true })
        .click();
    }
    const click = async (label: string, n: number) =>
      page
        .getByRole("button", { name: label, exact: true })
        .evaluate((b: HTMLButtonElement, n) => {
          for (let i = 0; i < n; i++) b.click();
        }, n);
    await click("Push 進める", 34);
    await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
    await click("Push 進める", 32);
    await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
    await click("Pull 引く", 34);
    await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
    await click(turn, count);
    const canvas = page.getByTestId("anatomy-canvas");
    await expect(canvas).toHaveAttribute("data-catheter-phase", "bottom");
    const motion = async (extra: Record<string, number | boolean> = {}) => {
      await page.evaluate(
        (extra) =>
          Object.assign(window, {
            __motion: {
              tick: 0,
              steps: 5,
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
                window as unknown as {
                  __motion: { tick: number; steps: number };
                }
              ).__motion;
              return m.tick === m.steps;
            }),
          { timeout: 30000 },
        )
        .toBe(true);
    };
    await page
      .getByRole("button", { name: "カメラで操作を始める", exact: true })
      .click();
    await expect(page.getByText("2手・42点を追跡中")).toBeVisible();
    if (cat === "JR")
      await page
        .getByRole("checkbox", { name: "Jevアシストを使う（試験）" })
        .check();
    await motion({ pinch: false });
    await motion();
    await motion({ steps: 10, leftDX: -0.019, rightDA: arc / 10 });
    await expect(canvas).toHaveAttribute("data-catheter-phase", "lifting");
    // This step passes over the narrow entrance: no exact 93.000 sample.
    await motion({ steps: 1, leftX: 0.48, rightAngle: arc });
    await expect(canvas).toHaveAttribute("data-catheter-phase", "engaged");
    await expect(canvas).toHaveAttribute("data-catheter-insertion", "92.745");
    await motion({
      steps: 12,
      leftX: 0.48,
      rightAngle: arc,
      leftNoise: 0.002,
      angleNoise: 0.5,
    });
    const inject = page.getByRole("button", {
      name: `造影する ${side}`,
      exact: true,
    });
    await expect(inject).toBeEnabled({ timeout: 10000 });
    await inject.click();
    await expect(
      page.getByRole("status").filter({ hasText: `${side}の注入を終えました` }),
    ).toBeVisible({ timeout: 15000 });
    await expect(canvas).toHaveAttribute("data-catheter-phase", "engaged");
    await page.screenshot({
      path: `../../work/hand-engage/${cat}-engaged.png`,
      fullPage: true,
    });
    if (cat === "JR") expect(requests).toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "カメラを停止", exact: true })
      .click();
    expect(errors).toEqual([]);
  });
}
