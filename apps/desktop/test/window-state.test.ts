import { describe, expect, it } from "vitest";
import { defaultWindowState, parseWindowState } from "../window-state";

describe("window state", () => {
  it("accepts valid bounds", () => {
    expect(parseWindowState({ x: 10, y: 20, width: 1000, height: 700, maximized: true })).toEqual({
      x: 10,
      y: 20,
      width: 1000,
      height: 700,
      maximized: true,
    });
  });

  it("rejects missing, tiny and absurd bounds", () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState({ x: 0, y: 0, width: 10, height: 700 })).toBeNull();
    expect(parseWindowState({ x: 0, y: 0, width: 20000, height: 700 })).toBeNull();
    expect(parseWindowState({ x: "0", y: 0, width: 1000, height: 700 })).toBeNull();
  });

  it("has a sane fallback", () => {
    const state = defaultWindowState();
    expect(state.width).toBeGreaterThanOrEqual(800);
    expect(state.height).toBeGreaterThanOrEqual(600);
  });
});
