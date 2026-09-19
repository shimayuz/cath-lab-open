import { test, expect } from "@playwright/test";

test("flat panel changes the actual image, preserves captured field sizes, and works on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "透視", exact: true }).click();
  const host = page.getByTestId("fluoro-canvas");
  await expect(host).toHaveAttribute("data-model-state", "ready");
  const caption = page.locator(".fluoro-caption");
  const choose = (size: number) =>
    page.getByRole("button", { name: `Flat panel ${size} inch`, exact: true });
  const picture = () =>
    host.locator("canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await expect(choose(6)).toHaveAttribute("aria-pressed", "true");
  await expect(caption).toContainText("FPD 6 inch");
  const six = await picture();
  await page
    .getByTestId("center-viewport")
    .screenshot({ path: "../../work/fpd-correction/6-inch.png" });
  // Both clicks occur before another animation frame can draw the new field.
  const beforeOff = await host
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL("image/jpeg", 0.78));
  await page.evaluate(async () => {
    (
      document.querySelector(
        '[aria-label="Flat panel 10 inch"]',
      ) as HTMLButtonElement
    ).click();
    await Promise.resolve();
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === "透視をOFF")!
      .click();
  });
  await expect(choose(10)).toHaveAttribute("aria-pressed", "true");
  await expect(caption).toContainText("FPD 6 inch");
  expect(
    await page
      .getByRole("img", { name: "透視OFF時の最終画像" })
      .getAttribute("src"),
  ).toBe(beforeOff);
  await page.getByRole("button", { name: "透視をON", exact: true }).click();
  await choose(6).click();
  for (const size of [7, 8, 9, 10]) {
    await choose(size).click();
    await expect(choose(size)).toHaveAttribute("aria-pressed", "true");
    await expect(host).toHaveAttribute("data-field-of-view", String(size));
    await expect(caption).toContainText(`FPD ${size} inch`);
  }
  await page
    .getByTestId("center-viewport")
    .screenshot({ path: "../../work/fpd-correction/10-inch.png" });
  expect(await picture()).not.toBe(six);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = page.getByRole("img", { name: /保存画像 1.*FPD 10 inch/ });
  await expect(saved).toBeVisible();
  await choose(6).click();
  await saved.click();
  await expect(
    page.getByRole("dialog", { name: "保存画像の表示" }),
  ).toContainText("FPD 10 inch");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.getByRole("button", { name: "透視をOFF", exact: true }).click();
  const held = page.getByRole("img", { name: "透視OFF時の最終画像" });
  const heldSrc = await held.getAttribute("src");
  await choose(8).click();
  await expect(caption).toContainText("FPD 6 inch");
  expect(await held.getAttribute("src")).toBe(heldSrc);
  await page.getByRole("button", { name: "透視をON", exact: true }).click();
  await expect(caption).toContainText("FPD 8 inch");
  await choose(10).click();
  await page.getByRole("button", { name: "撮影開始", exact: true }).click();
  await page.waitForTimeout(500);
  await choose(6).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "撮影終了", exact: true }).click();
  await page.getByLabel("撮影した動画").selectOption("0");
  await expect(page.locator(".cine-player small")).toContainText("FPD 10 inch");
  const scrubber = page.getByRole("slider", {
    name: "動画の再生位置",
    exact: true,
  });
  await scrubber.fill((await scrubber.getAttribute("max"))!);
  await expect(page.locator(".cine-player small")).toContainText("FPD 6 inch");
  await page.getByRole("button", { name: "3Dモデル", exact: true }).click();
  await page.getByRole("button", { name: "透視", exact: true }).click();
  await expect(choose(6)).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await choose(10).click();
  await expect(choose(10)).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".fpd-controls")
    .screenshot({ path: "../../work/fpd-correction/mobile-controls.png" });
  expect(errors).toEqual([]);
});
