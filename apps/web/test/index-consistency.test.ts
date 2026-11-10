import { describe, expect, it } from "vitest";
import { analyzeIndex } from "../src/lib/index-consistency";

describe("name index consistency", () => {
  it("finds stale entries and hidden files with no name", () => {
    const report = analyzeIndex(
      [
        { id: "a", encryptionFormat: "OCE2" },
        { id: "b", encryptionFormat: "OCE1" },
        { id: "c", encryptionFormat: null },
      ],
      ["a", "gone"],
    );
    expect(report.stale).toEqual(["gone"]);
    expect(report.missing).toEqual([]);
    expect(report).toMatchObject({ serverFiles: 3, indexEntries: 2 });
  });

  it("reports a hidden file without an index entry", () => {
    expect(analyzeIndex([{ id: "hidden", encryptionFormat: "OCE2" }], []).missing).toEqual([
      "hidden",
    ]);
  });
});
