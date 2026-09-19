import { mkdir, writeFile } from "node:fs/promises";
const url = "https://storage.googleapis.com/mediapipe-assets/right_hands.jpg";
const response = await fetch(url);
if (!response.ok)
  throw new Error(`Test image download failed: ${response.status}`);
await mkdir(new URL("../tests/fixtures/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../tests/fixtures/hand-test.jpg", import.meta.url),
  Buffer.from(await response.arrayBuffer()),
);
console.log(
  "MediaPipe公式テスト画像を用意しました。配布用ビルドには含まれません。",
);
