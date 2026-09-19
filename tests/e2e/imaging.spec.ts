import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function keyPress(page: Page, label: string, count: number) {
  for (let i = 0; i < count; i++)
    await page.getByRole("button", { name: label, exact: true }).press("Enter");
}
async function deliver(page: Page) {
  await keyPress(page, "Push 進める", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await keyPress(page, "Push 進める", 31);
  await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
  await keyPress(page, "Pull 引く", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await keyPress(page, "Counterclockwise 反時計回り", 16);
  await keyPress(page, "Push 進める", 1);
  await keyPress(page, "Counterclockwise 反時計回り", 3);
  await keyPress(page, "Pull 引く", 1);
  await expect(page.getByRole("button", { name: /造影する/ })).toBeEnabled();
}
async function range(page: Page, label: string, value: string) {
  await page.getByRole("slider", { name: label, exact: true }).fill(value);
}
test("C-arm, table, collimation, held image after resize, capture and cine replay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-model-state",
    "ready",
  );
  await page.getByRole("button", { name: "透視", exact: true }).click();
  await range(page, "LAO / RAO", "31");
  await range(page, "CRA / CAU", "-22");
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-angle",
    "31,-22",
  );
  await page.getByText("寝台・拡大・絞り", { exact: true }).click();
  await range(page, "寝台 左右", "1.2");
  await range(page, "寝台 上下", "-0.6");
  await range(page, "拡大", "1.8");
  await range(page, "左右の絞り", "0.5");
  await range(page, "上下の絞り", "0.6");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("img", { name: /保存画像 1/ })).toBeVisible();
  // Captured image contains actual dark collimator blades, not an HTML-only mask.
  const pixels = await page
    .getByRole("img", { name: /保存画像 1/ })
    .evaluate((img: HTMLImageElement) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d")!;
      x.drawImage(img, 0, 0);
      return {
        edge: Array.from(x.getImageData(2, 2, 1, 1).data),
        center: Array.from(
          x.getImageData(c.width / 2, c.height / 2, 1, 1).data,
        ),
      };
    });
  expect(pixels.edge[0]).toBeLessThan(12);
  expect(pixels.center.slice(0, 3).reduce((a, b) => a + b, 0)).toBeGreaterThan(
    30,
  );
  await page.getByRole("button", { name: "透視をOFF" }).click();
  const held = page.getByRole("img", { name: "透視OFF時の最終画像" });
  const src = await held.getAttribute("src");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(held).toBeVisible();
  expect(await held.getAttribute("src")).toBe(src);
  await page.getByRole("button", { name: "透視をON" }).click();
  await expect(held).toHaveCount(0);
  await page.getByRole("button", { name: "撮影開始", exact: true }).click();
  await range(page, "LAO / RAO", "-20");
  await expect(page.getByText("● 撮影中", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "撮影終了", exact: true }).click();
  await page.getByLabel("撮影した動画").selectOption("0");
  await expect(
    page.getByRole("img", { name: "撮影動画の再生フレーム" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "動画を再生", exact: true }).click();
  await expect(page.getByLabel("動画の再生位置")).not.toHaveValue("0");
  await page.screenshot({
    path: "../../work/imaging-controls.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("pressure damping blocks injection; bolus, pause and washout share time", async ({
  page,
}) => {
  await page.goto("/");
  await deliver(page);
  await expect(page.getByTestId("pressure-state")).toHaveText("Ao型の圧波形");
  await keyPress(page, "Push 進める", 1);
  await expect(page.getByTestId("pressure-state")).toContainText("Damping");
  await expect(page.getByRole("button", { name: /造影する/ })).toBeDisabled();
  await keyPress(page, "Pull 引く", 1);
  await expect(page.getByRole("button", { name: /造影する/ })).toBeEnabled();
  await range(page, "造影剤の注入量", "8");
  await range(page, "造影剤の注入時間", "4");
  await page.getByRole("button", { name: "心臓を拡大", exact: true }).click();
  await page.getByRole("button", { name: "撮影開始", exact: true }).click();
  await page.getByRole("button", { name: /造影する/ }).click();
  await expect(
    page.getByRole("button", { name: "注入を止める", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  const opacity = await page
    .getByTestId("fluoro-canvas")
    .getAttribute("data-contrast");
  await page.waitForTimeout(600);
  expect(
    await page.getByTestId("fluoro-canvas").getAttribute("data-contrast"),
  ).toBe(opacity);
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await expect(page.getByText("累計 8.0 mL", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "撮影終了", exact: true }).click();
  await page.getByLabel("撮影した動画").selectOption("0");
  await page.screenshot({
    path: "../../work/cag-physiology.png",
    fullPage: true,
  });
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-contrast",
    "0.000",
    { timeout: 15000 },
  );
});

test("lecture guide follows seating; excessive injection recoil requires re-engagement", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Engageの図解", { exact: false }).first().click();
  await expect(page.getByTestId("root-phase")).toHaveText("冠尖へ向ける");
  const clicks = async (label: string, count: number) => {
    await page
      .getByRole("button", { name: label, exact: true })
      .evaluate((button: HTMLButtonElement, n) => {
        for (let i = 0; i < n; i++) button.click();
      }, count);
  };
  await clicks("Push 進める", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await clicks("Push 進める", 31);
  await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
  await clicks("Pull 引く", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await clicks("Counterclockwise 反時計回り", 16);
  await clicks("Push 進める", 1);
  await expect(page.getByTestId("root-phase")).toHaveText("冠尖に着座");
  await clicks("Counterclockwise 反時計回り", 3);
  await clicks("Pull 引く", 1);
  await expect(page.getByRole("button", { name: /造影する/ })).toBeEnabled();
  await expect(page.getByTestId("root-phase")).toHaveText("入口を捉えた");
  await page.getByRole("button", { name: "心臓を拡大", exact: true }).click();
  await page.screenshot({
    path: "../../work/engage-guide-model.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "透視", exact: true }).click();
  await range(page, "造影剤の注入量", "12");
  await range(page, "造影剤の注入時間", "1");
  await page.getByRole("button", { name: /造影する/ }).click();
  await expect(page.getByTestId("kickback-status")).toContainText("1回");
  await expect(page.getByRole("button", { name: /造影する/ })).toBeDisabled();
  await expect(page.getByTestId("root-phase")).toHaveText("冠尖へ向ける");
  await page.screenshot({
    path: "../../work/engage-kickback.png",
    fullPage: true,
  });
});
