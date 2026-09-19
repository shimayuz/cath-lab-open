import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const artifacts = path.resolve("../../work/judkins-correction");
const vmr = JSON.parse(fs.readFileSync("src/simulator/vmr.json", "utf8"));
const axis: number[] = vmr.aorta[12].map(
  (x: number, i: number) => x - vmr.aorta[0][i],
);
const length = Math.hypot(...axis);
axis.forEach((_, i) => (axis[i] /= length));
type Sample = {
  phase: string;
  insertion: number;
  rotation: number;
  tip: number[];
};
for (const [side, cat, turnLabel, count, direction] of [
  ["LCA", "JL", "Counterclockwise 反時計回り", 16, -1],
  ["RCA", "JR", "Clockwise 時計回り", 5, 1],
] as const) {
  test(`${cat}: visible bottom then simultaneous turn and pull, with monotonic tip ascent`, async ({
    page,
  }) => {
    test.setTimeout(150000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    if (side === "RCA") {
      await page.getByRole("button", { name: /RCA 右冠動脈/ }).click();
      await page
        .getByRole("button", { name: "JR Judkins right", exact: true })
        .click();
    }
    const click = async (label: string, n: number) =>
      page
        .getByRole("button", { name: label, exact: true })
        .evaluate((button: HTMLButtonElement, n) => {
          for (let i = 0; i < n; i++) button.click();
        }, n);
    await click("Push 進める", 34);
    await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
    await click("Push 進める", 31);
    await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
    await click("Pull 引く", 34);
    await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
    await click(turnLabel, count);
    await page.getByRole("button", { name: "冠尖を拡大", exact: true }).click();
    await page.getByText("Engageの図解", { exact: false }).first().click();
    await page.evaluate(() => {
      const host = document.querySelector(
        '[data-testid="anatomy-canvas"]',
      ) as HTMLElement;
      const samples: Sample[] = [];
      const stopped = new Set<string>();
      let last = "";
      const observer = new MutationObserver(() => {
        const sample = {
          phase: host.dataset.catheterPhase!,
          insertion: +host.dataset.catheterInsertion!,
          rotation: +host.dataset.catheterRotation!,
          tip: host.dataset.catheterTip!.split(",").map(Number),
        };
        const key = JSON.stringify(sample);
        if (key === last) return;
        last = key;
        samples.push(sample);
        const stage =
          sample.phase === "bottom"
            ? "bottom"
            : sample.phase === "lifting" && sample.insertion <= 94.5
              ? "middle"
              : sample.phase === "engaged"
                ? "engaged"
                : null;
        if (stage && !stopped.has(stage)) {
          stopped.add(stage);
          const pause = Array.from(document.querySelectorAll("button")).find(
            (b) => b.textContent?.trim() === "一時停止",
          );
          pause?.click();
        }
      });
      observer.observe(host, {
        attributes: true,
        attributeFilter: [
          "data-catheter-insertion",
          "data-catheter-rotation",
          "data-catheter-phase",
        ],
      });
      Object.assign(window, {
        __judkinsSamples: samples,
        __judkinsObserver: observer,
      });
    });
    await page
      .getByRole("button", { name: "操作デモを見る", exact: true })
      .click();
    const canvas = page.getByTestId("anatomy-canvas");
    for (const [step, phase] of [
      ["bottom", "bottom"],
      ["middle", "lifting"],
      ["engaged", "engaged"],
    ] as const) {
      await expect(
        page.getByRole("button", { name: "再開", exact: true }),
      ).toBeVisible({ timeout: 60000 });
      await expect(canvas).toHaveAttribute("data-catheter-phase", phase);
      if (step === "bottom")
        await expect(canvas).toHaveAttribute(
          "data-catheter-insertion",
          "96.000",
        );
      await page
        .getByTestId("center-viewport")
        .screenshot({ path: path.join(artifacts, `${side}-${step}.png`) });
      if (side === "LCA") {
        const tipBefore = await canvas.getAttribute("data-catheter-tip");
        const surface = canvas.locator("canvas");
        const box = (await surface.boundingBox())!;
        await page.mouse.move(
          box.x + box.width * 0.48,
          box.y + box.height * 0.52,
        );
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width * 0.66,
          box.y + box.height * 0.62,
          { steps: 12 },
        );
        await page.mouse.up();
        await page
          .getByTestId("center-viewport")
          .screenshot({
            path: path.join(artifacts, `${side}-${step}-oblique.png`),
          });
        expect(await canvas.getAttribute("data-catheter-tip")).toBe(tipBefore);
        await page
          .getByRole("button", { name: "視点をリセット", exact: true })
          .click();
      }
      if (step !== "engaged")
        await page.getByRole("button", { name: "再開", exact: true }).click();
    }
    await page.screenshot({
      path: path.join(artifacts, `${side}-guide.png`),
      fullPage: true,
    });
    const samples = await page.evaluate(
      () =>
        (window as unknown as { __judkinsSamples: Sample[] }).__judkinsSamples,
    );
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(
      path.join(artifacts, `${side}-trajectory.json`),
      JSON.stringify(samples, null, 2),
    );
    const start = samples.findIndex((s) => s.phase === "bottom");
    const journey = samples
      .slice(start)
      .filter((s) => ["bottom", "lifting", "engaged"].includes(s.phase));
    const lifts = journey.filter((s) => s.phase === "lifting");
    expect(lifts.length).toBeGreaterThan(10);
    for (let i = 1; i < journey.length; i++) {
      const before = journey[i - 1],
        now = journey[i];
      if (now.insertion === before.insertion) continue;
      expect(now.insertion).toBeLessThan(before.insertion);
      expect(Math.sign(now.rotation - before.rotation)).toBe(direction);
      const height = (v: number[]) => v.reduce((n, x, j) => n + x * axis[j], 0);
      expect(height(now.tip)).toBeGreaterThan(height(before.tip) - 0.00001);
      expect(
        Math.hypot(...now.tip.map((x, j) => x - before.tip[j])),
      ).toBeLessThan(0.04);
    }
    await page
      .getByRole("button", { name: "デモを止めて操作する", exact: true })
      .click();
    await page.getByRole("button", { name: "再開", exact: true }).click();
    await expect(page.getByRole("button", { name: /造影する/ })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
