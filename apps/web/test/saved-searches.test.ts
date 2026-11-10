import { beforeEach, describe, expect, it } from "vitest";
import { listSavedSearches, removeSavedSearch, saveSearch } from "../src/lib/saved-searches";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
});

describe("saved searches", () => {
  it("saves newest first without duplicates or blanks", () => {
    saveSearch("type:pdf");
    saveSearch("  type:pdf  ");
    saveSearch("folder:Projects");
    expect(listSavedSearches()).toEqual(["folder:Projects", "type:pdf"]);
    expect(saveSearch("   ")).toEqual(["folder:Projects", "type:pdf"]);
  });

  it("removes a saved search", () => {
    saveSearch("a");
    saveSearch("b");
    expect(removeSavedSearch("a")).toEqual(["b"]);
  });

  it("caps the list", () => {
    for (let index = 0; index < 15; index += 1) saveSearch(`q${index}`);
    expect(listSavedSearches()).toHaveLength(10);
  });
});
