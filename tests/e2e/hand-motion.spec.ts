import { mockHandCamera } from "./fixtures/hand-camera";
import { test, expect } from "@playwright/test";

// This test replaces only detector output with known landmark motion. Camera lifecycle,
// handedness adapter, gesture processing, React actions, reducer and 3D UI are real.
test("hand movement reaches wire and catheter state, with independent roles and release", async ({
  page,
}) => {
  await mockHandCamera(page);
  await page.goto("/");
  await page.getByLabel("回転の入力", { exact: true }).selectOption("wrist");
  await page.getByLabel("Pushの方向").selectOption("up");
  await page.getByRole("button", { name: "カメラで操作を始める" }).click();
  await expect(page.getByText("2手・42点を追跡中")).toBeVisible();
  const cameraStream = await page
    .locator("video")
    .evaluateHandle((video: HTMLVideoElement) => video.srcObject);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Tracking 2 hand(s) · 42 points")).toBeVisible();
  await expect(
    page.getByText("Left hand · Push / Pull", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Right hand · Rotation", { exact: true }),
  ).toBeVisible();
  expect(
    await cameraStream.evaluate(
      (stream) => stream === document.querySelector("video")!.srcObject,
    ),
  ).toBe(true);
  expect(
    await page
      .locator("video")
      .evaluate(
        (video: HTMLVideoElement) =>
          (video.srcObject as MediaStream).getTracks()[0].readyState,
      ),
  ).toBe("live");
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(page.getByText("2手・42点を追跡中")).toBeVisible();

  const output = page.getByLabel("カメラ操作の挿入量");
  const amount = async () =>
    Number((await output.textContent())!.match(/([\d.]+)%/)![1]);
  const angle = async () =>
    Number((await output.textContent())!.match(/(-?[\d.]+)°/)![1]);
  const motion = async (extra: Record<string, number | boolean>) => {
    await page.evaluate(
      (extra) =>
        Object.assign(window, {
          __motion: {
            tick: 0,
            steps: 30,
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
              window as unknown as { __motion: { tick: number; steps: number } }
            ).__motion;
            return m.tick === m.steps;
          }),
        { timeout: 15000 },
      )
      .toBe(true);
  };
  await expect(page.getByText("掴んでいます・現在位置を保持")).toBeVisible();
  await motion({ leftDY: -0.001 }); // Every step was discarded by the old implementation.
  await expect.poll(amount).toBeGreaterThan(3.5);
  await expect(output).toContainText("ワイヤー");
  let before = await amount();
  await motion({ leftY: 0.57, rightDY: -0.002 });
  expect(await amount()).toBeCloseTo(before, 1); // Right-hand translation cannot push.
  await motion({ leftY: 0.57, rightY: 0.54, rightDA: 0.3 });
  await expect(
    page.getByText("回転させるにはカテーテルを選択してください。"),
  ).toBeVisible();
  expect(await angle()).toBe(0);
  // Prepare the wire, then verify the same hand path changes catheter insertion.
  await motion({ pinch: false });
  const push = page.getByRole("button", { name: "Push 進める", exact: true });
  for (let i = 0; i < 34; i++) await push.press("Enter");
  await page
    .getByLabel("カメラの操作対象")
    .getByRole("button", { name: "カテーテル", exact: true })
    .click();
  await expect(output).toContainText("カテーテル 0.0%");
  await motion({ steps: 4 }); // New grip baseline.
  await motion({ leftDY: -0.001 });
  await expect.poll(amount).toBeGreaterThan(3.5);
  before = await amount();
  await motion({ leftY: 0.57, rightDA: 0.3 });
  await expect.poll(angle).toBeGreaterThan(7);
  expect(await amount()).toBeCloseTo(before, 1);
  const rotation = await angle();
  await motion({ pinch: false, leftDY: -0.002, rightDA: 0.3 });
  expect(await amount()).toBeCloseTo(before, 1);
  expect(await angle()).toBeCloseTo(rotation, 1);

  // The real failure was repeated hand return, not one isolated movement.
  await page
    .getByRole("button", { name: "体験を最初からやり直す", exact: true })
    .click();
  await page.getByLabel("Pushの方向").selectOption("left");
  await motion({ steps: 4, pinch: false });
  await expect(output).toContainText("ワイヤー 0.0%");
  const heldPositions: number[] = [];
  for (let cycle = 0; cycle < 9; cycle++) {
    const beforeGrip = await amount();
    await motion({ steps: 4 }); // Close at a fresh pose; never move just from regripping.
    expect(await amount()).toBeCloseTo(beforeGrip, 1);
    await motion({ steps: 8, leftDX: 0.01 });
    const held = await amount();
    heldPositions.push(held);
    expect(held).toBeGreaterThan(beforeGrip);
    // Release before returning the hand: keep the device still.
    await motion({ steps: 4, leftX: 0.81, leftDX: -0.01, pinch: false });
    expect(await amount()).toBeCloseTo(held, 1);
    await motion({ steps: 4, leftX: 0.77, leftDX: -0.005, pinch: false });
    expect(await amount()).toBeCloseTo(held, 1);
    await expect(page.getByText("位置保持中・つかみ直せます")).toBeVisible();
  }
  expect(await amount()).toBe(100);
  console.log("regrip positions", heldPositions);
  // Deliberate withdrawal remains possible as a new grip/stroke.
  await motion({ steps: 4 });
  await motion({ steps: 6, leftDX: -0.01 });
  expect(await amount()).toBeLessThan(94);
  await motion({ steps: 4, pinch: false, leftX: 0.69 });
  await page.screenshot({
    path: "../../work/hand-debug/hand-motion-fixed.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "カメラを停止", exact: true }).click();
});
