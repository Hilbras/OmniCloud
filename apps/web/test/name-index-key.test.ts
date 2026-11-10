import { beforeEach, describe, expect, it } from "vitest";
import { forgetLoadedIndex, markIndexLoaded, shouldLoadIndex } from "../src/lib/name-index-session";

describe("name index load identity", () => {
  beforeEach(() => forgetLoadedIndex());

  it("needs a reload when the same account switches root key", () => {
    const first = new Uint8Array(32).fill(1);
    const second = new Uint8Array(32).fill(2);
    markIndexLoaded("account-1", first);
    expect(shouldLoadIndex("account-1", first)).toBe(false);
    expect(shouldLoadIndex("account-1", second)).toBe(true);
  });

  it("needs a reload when the account changes", () => {
    const key = new Uint8Array(32).fill(1);
    markIndexLoaded("account-1", key);
    expect(shouldLoadIndex("account-2", key)).toBe(true);
  });
});
