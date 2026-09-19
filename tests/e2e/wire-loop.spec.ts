import { test, expect } from "@playwright/test";
for (const access of ["radial", "femoral"] as const) {
  test(`${access} J wire forms, holds and reversibly unfolds its aortic loop in both views`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    if (access === "femoral")
      await page.getByRole("button", { name: /右鼠径部.*大腿動脈/ }).click();
    await page.getByRole("button", { name: "心臓を拡大", exact: true }).click();
    await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
      "data-model-state",
      "ready",
    );
    const push = page.getByRole("button", { name: "Push 進める", exact: true });
    const pull = page.getByRole("button", { name: "Pull 引く", exact: true });
    for (let i = 0; i < 28; i++) await push.press("Enter");
    await expect(page.getByLabel("ワイヤーの形状")).toHaveText(
      "J型先端で経路を進む",
    );
    await page.screenshot({
      path: `../../work/j-wire/${access}-84-j-tip.png`,
      fullPage: true,
    });
    for (let i = 0; i < 6; i++) await push.press("Enter");
    await expect(page.getByTestId("insertion-value")).toHaveText("100%");
    await expect(page.getByLabel("ワイヤーの形状")).toHaveText(
      "Ao内でループ形成",
    );
    for (const id of ["anatomy-canvas", "fluoro-canvas"]) {
      await expect(page.getByTestId(id)).toHaveAttribute(
        "data-wire-phase",
        "loop",
      );
      await expect(page.getByTestId(id)).toHaveAttribute(
        "data-wire-loop",
        "1.000",
      );
    }
    await page.screenshot({
      path: `../../work/j-wire/${access}-100-loop.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "LAO 45°", exact: true }).click();
    await expect(page.getByTestId("insertion-value")).toHaveText("100%");
    await expect(page.getByTestId("fluoro-canvas")).toHaveAttribute(
      "data-wire-loop",
      "1.000",
    );
    await page.getByRole("button", { name: "RAO 30°", exact: true }).click();
    await page.screenshot({
      path: `../../work/j-wire/${access}-100-rao.png`,
      fullPage: true,
    });
    for (let i = 0; i < 5; i++) await pull.press("Enter");
    await expect(page.getByTestId("insertion-value")).toHaveText("85%");
    await expect(page.getByLabel("ワイヤーの形状")).toHaveText(
      "J型先端で経路を進む",
    );
    expect(errors).toEqual([]);
  });
}
