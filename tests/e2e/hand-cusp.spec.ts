import { test, expect } from "@playwright/test";
import { mockHandCamera } from "./fixtures/hand-camera";
for (const access of ["radial", "femoral"] as const) {
  test(`hands deliver catheter to Ao cusp and reverse wire without releasing: ${access}`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await mockHandCamera(page, 30);
    // Local-only vs Jev with deliberately wrong, fresh confident holds.
    await page.route("**/api/jev/status", (r) =>
      r.fulfill({ json: { configured: true, model: "jev-1.13.0" } }),
    );
    await page.route("**/api/jev/intent", (r) => {
      const request = r.request().postDataJSON();

      return r.fulfill({
        json: {
          id: request.id,
          model: "jev-1.13.0",
          elapsedMs: 10,
          push: {
            choice: "hold",
            confidence: 1,
            probability: 1,
          },
          rotation: {
            choice: "hold",
            confidence: 1,
            probability: 1,
          },
        },
      });
    });
    await page.goto("/");
    await page.getByLabel("回転の入力", { exact: true }).selectOption("wrist");
    if (access === "femoral") {
      await page
        .getByRole("button", { name: "F 右鼠径部 大腿動脈からのアプローチ" })
        .click();
      await page
        .getByRole("checkbox", { name: "Jevアシストを使う（試験）" })
        .check();
    }
    await page
      .getByRole("button", { name: "カメラで操作を始める", exact: true })
      .click();
    await expect(page.getByText("2手・42点を追跡中")).toBeVisible();
    const output = page.getByLabel("カメラ操作の挿入量");
    const value = async () =>
      Number((await output.textContent())!.match(/([\d.]+)%/)![1]);
    const motion = async (extra: Record<string, number | boolean>) => {
      await page.evaluate(
        (extra) =>
          Object.assign(window, {
            __motion: {
              tick: 0,
              steps: 5,
              leftX: 0.6,
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
          { timeout: 30000, intervals: [100] },
        )
        .toBe(true);
    };
    const push = async () => {
      await motion({ pinch: false });
      await motion({});
      await motion({ steps: 20, leftDX: 0.01 });
    };
    for (let i = 0; i < 4; i++) await push();
    expect(await value()).toBe(100);
    // No release: move to the right in the mirrored preview by decreasing raw x.
    await motion({ leftX: 0.8, steps: 10, leftDX: -0.01 });
    expect(await value()).toBeCloseTo(85, 0);
    await motion({ leftX: 0.7, steps: 10, leftDX: 0.01 });
    expect(await value()).toBe(100);
    await motion({ leftX: 0.8, pinch: false });
    await page
      .getByLabel("カメラの操作対象")
      .getByRole("button", { name: "カテーテル", exact: true })
      .click();
    for (let i = 0; i < 4; i++) await push();
    expect(await value()).toBe(98);
    await motion({ leftX: 0.8, pinch: false });
    await page
      .getByLabel("カメラの操作対象")
      .getByRole("button", { name: "ワイヤー", exact: true })
      .click();
    for (let i = 0; i < 4; i++) {
      await motion({ leftX: 0.8, pinch: false });
      await motion({ leftX: 0.8 });
      await motion({ leftX: 0.8, steps: 20, leftDX: -0.01 });
    }
    expect(await value()).toBe(0);
    await motion({ pinch: false });
    await page
      .getByLabel("カメラの操作対象")
      .getByRole("button", { name: "カテーテル", exact: true })
      .click();
    await motion({});
    await motion({ steps: 40, rightDA: -4 });
    const canvas = page.getByTestId("anatomy-canvas");
    await expect(canvas).toHaveAttribute("data-catheter-phase", "bottom");
    await page.getByRole("button", { name: "冠尖を拡大", exact: true }).click();
    await page.screenshot({
      path: `../../work/hand-pull/${access}-cusp.png`,
      fullPage: true,
    });
    // First lift past the model's 96 bottom, with continuous held Pull.
    await motion({ steps: 15, leftDX: -0.01, rightAngle: -160 });
    await expect.poll(value).toBeCloseTo(95.795, 1);
    await expect(canvas).toHaveAttribute("data-catheter-phase", "lifting");
    const tip = (await canvas.getAttribute("data-catheter-tip"))!
      .split(",")
      .map(Number);
    // A small pull is now 0.75, rather than the previous 7.5 insertion units.
    await motion({ leftX: 0.45, steps: 5, leftDX: -0.01, rightAngle: -160 });
    await expect.poll(value).toBeCloseTo(95.045, 1);
    const lifted = (await canvas.getAttribute("data-catheter-tip"))!
      .split(",")
      .map(Number);
    expect(Math.hypot(...lifted.map((x, i) => x - tip[i]))).toBeLessThan(0.3);
    await expect(canvas).toHaveAttribute("data-catheter-phase", "lifting");
    // Root rotation uses half-angle gain and bounded reversal slack at any cadence.
    await motion({ leftX: 0.4, steps: 4, rightAngle: -160, rightDA: 5 });
    await expect(canvas).toHaveAttribute("data-catheter-rotation", "-70.400");
    await motion({ leftX: 0.4, steps: 4, rightAngle: -140, rightDA: -5 });
    await expect(canvas).toHaveAttribute("data-catheter-rotation", "-79.600");
    await motion({ leftX: 0.4, steps: 20, leftDX: 0.01, rightAngle: -160 });
    await expect.poll(value).toBeCloseTo(98, 1);
    await expect(canvas).toHaveAttribute("data-catheter-phase", "bottom");
    const held = await value();
    await motion({ pinch: false, rightAngle: -160 });
    await motion({ pinch: false, steps: 10, leftDX: -0.01, rightAngle: -160 });
    expect(await value()).toBe(held);
    await page
      .getByRole("button", { name: "カメラを停止", exact: true })
      .click();
  });
}
