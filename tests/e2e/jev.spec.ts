import { test, expect } from "@playwright/test";
import { mockHandCamera } from "./fixtures/hand-camera";

test("Jev is optional, never blocks movement, and can be stopped while checking connection", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockHandCamera(page, 60);
  let statusCalls = 0,
    intentCalls = 0;
  await page.route("**/api/jev/status", async (route) => {
    statusCalls++;
    if (statusCalls > 1) await new Promise((r) => setTimeout(r, 1000));
    await route.fulfill({ json: { configured: true, model: "jev-1.13.0" } });
  });
  await page.route("**/api/jev/intent", async (route) => {
    intentCalls++;
    const body = route.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["id", "instrument", "recent"]);
    expect(body.recent.length).toBeLessThanOrEqual(6);
    // A late hold must not freeze current movement or survive OFF/stop.
    await new Promise((r) => setTimeout(r, 650));
    await route.fulfill({
      json: {
        id: body.id,
        model: "jev-1.13.0",
        elapsedMs: 650,
        push: { choice: "hold", confidence: 1, probability: 1 },
        rotation: { choice: "hold", confidence: 1, probability: 1 },
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("回転の入力", { exact: true }).selectOption("wrist");
  const toggle = page.getByRole("checkbox", {
    name: "Jevアシストを使う（試験）",
  });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByLabel("手の更新頻度")).toHaveValue("30");
  await page.getByLabel("Pushの方向").selectOption("up");
  await page
    .getByRole("button", { name: "カメラで操作を始める", exact: true })
    .click();
  await expect(page.getByText("2手・42点を追跡中")).toBeVisible();
  await expect(page.getByText("掴んでいます・現在位置を保持")).toBeVisible();
  expect(intentCalls).toBe(0);
  await toggle.check();
  await expect.poll(() => intentCalls).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.assign(window, {
      __motion: {
        tick: 0,
        steps: 35,
        leftY: 0.6,
        rightY: 0.6,
        leftAngle: 0,
        rightAngle: 0,
        pinch: true,
        leftDY: -0.001,
      },
    });
  });
  const amount = page.getByLabel("カメラ操作の挿入量");
  await expect
    .poll(async () =>
      Number((await amount.textContent())!.match(/([\d.]+)%/)![1]),
    )
    .toBeGreaterThan(3.5);
  await expect(page.getByLabel("Jevの状態")).toContainText("古い判定");
  await expect(page.getByLabel("手の処理速度")).toBeVisible();
  const samples: Record<string, string> = {};
  for (const rate of ["15", "30"]) {
    await page.getByLabel("手の更新頻度").selectOption(rate);
    // Measurement only; software-rendered CI cadence is not a physical camera benchmark.
    await page.waitForTimeout(1500);
    samples[rate] = (await page.getByLabel("手の処理速度").textContent())!;
  }
  console.log("Synthetic detector cadence", samples);
  await page
    .getByRole("button", { name: "接続設定を再確認", exact: true })
    .click();
  await expect(page.getByLabel("Jevの状態")).toContainText("確認中");
  await expect(toggle).toBeEnabled();
  await toggle.uncheck();
  const sent = intentCalls;
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Use Jev assist (experimental)" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  await page.waitForTimeout(1000);
  expect(intentCalls).toBe(sent);
  await expect(page.getByLabel("Jev status")).toHaveText("Jev assist OFF");
  await page.screenshot({
    path: "../../work/jev/english-panel.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("fresh confident Jev holds do not suppress gripped CW or CCW", async ({
  page,
}) => {
  await mockHandCamera(page, 30);
  const directions = new Set<string>();
  await page.route("**/api/jev/status", (r) =>
    r.fulfill({ json: { configured: true, model: "jev-1.13.0" } }),
  );
  await page.route("**/api/jev/intent", (r) => {
    const request = r.request().postDataJSON();
    directions.add(request.recent.at(-1).rotation.movement);
    return r.fulfill({
      json: {
        id: request.id,
        model: "jev-1.13.0",
        elapsedMs: 10,
        push: { choice: "hold", confidence: 1, probability: 1 },
        rotation: { choice: "hold", confidence: 1, probability: 1 },
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("回転の入力", { exact: true }).selectOption("wrist");
  // Rotation controls an inserted catheter, not a device still outside the body.
  await page.getByRole("button", { name: "Push 進める", exact: true }).click();
  await page
    .getByLabel("カメラの操作対象")
    .getByRole("button", { name: "カテーテル", exact: true })
    .click();
  await page.getByRole("button", { name: "Push 進める", exact: true }).click();
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-catheter-insertion",
    "1.000",
  );
  await page
    .getByRole("checkbox", { name: "Jevアシストを使う（試験）" })
    .check();
  await page
    .getByRole("button", { name: "カメラで操作を始める", exact: true })
    .click();
  await expect(page.getByText("掴んでいます・現在位置を保持")).toBeVisible();
  for (const [start, sign, direction] of [
    [0, 1, "clockwise"],
    [32, -1, "counterclockwise"],
  ] as const) {
    await page.evaluate(
      ({ start, sign }) => {
        const w = window as unknown as {
          __motion: Record<string, number | boolean>;
          __freshAngles: number[];
          __holdObserver?: MutationObserver;
        };
        w.__holdObserver?.disconnect();
        w.__freshAngles = [];
        w.__motion = {
          tick: 0,
          steps: 40,
          leftX: 0.75,
          leftY: 0.6,
          rightY: 0.6,
          leftAngle: 0,
          rightAngle: start,
          pinch: true,
          rightDA: sign * 0.8,
        };
        w.__holdObserver = new MutationObserver(() => {
          const status = document.querySelector('[aria-label="Jevの状態"]');
          const canvas = document.querySelector(
            '[data-testid="anatomy-canvas"]',
          ) as HTMLElement;
          if (
            status?.textContent?.includes("Jev判定を受信") &&
            Number(w.__motion.tick) < Number(w.__motion.steps)
          ) {
            w.__freshAngles.push(Number(canvas.dataset.catheterRotation));
          }
        });
        w.__holdObserver.observe(document.body, {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
      },
      { start, sign },
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as {
              __motion: { tick: number; steps: number };
            };
            return w.__motion.tick === w.__motion.steps;
          }),
        { timeout: 30000 },
      )
      .toBe(true);
    const angles = await page.evaluate(
      () => (window as unknown as { __freshAngles: number[] }).__freshAngles,
    );
    expect(directions.has(direction)).toBe(true);
    expect(angles.length).toBeGreaterThan(1);
    // Several further degrees while a real, fresh hold decision is active, not just pending.
    expect(sign * (angles.at(-1)! - angles[0])).toBeGreaterThan(2);
    await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
      "data-catheter-rotation",
      sign > 0 ? "32.000" : "0.000",
    );
  }
  await page.getByRole("button", { name: "カメラを停止", exact: true }).click();
});
