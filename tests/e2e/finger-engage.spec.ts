import fs from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { mockHandCamera } from "./fixtures/hand-camera";
for (const [cat, side, turn, count, arc] of [
  ["JL", "LCA", "Counterclockwise 反時計回り", 16, 31 / 180],
  ["JR", "RCA", "Clockwise 時計回り", 5, -29 / 180],
] as const) {
  test(`${cat}: finger-only turn and Pull engage, hold with noise and complete injection (${cat === "JR" ? "Jev on" : "Jev off"})`, async ({
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
    await expect(page.getByLabel("回転の入力", { exact: true })).toHaveValue(
      "fingers",
    );
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
    await click("Pull 引く", 32); // 4% remains inside the catheter, invisible near the cusp.
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
    if (cat === "JL")
      await page
        .getByRole("button", { name: "測定を開始", exact: true })
        .click();
    await motion({ steps: 8 });
    await expect(
      page
        .locator(".hand-readout .clutch-state")
        .filter({ hasText: "掴んでいます" }),
    ).toHaveCount(2);
    await motion({ steps: 10, leftDX: -0.019, rightRollD: arc / 10 });
    await expect(canvas).toHaveAttribute("data-catheter-phase", "lifting");
    // This step passes over the narrow entrance: no exact 93.000 sample.
    await motion({ steps: 1, leftX: 0.48, rightRoll: arc });
    await expect(canvas).toHaveAttribute("data-catheter-phase", "engaged");
    await expect(canvas).toHaveAttribute("data-catheter-insertion", "92.745");
    const wireControls = page.getByLabel("カメラの操作対象");
    const injectBeforeRemoval = page.getByRole("button", {
      name: `造影する ${side}`,
      exact: true,
    });
    await expect(injectBeforeRemoval).toBeDisabled();
    await expect(wireControls.getByLabel("ワイヤー抜去の状態")).toHaveText(
      "ワイヤー残量 4.0%・未抜去",
    );
    await expect(page.getByLabel("左右の手の役割")).toHaveText(
      "左手：Push / Pull · 右手の親指・人差し指：Clock / Counter",
    );
    const beforeRemoval = await canvas.getAttribute("data-catheter-rotation");
    if (cat === "JL") {
      await wireControls
        .getByRole("button", { name: "ワイヤーを選んでPull", exact: true })
        .click();
      await motion({ pinch: false, leftX: 0.7, rightRoll: arc });
      await motion({ leftX: 0.7, rightRoll: arc });
      await motion({ steps: 10, leftX: 0.7, leftDX: -0.004, rightRoll: arc });
      await expect(wireControls.getByLabel("ワイヤー抜去の状態")).toHaveText(
        "ワイヤー抜去完了（残量0%）",
      );
      await expect(
        wireControls.getByRole("button", { name: "ワイヤー", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await motion({ pinch: false, leftX: 0.48, rightRoll: arc });
      await wireControls
        .getByRole("button", { name: "カテーテルの操作に戻る", exact: true })
        .click();
    } else {
      await wireControls
        .getByRole("button", { name: "ワイヤーを完全に抜く", exact: true })
        .click();
      // A held grip cannot leak the old stroke into the catheter after the shortcut.
      await motion({ steps: 5, leftX: 0.48, rightRoll: arc });
      await motion({
        steps: 8,
        leftX: 0.48,
        leftDX: 0.005,
        rightRoll: arc,
        rightRollD: 0.005,
      });
      await expect(canvas).toHaveAttribute("data-catheter-insertion", "92.745");
      await expect(canvas).toHaveAttribute(
        "data-catheter-rotation",
        beforeRemoval!,
      );
      await expect(
        page
          .locator(".hand-readout .clutch-state")
          .filter({ hasText: "一度開いて、つかみ直してください" }),
      ).toHaveCount(2);
      await motion({ pinch: false, leftX: 0.48, rightRoll: arc });
    }
    await expect(wireControls.getByLabel("ワイヤー抜去の状態")).toHaveText(
      "ワイヤー抜去完了（残量0%）",
    );
    await expect(canvas).toHaveAttribute("data-catheter-insertion", "92.745");
    await expect(canvas).toHaveAttribute(
      "data-catheter-rotation",
      beforeRemoval!,
    );
    await motion({ leftX: 0.48, rightRoll: arc });
    await motion({
      steps: 12,
      leftX: 0.48,
      rightRoll: arc,
      leftNoise: 0.002,
      angleNoise: 0.5,
      rollNoise: 0.004,
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
      path: `../../work/finger-engage/${cat}-engaged.png`,
      fullPage: true,
    });
    if (cat === "JL") {
      // Selecting the wire ends this catheter measurement; retain it for export.
      await expect(
        page.getByRole("button", { name: "測定を停止", exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "測定結果を見る", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "手操作の測定結果" });
      await expect(
        dialog.getByRole("img", { name: "指先ずれ速度の推移" }),
      ).toBeVisible();
      await expect(dialog).toContainText("% 手のひら長");
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "JSON保存（全記録）" }).click();
      const data = JSON.parse(
        await fs.readFile((await (await download).path())!, "utf8"),
      );
      expect(data.settings.rotationMode).toBe("fingers");
      expect(data.units.handRotation).toBe("palm_length_percent");
      expect(
        data.samples.some(
          (s: { fingerRoll: number | null }) =>
            s.fingerRoll !== null && s.fingerRoll > 15,
        ),
      ).toBe(true);
      // The turn was produced without a wrist-angle change during the deliberate stroke.
      const moving = data.samples.filter(
        (s: { commandRotation: number }) => Math.abs(s.commandRotation) > 0.5,
      );
      expect(moving.length).toBeGreaterThan(5);
      expect(
        Math.max(...moving.map((s: { wristAngle: number }) => s.wristAngle)) -
          Math.min(...moving.map((s: { wristAngle: number }) => s.wristAngle)),
      ).toBeLessThan(0.001);
      await dialog.getByRole("button", { name: "結果を閉じる" }).click();
      await motion({ steps: 5, leftX: 0.48, rightRoll: arc, pinch: false });
      const held = await canvas.getAttribute("data-catheter-rotation");
      await motion({ steps: 5, leftX: 0.48, rightRoll: 0, pinch: false });
      await expect(canvas).toHaveAttribute("data-catheter-rotation", held!);
      await motion({ steps: 5, leftX: 0.48 });
      // Wrist-only movement in finger mode cannot turn the catheter.
      await motion({ steps: 5, leftX: 0.48, rightDA: 2 });
      await expect(canvas).toHaveAttribute("data-catheter-rotation", held!);
      await motion({
        steps: 5,
        leftX: 0.48,
        rightAngle: 10,
        rightRollD: -0.01,
      });
      expect(
        Number(await canvas.getAttribute("data-catheter-rotation")),
      ).toBeGreaterThan(Number(held) + 2);
      const turned = await canvas.getAttribute("data-catheter-rotation");
      await motion({
        steps: 5,
        leftX: 0.48,
        rightAngle: 10,
        rightRoll: -0.05,
        noWorld: true,
      });
      await expect(
        page.getByRole("status").filter({ hasText: "指先を確認できません" }),
      ).toBeVisible();
      await motion({ steps: 5, leftX: 0.48, rightAngle: 10, rightRoll: -0.06 });
      await expect(canvas).toHaveAttribute("data-catheter-rotation", turned!);
      await page.getByRole("button", { name: "English", exact: true }).click();
      await expect(
        page.getByLabel("Rotation input", { exact: true }),
      ).toHaveValue("fingers");
      await page
        .getByRole("button", { name: "View measurements", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText("% palm length");
      await page
        .getByRole("button", { name: "Close results", exact: true })
        .click();
      await page
        .getByLabel("Rotation input", { exact: true })
        .selectOption("wrist");
      await motion({ steps: 5, leftX: 0.48, rightAngle: 10 });
      await expect(canvas).toHaveAttribute("data-catheter-rotation", turned!);
      await page
        .getByRole("button", { name: "Stop camera", exact: true })
        .click();
    }
    if (cat === "JR") expect(requests).toBeGreaterThan(0);
    if (cat === "JR")
      await page
        .getByRole("button", { name: "カメラを停止", exact: true })
        .click();
    expect(errors).toEqual([]);
  });
}
