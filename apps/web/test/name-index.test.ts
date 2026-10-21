import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@omnicloud/crypto";
import { createIndexContainer, generateUrk, openIndexContainer } from "@omnicloud/crypto";
import { matchesListQuery, type SearchableItem } from "@omnicloud/shared";

/**
 * The crypto package holds the index entry and the shared package holds the
 * search interface, and neither depends on the other. This file is where the
 * two are checked against each other: the web app depends on both, so a change
 * to one that breaks the other is caught here rather than at runtime.
 */
const entry: IndexEntry = {
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
};

// A compile-time check: an index entry must be searchable as it is. If the
// shared interface gains a field the crypto entry does not have, this stops
// compiling.
const searchable: SearchableItem = entry;

describe("an index entry is searchable", () => {
  it("carries the fields the search needs", () => {
    expect(searchable.name).toBe("report.pdf");
    expect(searchable.mimeType).toBe("application/pdf");
  });

  it("can be searched with the shared evaluator", () => {
    expect(matchesListQuery(searchable, { status: "active", q: "report" })).toBe(true);
    expect(matchesListQuery(searchable, { status: "active", q: "invoice" })).toBe(false);
  });

  it("survives a round trip through the container unchanged", () => {
    const urk = generateUrk();
    const opened = openIndexContainer(urk, createIndexContainer(urk, [entry]));
    expect(opened[0]).toEqual(entry);
    expect(matchesListQuery(opened[0]!, { status: "active", type: "pdf" })).toBe(true);
  });
});
