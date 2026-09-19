import { test, expect } from "@playwright/test";
test("one-tap central views preserve canvases, C-arm, held image and ongoing cine", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-model-state",
    "ready",
  );
  const view = page.getByTestId("center-viewport");
  await expect(view).toHaveAttribute("data-view", "model");
  const canvas = await page
    .getByTestId("fluoro-canvas")
    .locator("canvas")
    .elementHandle();
  const model = await page
    .getByTestId("anatomy-canvas")
    .locator("canvas")
    .elementHandle();
  await page.getByRole("button", { name: "透視", exact: true }).click();
  await expect(view).toHaveAttribute("data-view", "fluoro");
  const box = await page.getByTestId("fluoro-canvas").boundingBox();
  expect(box!.width).toBeGreaterThan(500);
  expect(box!.height).toBeGreaterThan(350);
  await page.getByRole("slider", { name: "LAO / RAO", exact: true }).fill("32");
  await page.getByRole("button", { name: "撮影開始", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "3Dモデル", exact: true }).click();
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: "撮影終了", exact: true }).click();
  await expect(page.getByLabel("撮影した動画").locator("option")).toHaveCount(
    2,
  );
  expect(
    await canvas!.evaluate(
      (n) =>
        n === document.querySelector('[data-testid="fluoro-canvas"] canvas'),
    ),
  ).toBe(true);
  expect(
    await model!.evaluate(
      (n) =>
        n === document.querySelector('[data-testid="anatomy-canvas"] canvas'),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "透視を中央に表示" }).click();
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-angle",
    "32,0",
  );
  await page.getByRole("button", { name: "透視をOFF", exact: true }).click();
  const held = page.getByRole("img", { name: "透視OFF時の最終画像" });
  const src = await held.getAttribute("src");
  await page.getByRole("button", { name: "3Dモデル", exact: true }).click();
  await page.getByRole("button", { name: "透視", exact: true }).click();
  await expect(held).toBeVisible();
  expect(await held.getAttribute("src")).toBe(src);
  await page.screenshot({
    path: "../../work/central-fluoro.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "3Dモデル", exact: true }),
  ).toBeVisible();
});
