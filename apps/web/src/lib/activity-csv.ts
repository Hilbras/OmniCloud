import type { ActivityEventDTO } from "@omnicloud/shared";

function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function activityToCsv(events: ActivityEventDTO[]): string {
  const header = ["createdAt", "action", "resourceType", "resourceId", "resourceName"];
  const rows = events.map((event) =>
    [
      event.createdAt,
      event.action,
      event.resourceType,
      event.resourceId,
      event.resourceName ?? "",
    ].map(cell),
  );
  return [header.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
}
