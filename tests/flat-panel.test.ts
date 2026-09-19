import { describe, it, expect } from "vitest";
import {
  defaultImaging,
  FLAT_PANEL_SIZES,
  fluoroMagnification,
  projectionCaption,
} from "../src/simulator/imaging";

describe("flat panel field of view", () => {
  it("starts at 6 inch and preserves inverse field-to-image magnification through 10 inch", () => {
    expect(defaultImaging.fieldOfViewInch).toBe(6);
    expect(FLAT_PANEL_SIZES).toEqual([6, 7, 8, 9, 10]);
    const scales = FLAT_PANEL_SIZES.map((fieldOfViewInch) =>
      fluoroMagnification({ ...defaultImaging, fieldOfViewInch }),
    );
    expect(scales[0] / scales[4]).toBeCloseTo(10 / 6);
    expect(scales.every((n, i) => i === 0 || n < scales[i - 1])).toBe(true);
    expect(
      fluoroMagnification({ ...defaultImaging, fieldOfViewInch: 10, zoom: 2 }),
    ).toBe(2);
  });
  it("records the field and additional magnification in image and cine captions", () => {
    expect(projectionCaption(defaultImaging)).toContain("FPD 6 inch");
    expect(
      projectionCaption({ ...defaultImaging, fieldOfViewInch: 10, zoom: 1.8 }),
    ).toContain("FPD 10 inch / 1.8×");
  });
});
