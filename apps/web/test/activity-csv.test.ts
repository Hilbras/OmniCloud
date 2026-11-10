import { describe, expect, it } from "vitest";
import { activityToCsv } from "../src/lib/activity-csv";

describe("activity CSV", () => {
  it("escapes commas, quotes and newlines", () => {
    const csv = activityToCsv([
      {
        id: "1",
        action: "upload",
        resourceType: "file",
        resourceId: "f1",
        resourceName: 'a,"b"\nc',
        metadata: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(csv.split("\n")[0]).toBe("createdAt,action,resourceType,resourceId,resourceName");
    expect(csv).toContain('"a,""b""\nc"');
  });
});
