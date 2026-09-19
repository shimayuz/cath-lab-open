import { test, expect } from "@playwright/test";
for (const [cat, target] of [
  ["JL", "LCA"],
  ["JR", "RCA"],
] as const) {
  for (const reachedBottom of [true, false])
    test(`${cat} Bottom=${reachedBottom}: small aligned position error permits Inject contrast after seating`, async ({
      page,
    }) => {
      await page.goto("/");
      if (cat === "JR") {
        await page.getByRole("button", { name: /RCA 右冠動脈/ }).click();
        await page
          .getByRole("button", { name: "JR Judkins right", exact: true })
          .click();
      }
      const click = async (name: string, n: number) =>
        page
          .getByRole("button", { name, exact: true })
          .evaluate((b: HTMLButtonElement, n) => {
            for (let i = 0; i < n; i++) b.click();
          }, n);
      await click("Push 進める", 34);
      await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
      await click("Push 進める", reachedBottom ? 32 : 31);
      if (!reachedBottom) {
        await page
          .getByRole("checkbox", { name: "微調整", exact: true })
          .check();
        await click("Push 進める", 4);
        await page
          .getByRole("checkbox", { name: "微調整", exact: true })
          .uncheck();
      }
      await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
      await click("Pull 引く", 34);
      await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
      await click(
        cat === "JL" ? "Counterclockwise 反時計回り" : "Clockwise 時計回り",
        cat === "JL" ? 16 : 5,
      );
      const canvas = page.getByTestId("anatomy-canvas");
      await expect(canvas).toHaveAttribute(
        "data-catheter-phase",
        reachedBottom ? "bottom" : "descending",
      );
      const desired = await page.evaluate(
        async ({ cat, target }) => {
          const modulePath = "/src/simulator/model.ts";
          const m = await import(modulePath);
          return m.desiredRotation({
            ...m.initialState,
            catheterType: cat,
            target,
          });
        },
        { cat, target },
      );
      const angle = Math.round(desired + 3);
      const current = Number(
        await canvas.getAttribute("data-catheter-rotation"),
      );
      await page.getByRole("checkbox", { name: "微調整", exact: true }).check();
      await click(
        angle < current ? "Counterclockwise 反時計回り" : "Clockwise 時計回り",
        Math.abs(angle - current),
      );
      expect(Math.abs(angle - desired)).toBeGreaterThan(2.4);
      expect(Math.abs(angle - desired)).toBeLessThan(3.6);
      await page
        .getByRole("checkbox", { name: "微調整", exact: true })
        .uncheck();
      await page
        .getByRole("button", { name: "冠尖を拡大", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: `造影する ${target}`, exact: true }),
      ).toBeDisabled();
      if (!reachedBottom) {
        await expect(
          page
            .getByText(
              "入口へ先端の向きと高さを合わせます。Bottomへの到達は必須ではありません。",
              { exact: true },
            )
            .first(),
        ).toBeVisible();
        await page
          .getByRole("checkbox", { name: "微調整", exact: true })
          .check();
      }
      await page.getByText("Engageの図解", { exact: false }).first().click();
      await expect(page.locator(".engagement-guide li.current")).toContainText(
        "引き上げる",
      );
      await click("Pull 引く", reachedBottom ? 1 : 4);
      await expect(canvas).toHaveAttribute("data-catheter-phase", "engaged");
      await expect(canvas).toHaveAttribute("data-catheter-insertion", "93.000");
      await expect(canvas).toHaveAttribute(
        "data-catheter-rotation",
        angle.toFixed(3),
      );
      await page.getByRole("button", { name: "English", exact: true }).click();

      await expect(
        page.getByText(
          "Reaching the bottom is optional. Engagement depends on position, alignment and support at the ostium.",
          { exact: true },
        ),
      ).toBeVisible();
      const inject = page.getByRole("button", {
        name: `Inject contrast ${target}`,
        exact: true,
      });
      await expect(inject).toBeEnabled();
      await inject.click();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: `${target} injection is complete` }),
      ).toBeVisible({ timeout: 15000 });
      await page.getByTestId("center-viewport").screenshot({
        path: `../../work/judkins-tolerance/${cat}-bottom-${reachedBottom}.png`,
      });
    });
}
