import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { mockHandCamera } from "./fixtures/hand-camera";

test("records measurements, exports movements and samples, and preserves results in Japanese and English", async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  await mockHandCamera(page, 30);
  await page.route("**/api/jev/status", (r) =>
    r.fulfill({ json: { configured: true, model: "jev-1.13.0" } }),
  );
  let calls = 0;
  await page.route("**/api/jev/intent", (r) => {
    const body = r.request().postDataJSON();
    calls++;
    expect(Object.keys(body).sort()).toEqual(["id", "instrument", "recent"]);
    expect(Object.keys(body.recent[0]).sort()).toEqual(["push", "rotation"]);
    return r.fulfill({
      json: {
        id: body.id,
        model: "jev-1.13.0",
        elapsedMs: 10,
        push: { choice: "hold", confidence: 1, probability: 1 },
        rotation: { choice: "hold", confidence: 1, probability: 1 },
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("回転の入力", { exact: true }).selectOption("wrist");
  const begin = page.getByRole("button", { name: "測定を開始", exact: true });
  await expect(begin).toBeDisabled();
  await page.evaluate(() =>
    Object.assign(window, {
      __motion: {
        tick: 0,
        steps: 0,
        leftX: 0.65,
        leftY: 0.6,
        rightY: 0.6,
        leftAngle: 0,
        rightAngle: 0,
        pinch: true,
      },
    }),
  );
  await page
    .getByRole("button", { name: "カメラで操作を始める", exact: true })
    .click();
  await expect(page.getByText("掴んでいます・現在位置を保持")).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Jevアシストを使う（試験）" })
    .check();
  await begin.click();
  await expect(page.getByLabel("測定の状態")).toContainText("記録中");
  const motion = async (extra: Record<string, number | boolean>) => {
    await page.evaluate(
      (extra) =>
        Object.assign(window, {
          __motion: {
            tick: 0,
            steps: 20,
            leftX: 0.65,
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
  await motion({ leftDX: 0.005, rightDA: 1 });
  await motion({ leftX: 0.75, leftDX: -0.005, rightAngle: 20, rightDA: -1 });
  await motion({ pinch: false, steps: 5 });
  await page.getByRole("button", { name: "測定を停止", exact: true }).click();
  const recorded = await page.getByLabel("測定の状態").textContent();
  await page
    .getByRole("button", { name: "測定結果を見る", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "手操作の測定結果" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("img", { name: "押し引き速度の推移" }),
  ).toBeVisible();
  await expect(dialog.getByRole("table")).toContainText("Push");
  await expect(dialog.getByRole("table")).toContainText("Pull");
  await expect(dialog.getByRole("table")).toContainText("CW");
  await expect(dialog.getByRole("table")).toContainText("CCW");
  const exported = async (label: string) => {
    const waiting = page.waitForEvent("download");
    await dialog.getByRole("button", { name: label, exact: true }).click();
    const dl = await waiting;
    return fs.readFile((await dl.path())!, "utf8");
  };
  const data = JSON.parse(await exported("JSON保存（全記録）"));
  expect(data.schema).toBe("cath-lab-hand-measurements-v2");
  expect(data.units.force).toBe("not_measured");
  expect(data.samples.length).toBeGreaterThan(30);
  expect(data.movements.length).toBeGreaterThanOrEqual(4);
  expect(
    data.samples.some(
      (s: { handPushStep: number | null }) =>
        s.handPushStep !== null && s.handPushStep > 0,
    ),
  ).toBe(true);
  expect(
    data.samples.some(
      (s: { handPushStep: number | null }) =>
        s.handPushStep !== null && s.handPushStep < 0,
    ),
  ).toBe(true);
  expect(
    data.samples.some((s: { jevState: string }) => s.jevState === "active"),
  ).toBe(true);
  expect(calls).toBeGreaterThan(0);
  expect(
    data.samples.some(
      (s: { rotationPhase: string; handAngularSpeed: number | null }) =>
        s.rotationPhase === "released" && s.handAngularSpeed === null,
    ),
  ).toBe(true);
  const csv = await exported("CSV保存（時系列・全記録）");
  expect(csv).toContain("hand_speed_image_percent_per_s");
  expect(csv).not.toMatch(/NaN|Infinity/);
  const movements = await exported("CSV保存（動作ごと・全記録）");
  expect(movements).toContain("image_plane_degrees");
  await page.getByLabel("記録の時点").press("Home");
  await expect(page.getByLabel("選択時点の測定値")).toContainText("—");
  await page.getByLabel("評価範囲").selectOption("root");
  await expect(dialog).toContainText("この範囲の記録はありません。");
  await page.getByLabel("評価範囲").selectOption("all");
  await page.screenshot({
    path: "../../work/measurements/ja-results.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "結果を閉じる" }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  expect(
    (await page.getByLabel("Measurement status").textContent())!.match(
      /\d+/,
    )?.[0],
  ).toBe(recorded!.match(/\d+/)?.[0]);
  await page.getByRole("button", { name: "View measurements" }).click();
  const english = page.getByRole("dialog", {
    name: "Hand control measurements",
  });
  await expect(english).toBeVisible();
  expect(await english.textContent()).not.toMatch(/[ぁ-んァ-ン一-龯]/);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await english.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "../../work/measurements/en-mobile.png",
    fullPage: true,
  });
  await english.getByRole("button", { name: "Close results" }).click();
  await page.getByRole("button", { name: "Start a new measurement" }).click();
  await expect(page.getByLabel("Measurement status")).toContainText(
    "Recording",
  );
  await page.getByLabel("Hand update rate").selectOption("15");
  await expect(page.getByLabel("Measurement status")).not.toContainText(
    "Recording",
  );
  await page.getByRole("button", { name: "Stop camera", exact: true }).click();
  expect(errors).toEqual([]);
});

test("measures fine catheter Pull at the cusp without scaling the hand measurement", async ({
  page,
}) => {
  test.setTimeout(150000);
  await mockHandCamera(page, 30);
  await page.goto("/");
  await page.getByLabel("回転の入力", { exact: true }).selectOption("wrist");
  const click = async (label: string, count: number) =>
    page
      .getByRole("button", { name: label, exact: true })
      .evaluate((b: HTMLButtonElement, count) => {
        for (let i = 0; i < count; i++) b.click();
      }, count);
  await click("Push 進める", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await click("Push 進める", 34);
  await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
  await click("Pull 引く", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await click("Counterclockwise 反時計回り", 16);
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-catheter-phase",
    "bottom",
  );
  await page.evaluate(() =>
    Object.assign(window, {
      __motion: {
        tick: 0,
        steps: 0,
        leftX: 0.65,
        leftY: 0.6,
        rightY: 0.6,
        leftAngle: 0,
        rightAngle: 0,
        pinch: true,
      },
    }),
  );
  await page
    .getByRole("button", { name: "カメラで操作を始める", exact: true })
    .click();
  await expect(page.getByText("掴んでいます・現在位置を保持")).toBeVisible();
  await page.getByRole("button", { name: "測定を開始", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        (await page.getByLabel("測定の状態").textContent())!.match(
          /\d+/,
        )?.[0] ?? 0,
      ),
    )
    .toBeGreaterThan(2);
  await page.evaluate(() =>
    Object.assign(window, {
      __motion: {
        tick: 0,
        steps: 10,
        leftX: 0.65,
        leftY: 0.6,
        rightY: 0.6,
        leftAngle: 0,
        rightAngle: 0,
        pinch: true,
        leftDX: -0.02,
      },
    }),
  );
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-catheter-insertion",
    "95.045",
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "測定を停止", exact: true }).click();
  await page
    .getByRole("button", { name: "測定結果を見る", exact: true })
    .click();
  await page.getByLabel("評価範囲").selectOption("root");
  const dialog = page.getByRole("dialog", { name: "手操作の測定結果" });
  await expect(dialog).not.toContainText("この範囲の記録はありません。");
  const waiting = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "JSON保存（全記録）" }).click();
  const dl = await waiting;
  const data = JSON.parse(await fs.readFile((await dl.path())!, "utf8"));
  expect(
    data.samples.every(
      (s: { instrument: string; rootPhase: string }) =>
        s.instrument === "catheter" && s.rootPhase !== "approach",
    ),
  ).toBe(true);
  const moving = data.samples.filter(
    (s: { commandPush: number }) => s.commandPush < 0,
  );
  expect(moving.length).toBe(10);
  expect(
    moving.reduce(
      (n: number, s: { commandPush: number }) => n + s.commandPush,
      0,
    ),
  ).toBeCloseTo(-2.955, 5);
  for (const s of moving.filter(
    (s: { handPushStep: number | null }) => s.handPushStep !== null,
  )) {
    expect(s.handPushStep).toBeCloseTo(-2, 5);
    expect(s.commandPush).toBeCloseTo(s === moving[0] ? -0.255 : -0.3, 5);
  }
  await page.screenshot({
    path: "../../work/measurements/cusp-results.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "結果を閉じる" }).click();
  await page.getByRole("button", { name: "カメラを停止", exact: true }).click();
});
