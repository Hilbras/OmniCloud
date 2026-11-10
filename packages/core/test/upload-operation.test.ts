import { describe, expect, it } from "vitest";
import { isValidOperationId } from "../src/services/upload-operation";

describe("upload operation ids", () => {
  it("accepts only bounded, URL-safe operation ids", () => {
    expect(isValidOperationId("op_1234abcd")).toBe(true);
    expect(isValidOperationId("short")).toBe(false);
    expect(isValidOperationId("has spaces in it")).toBe(false);
    expect(isValidOperationId("x".repeat(65))).toBe(false);
    expect(isValidOperationId("../../etc/passwd")).toBe(false);
  });
});
