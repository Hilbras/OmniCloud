import { describe, expect, it } from "vitest";
import { encodeDraggedItem, parseDraggedItem } from "../src/lib/drag-move";

describe("internal drag payload", () => {
  it("round-trips a file or folder", () => {
    expect(parseDraggedItem(encodeDraggedItem({ id: "f1", kind: "file" }))).toEqual({
      id: "f1",
      kind: "file",
    });
    expect(parseDraggedItem(encodeDraggedItem({ id: "d1", kind: "folder" }))).toEqual({
      id: "d1",
      kind: "folder",
    });
  });

  it("rejects foreign or malformed payloads", () => {
    expect(parseDraggedItem(null)).toBeNull();
    expect(parseDraggedItem("")).toBeNull();
    expect(parseDraggedItem("not json")).toBeNull();
    expect(parseDraggedItem('{"id":"x","kind":"other"}')).toBeNull();
  });
});
