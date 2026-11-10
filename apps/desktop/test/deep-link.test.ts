import { describe, expect, it } from "vitest";
import { deepLinkPath } from "../deep-link";

describe("deep links", () => {
  it("maps drive and file links", () => {
    expect(deepLinkPath("omnicloud://drive")).toBe("/drive");
    expect(deepLinkPath("omnicloud://file/abc123")).toBe("/drive?file=abc123");
  });

  it("rejects other protocols and unknown hosts", () => {
    expect(deepLinkPath("https://example.com/file/1")).toBeNull();
    expect(deepLinkPath("omnicloud://settings/x")).toBeNull();
    expect(deepLinkPath("not a url")).toBeNull();
  });
});
