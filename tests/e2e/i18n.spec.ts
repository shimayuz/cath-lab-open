import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function englishOnly(page: Page) {
  const untranslated = await page.evaluate(() => {
    const matches: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (
        !node.parentElement?.closest('[lang="ja"],script,style') &&
        /[ぁ-んァ-ヶ一-龠]/.test(node.textContent ?? "")
      )
        matches.push(node.textContent!.trim());
    }
    document.querySelectorAll("[aria-label],[title],[alt]").forEach((el) => {
      if (el.closest('[lang="ja"]')) return;
      for (const attr of ["aria-label", "title", "alt"]) {
        const text = el.getAttribute(attr) ?? "";
        if (/[ぁ-んァ-ヶ一-龠]/.test(text)) matches.push(text);
      }
    });
    return matches;
  });
  expect(untranslated).toEqual([]);
}

test("switching languages preserves devices, canvases, captures, cine, and camera errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-model-state",
    "ready",
  );
  const model = await page
    .getByTestId("anatomy-canvas")
    .locator("canvas")
    .elementHandle();
  const fluoro = await page
    .getByTestId("fluoro-canvas")
    .locator("canvas")
    .elementHandle();
  const video = await page.locator("video").elementHandle();
  for (let i = 0; i < 3; i++)
    await page
      .getByRole("button", { name: "Push 進める", exact: true })
      .press("Enter");
  await expect(page.getByTestId("insertion-value")).toHaveText("9%");
  await page
    .getByRole("button", { name: "カメラで操作を始める", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("許可されませんでした");
  await page.getByRole("button", { name: "透視", exact: true }).click();
  await page
    .getByRole("button", { name: "Flat panel 10 inch", exact: true })
    .click();
  await page.getByRole("slider", { name: "LAO / RAO", exact: true }).fill("32");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".stills img")).toHaveCount(1);
  const saved = await page.locator(".stills img").getAttribute("src");
  await page.getByRole("button", { name: "撮影開始", exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("insertion-value")).toHaveText("9%");
  await expect(page.locator(".operation-status")).toHaveText(
    "Advancing the J-tip wire.",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Camera access was not allowed",
  );
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(350);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await page.getByLabel("Recorded clips").selectOption("0");
  await expect(page.locator(".cine-player small")).toHaveText(
    "LAO 32° / Level / FPD 10 inch",
  );
  await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
    "data-angle",
    "32,0",
  );
  await page
    .getByRole("button", { name: "Turn fluoroscopy OFF", exact: true })
    .click();
  const heldSrc = await page.locator(".held-fluoro").getAttribute("src");
  await page
    .getByRole("button", { name: "Flat panel 6 inch", exact: true })
    .click();
  await expect(page.locator(".fluoro-caption")).toHaveText(
    "LAO 32° / Level / FPD 10 inch",
  );
  await page.locator(".stills button").click();
  await expect(
    page.getByRole("dialog", { name: "Saved image viewer" }),
  ).toContainText("FPD 10 inch");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".engagement-guide summary").click();
  await englishOnly(page);
  await page
    .getByRole("button", { name: "How to use and model scope", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Getting started" }),
  ).toBeVisible();
  await englishOnly(page);
  await page.getByRole("button", { name: "Close help", exact: true }).click();
  await page.screenshot({
    path: "../../work/i18n/english-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator(".fluoro-caption")).toHaveText(
    "LAO 32° / 水平 / FPD 10 inch",
  );
  await expect(page.locator(".cine-player small")).toHaveText(
    "LAO 32° / 水平 / FPD 10 inch",
  );
  expect(await page.locator(".held-fluoro").getAttribute("src")).toBe(heldSrc);
  expect(await page.locator(".stills img").getAttribute("src")).toBe(saved);
  await expect(page.getByTestId("insertion-value")).toHaveText("9%");
  await expect(page.getByRole("alert")).toContainText("許可されませんでした");
  expect(
    await model!.evaluate(
      (n) =>
        n === document.querySelector('[data-testid="anatomy-canvas"] canvas'),
    ),
  ).toBe(true);
  expect(
    await fluoro!.evaluate(
      (n) =>
        n === document.querySelector('[data-testid="fluoro-canvas"] canvas'),
    ),
  ).toBe(true);
  expect(
    await video!.evaluate((n) => n === document.querySelector("video")),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("language choice survives reload and both languages fit mobile screens", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Cath Lab — A step toward the heart.");
  await expect(
    page.getByRole("button", { name: "English", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await englishOnly(page);
  for (const language of ["English", "日本語"]) {
    await page.getByRole("button", { name: language, exact: true }).click();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            viewport: innerWidth,
          })),
        )
        .toEqual({ scroll: width, viewport: width });
      const button = page.getByRole("button", { name: language, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `../../work/i18n/${language === "English" ? "en" : "ja"}-mobile.png`,
      fullPage: true,
    });
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
});

test("English demo completes both sides and remains complete after a language switch", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("button", { name: "Watch the demo", exact: true })
    .click();
  await expect(page.locator(".coach-strip strong")).toHaveText("Demo playing");
  await expect(page.locator(".coach-strip strong")).toHaveText(
    "Both coronaries have been imaged",
    { timeout: 180000 },
  );
  await expect(page.locator(".completion-mini b")).toHaveText("2 / 2");
  await expect(page.getByTestId("coach-hint")).toContainText(
    "Both coronary arteries have been imaged.",
  );
  await englishOnly(page);
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(page.locator(".coach-strip strong")).toHaveText(
    "左右の造影を達成しました",
  );
  await expect(page.locator(".completion-mini b")).toHaveText("2 / 2");
});
