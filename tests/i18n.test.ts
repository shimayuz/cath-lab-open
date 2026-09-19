import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { ja } from "../src/i18n/ja";
import {
  message,
  readLocale,
  translate,
  translator,
} from "../src/i18n/messages";
import { hint, initialState, reducer } from "../src/simulator/model";
import { defaultImaging, projectionCaption } from "../src/simulator/imaging";

describe("Japanese and English parity", () => {
  it("covers every message and preserves every interpolation in English", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
    for (const key of Object.keys(ja) as (keyof typeof ja)[]) {
      expect(en[key].trim(), key).not.toBe("");
      expect(en[key], key).not.toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(en[key].match(/\{\d+\}/g)?.sort() ?? [], key).toEqual(
        ja[key].match(/\{\d+\}/g)?.sort() ?? [],
      );
    }
  });
  it("translates nested direction and cusp values without changing state", () => {
    const text = message(
      "{0}に回し、{1}冠尖へ先端を向けます。",
      message("反時計回り"),
      message("左"),
    );
    expect(translate("ja", text)).toBe(
      "反時計回りに回し、左冠尖へ先端を向けます。",
    );
    expect(translate("en", text)).toBe(
      "Rotate counterclockwise to aim the tip toward the left coronary cusp.",
    );
    const state = reducer(initialState, { type: "target", value: "RCA" });
    const before = JSON.stringify(state);
    expect(translate("en", state.message)).toContain("RCA selected");
    expect(translate("en", hint(state))).toContain("choose JR");
    expect(translate("ja", state.message)).toContain("RCAを選択");
    expect(JSON.stringify(state)).toBe(before);
  });
  it("treats interpolation as text, including dollar signs and markup", () => {
    expect(translator("en")("{0} 造影", "$&<script>")).toBe(
      "$&<script> contrast",
    );
  });
  it("uses Japanese initially, persists English, and tolerates unavailable or corrupt storage", () => {
    expect(readLocale()).toBe("ja");
    expect(readLocale({ getItem: () => "en" })).toBe("en");
    expect(readLocale({ getItem: () => "ja" })).toBe("ja");
    expect(readLocale({ getItem: () => "fr" })).toBe("ja");
    expect(
      readLocale({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("ja");
  });
  it("localizes projection metadata without changing recorded values", () => {
    const projection = Object.freeze({
      ...defaultImaging,
      fieldOfViewInch: 10 as const,
      zoom: 1.5,
    });
    expect(projectionCaption(projection, "en")).toBe(
      "AP / Level / FPD 10 inch / 1.5×",
    );
    expect(projectionCaption(projection, "ja")).toBe(
      "AP / 水平 / FPD 10 inch / 1.5×",
    );
  });
});
