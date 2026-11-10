import { describe, expect, it } from "vitest";
import { directorySegments } from "../src/lib/folder-upload";

describe("folder upload paths", () => {
  it("keeps the nested directory structure", () => {
    expect(directorySegments("Photos/2026/img.jpg")).toEqual(["Photos", "2026"]);
  });

  it("handles root files and normalizes separators", () => {
    expect(directorySegments("file.txt")).toEqual([]);
    expect(directorySegments("/root/a.txt")).toEqual(["root"]);
  });
});
