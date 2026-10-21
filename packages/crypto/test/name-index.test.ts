import { describe, expect, it } from "vitest";
import {
  canonicalIndexJson,
  createIndexContainer,
  deriveIndexKey,
  generateOpaqueName,
  isOpaqueName,
  openIndexContainer,
  parseIndexJson,
  type IndexEntry,
} from "../src/index";
import { generateUrk } from "../src/index";

const entry = (overrides: Partial<IndexEntry> = {}): IndexEntry => ({
  id: "cmux72xpt0008mcvg8bsv9quk",
  name: "report.pdf",
  mimeType: "application/pdf",
  description: "Q3 numbers",
  size: 2097152,
  folderId: "cmux76h8s0004mczja52i07i8",
  starred: true,
  trashed: false,
  versionCount: 2,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  ...overrides,
});

describe("opaque names", () => {
  it("is a prefix and 32 hex characters", () => {
    const name = generateOpaqueName();
    expect(name).toMatch(/^om_[0-9a-f]{32}$/);
    expect(isOpaqueName(name)).toBe(true);
  });

  it("is derived from the given random bytes, so a client can reproduce it", () => {
    const bytes = new Uint8Array(16).fill(0xab);
    expect(generateOpaqueName(bytes)).toBe(`om_${"ab".repeat(16)}`);
  });

  it("gives two uploads of the same content unrelated names", () => {
    expect(generateOpaqueName()).not.toBe(generateOpaqueName());
  });

  it("does not recognise a real name as an opaque one", () => {
    expect(isOpaqueName("report.pdf")).toBe(false);
    expect(isOpaqueName("om_tooshort")).toBe(false);
    expect(isOpaqueName("om_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });
});

describe("the canonical index form", () => {
  it("writes the entry keys in lexicographic order with no whitespace", () => {
    const json = new TextDecoder().decode(canonicalIndexJson([entry()]));
    expect(json.startsWith('{"entries":[{')).toBe(true);
    expect(json).not.toContain(", ");
    const keys = [...json.matchAll(/"([a-zA-Z]+)":/g)].map((m) => m[1]);
    const entryKeys = keys.slice(1);
    expect(entryKeys).toEqual([...entryKeys].sort());
  });

  it("produces the same bytes for the same entries, whatever the order they were built in", () => {
    const a = entry({ id: "a" });
    const b = entry({ id: "b" });
    expect(canonicalIndexJson([a, b])).toEqual(canonicalIndexJson([a, b]));
    // The order of entries is preserved; only the keys within one are sorted.
    expect(canonicalIndexJson([a, b])).not.toEqual(canonicalIndexJson([b, a]));
  });

  it("keeps a null folder and description rather than dropping them", () => {
    const json = new TextDecoder().decode(
      canonicalIndexJson([entry({ folderId: null, description: null })]),
    );
    expect(json).toContain('"folderId":null');
    expect(json).toContain('"description":null');
  });
});

describe("the index container", () => {
  it("round-trips the entries", () => {
    const urk = generateUrk();
    const entries = [entry(), entry({ id: "second", name: "notes.md" })];
    const container = createIndexContainer(urk, entries);
    expect(openIndexContainer(urk, container)).toEqual(entries);
  });

  it("round-trips an empty index", () => {
    const urk = generateUrk();
    expect(openIndexContainer(urk, createIndexContainer(urk, []))).toEqual([]);
  });

  it("fails to open under a different root key", () => {
    const container = createIndexContainer(generateUrk(), [entry()]);
    expect(() => openIndexContainer(generateUrk(), container)).toThrow(/could not be opened/i);
  });

  it("fails to open when the container has been altered", () => {
    const urk = generateUrk();
    const container = createIndexContainer(urk, [entry()]);
    const tampered = container.slice();
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0x01;
    expect(() => openIndexContainer(urk, tampered)).toThrow(/could not be opened/i);
  });

  it("fails to open when the nonce has been altered", () => {
    const urk = generateUrk();
    const container = createIndexContainer(urk, [entry()]);
    const tampered = container.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(() => openIndexContainer(urk, tampered)).toThrow(/could not be opened/i);
  });

  it("rejects a container that is too short to be one", () => {
    expect(() => openIndexContainer(generateUrk(), new Uint8Array(8))).toThrow(/too short/i);
  });

  it("derives a different key for a different root key", () => {
    expect(deriveIndexKey(generateUrk())).not.toEqual(deriveIndexKey(generateUrk()));
  });

  it("does not reuse a nonce between two containers", () => {
    const urk = generateUrk();
    const first = createIndexContainer(urk, [entry()]);
    const second = createIndexContainer(urk, [entry()]);
    expect(first.subarray(0, 24)).not.toEqual(second.subarray(0, 24));
  });
});

describe("parsing an index", () => {
  it("rejects bytes that are not an index", () => {
    expect(() => parseIndexJson(new TextEncoder().encode("not json"))).toThrow(/not valid JSON/i);
    expect(() => parseIndexJson(new TextEncoder().encode("[]"))).toThrow(/not an object/i);
    expect(() => parseIndexJson(new TextEncoder().encode("{}"))).toThrow(/no entries array/i);
    expect(() => parseIndexJson(new TextEncoder().encode('{"entries":[1]}'))).toThrow(
      /not an object/i,
    );
    expect(() => parseIndexJson(new TextEncoder().encode('{"entries":[{}]}'))).toThrow(
      /missing its id or name/i,
    );
  });
});
