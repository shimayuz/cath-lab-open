import { test, expect } from "@playwright/test";

test("wire status stays visible for a hidden remainder, paused controls, and Japanese/English mobile", async ({
  page,
}) => {
  await page.goto("/");
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
  await click("Pull 引く", 33);
  await page.getByRole("checkbox", { name: "微調整", exact: true }).check();
  await click("Pull 引く", 1);
  await expect(page.getByTestId("insertion-value")).toHaveText("0.5%");
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  const panel = page.locator(".viewport-inject");
  await expect(panel.getByLabel("ワイヤー抜去の状態")).toHaveText(
    "ワイヤー残量 0.5%・未抜去",
  );
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-wire-phase",
    "sheathed",
  );
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "ワイヤーを完全に抜く" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Left and right hand roles")).toHaveText(
    "Left hand: Push / Pull · Right thumb and index finger: Clock / Counter",
  );
  await expect(panel.getByLabel("Wire removal status")).toHaveText(
    "Wire remaining: 0.5% — not fully removed",
  );
  await panel.scrollIntoViewIfNeeded();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "../../work/wire-removal/english-mobile.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Fully remove wire", exact: true })
    .click();
  await expect(panel.getByLabel("Wire removal status")).toHaveText(
    "Wire fully removed (0% remaining)",
  );
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-catheter-insertion",
    "96.000",
  );
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-wire-phase",
    "away",
  );
  await expect(
    panel.getByRole("button", { name: /Inject contrast/ }),
  ).toBeDisabled();
});
