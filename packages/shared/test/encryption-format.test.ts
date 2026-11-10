import { describe, expect, it } from "vitest";
import { ENCRYPTION_FORMAT_OCE1, ENCRYPTION_FORMAT_OCE2, isEncryptedFormat } from "../src/index";

describe("isEncryptedFormat", () => {
  it("treats both OCE1 and OCE2 content as encrypted", () => {
    expect(isEncryptedFormat(ENCRYPTION_FORMAT_OCE1)).toBe(true);
    expect(isEncryptedFormat(ENCRYPTION_FORMAT_OCE2)).toBe(true);
  });

  it("does not treat plaintext or unknown values as encrypted", () => {
    expect(isEncryptedFormat(null)).toBe(false);
    expect(isEncryptedFormat(undefined)).toBe(false);
    expect(isEncryptedFormat("plain")).toBe(false);
  });
});
