import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import fs from "node:fs";
async function press(page: Page, label: string, count: number) {
  const button = page.getByRole("button", { name: label, exact: true });
  for (let i = 0; i < count; i++) await button.press("Enter");
}
async function deliver(
  page: Page,
  rotation: "left" | "right" = "left",
  rotations = 19,
) {
  await press(page, "Push 進める", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await press(page, "Push 進める", 31);
  await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
  await press(page, "Pull 引く", 34);
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await press(
    page,
    rotation === "left" ? "Counterclockwise 反時計回り" : "Clockwise 時計回り",
    rotations - 3,
  );
  await press(page, "Push 進める", 1);
  await press(
    page,
    rotation === "left" ? "Counterclockwise 反時計回り" : "Clockwise 時計回り",
    3,
  );
  await press(page, "Pull 引く", 1);
}
test("radial CAG: wire support, JL → LCA, JR → RCA, views and reset", async ({
  page,
}) => {
  test.setTimeout(300000); // Two full CAG sequences on software WebGL.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByTestId("anatomy-canvas").locator("canvas"),
  ).toBeVisible();
  await expect(page.getByTestId("anatomy-canvas")).toHaveAttribute(
    "data-model-state",
    "ready",
  );
  await expect(page.getByRole("button", { name: /造影する/ })).toBeDisabled();
  await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
  await press(page, "Push 進める", 1);
  await expect(page.getByTestId("insertion-value")).toHaveText("0%");
  await page.getByRole("button", { name: /ガイドワイヤー.*W/ }).click();
  await deliver(page);
  await expect(page.getByTestId("engagement-status")).toContainText(
    "LCA Engaged",
  );
  await page.getByRole("button", { name: "心臓を拡大", exact: true }).click();
  await page.getByRole("button", { name: /造影する/ }).click();
  await expect(
    page.getByRole("region", { name: "カテーテル操作" }).getByRole("status"),
  ).toContainText("LCAに造影剤を注入");
  await page.waitForTimeout(2200);
  await page.screenshot({ path: "preview-lca.png", fullPage: true });
  await page.getByRole("button", { name: /LAO/ }).click();
  await expect(page.getByRole("button", { name: /LAO/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /RAO/ }).click();
  await page
    .getByRole("button", { name: "心臓の表面を表示", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "心臓の表面を表示", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /RCA 右冠動脈/ }).click();
  await page
    .getByRole("button", { name: "JR Judkins right", exact: true })
    .click();
  await deliver(page, "right", 8);
  await expect(page.getByTestId("engagement-status")).toContainText(
    "RCA Engaged",
  );
  await page.getByRole("button", { name: /造影する/ }).click();
  await expect(page.getByText("左右の造影を達成しました")).toBeVisible();
  await page.getByRole("button", { name: "体験を最初からやり直す" }).click();
  await expect(page.getByTestId("insertion-value")).toHaveText("0%");
  await expect(page.getByRole("button", { name: /造影する/ })).toBeDisabled();
  expect(errors).toEqual([]);
});
test("femoral AL and keyboard operation, pause and help", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /右鼠径部/ }).click();
  await page.getByRole("button", { name: "AL Amplatz left" }).click();
  await deliver(page, "left", 26);
  await expect(page.getByTestId("engagement-status")).toContainText(
    "LCA Engaged",
  );
  await page.getByRole("button", { name: /造影する/ }).click();
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  const before = await page.getByTestId("insertion-value").innerText();
  await page.locator("h1").click();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("insertion-value")).toHaveText(before);
  await expect(
    page.getByRole("button", { name: "Push 進める" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "再開", exact: true }).click();
  await page.locator("h1").click();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("insertion-value")).not.toHaveText(before);
  await page.getByRole("button", { name: "使い方と再現範囲" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("responsive layouts have no horizontal overflow and expose controls", async ({
  page,
}) => {
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [1024, 600],
    [768, 1024],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Push 進める" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390)
      await page.screenshot({ path: "preview-mobile.png", fullPage: true });
  }
});
test("camera permission denial leaves manual control usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "カメラで操作を始める" }).click();
  await expect(page.getByRole("alert")).toContainText("許可されませんでした");
  await page.getByRole("button", { name: "Push 進める" }).click();
  await expect(page.getByTestId("insertion-value")).toHaveText("3%");
});
test("local MediaPipe model actually detects both hands and 42 landmarks from camera replay, and stops its track", async ({
  page,
}) => {
  const image =
    "data:image/jpeg;base64," +
    fs.readFileSync("tests/fixtures/hand-test.jpg").toString("base64");
  await page.addInitScript(
    ({ image }) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async () => {
          const img = new Image();
          img.src = image;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d")!;
          // Compose the same upright source hand and its mirror as a Left/Right pair.
          // This is synthetic video, not a recording of a person operating the simulator.
          const draw = () => {
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, 640, 480);
            if (
              !(window as unknown as { __singleHand?: boolean }).__singleHand
            ) {
              ctx.save();
              ctx.translate(300, 0);
              ctx.scale(-1, 1);
              ctx.drawImage(img, 360, 0, 360, 382, 15, 90, 270, 286.5);
              ctx.restore();
            }
            ctx.drawImage(img, 360, 0, 360, 382, 355, 90, 270, 286.5);
          };
          draw();
          const stream = canvas.captureStream(15);
          const timer = setInterval(draw, 66);
          const track = stream.getVideoTracks()[0];
          const stop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            stop();
          };
          Object.assign(window, { __testTrack: track });
          return stream;
        },
      });
    },
    { image },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "カメラで操作を始める" }).click();
  await expect(page.getByText("2手・42点を追跡中")).toBeVisible({
    timeout: 45000,
  });
  await page.screenshot({
    path: "../../work/camera-replay.png",
    fullPage: true,
  });
  await expect(page.getByText("左手 · 押し引き")).toBeVisible();
  await expect(page.getByText("右手 · 回転")).toBeVisible();
  await page.getByLabel("右手で押し引き・左手で回転（左右を交換）").check();
  await expect(page.getByText("左手 · 回転")).toBeVisible();
  await expect(page.getByText("右手 · 押し引き")).toBeVisible();
  await page.evaluate(() => Object.assign(window, { __singleHand: true }));
  await expect(page.getByText("1手・21点を追跡中")).toBeVisible();
  await expect(page.locator(".hand-readout")).toHaveCount(1);
  // The unmirrored source is an anatomical RIGHT hand, confirmed by the official fixture.
  await expect(page.getByText("右手 · 押し引き")).toBeVisible();
  await expect(page.getByText("左手 · 回転")).toHaveCount(0);
  await page.evaluate(() => Object.assign(window, { __singleHand: false }));
  await expect(page.getByText("2手・42点を追跡中")).toBeVisible();
  await expect(page.getByText("左手 · 回転")).toBeVisible();
  await expect(page.getByText("右手 · 押し引き")).toBeVisible();
  await page.getByRole("button", { name: "カメラを停止", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __testTrack: MediaStreamTrack }).__testTrack
          .readyState,
    ),
  ).toBe("ended");
  await expect(page.getByText("カメラOFF")).toBeVisible();
});
test("guided demo completes both angiograms and returns control", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "操作デモを見る", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Push 進める" }),
  ).toBeDisabled();
  await expect(page.getByText("左右の造影を達成しました")).toBeVisible({
    timeout: 180000,
  });
  await expect(
    page.getByRole("button", { name: "操作デモを見る", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Push 進める" })).toBeEnabled();
});

test("held button stops on release", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Push 進める", exact: true });
  const box = await button.boundingBox();
  if (!box) throw new Error("Push button unavailable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  const value = await page.getByTestId("insertion-value").innerText();
  expect(parseInt(value)).toBeGreaterThan(3);
  await page.waitForTimeout(250);
  await expect(page.getByTestId("insertion-value")).toHaveText(value);
});
for (const [name, wireClicks, catheterClicks, access] of [
  ["deep", 34, 34, "radial"],
  ["unsupported", 28, 28, "femoral"],
] as const) {
  test(`demo recovers from ${name} manual state (${access})`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await page.goto("/");
    if (access === "femoral")
      await page.getByRole("button", { name: /右鼠径部/ }).click();
    await press(page, "Push 進める", wireClicks);
    await page.getByRole("button", { name: /診断カテーテル.*[JC]/ }).click();
    await press(page, "Push 進める", catheterClicks);
    await expect(page.getByTestId("insertion-value")).toHaveText(
      name === "deep" ? "98%" : "82%",
    );
    await page
      .getByRole("button", { name: "操作デモを見る", exact: true })
      .click();
    await expect(page.getByText("左右の造影を達成しました")).toBeVisible({
      timeout: 180000,
    });
  });
}
