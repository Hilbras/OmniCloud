export interface DraggedItem {
  id: string;
  kind: "file" | "folder";
}

export const DRAG_MIME = "application/x-omnicloud-item";

export function encodeDraggedItem(item: DraggedItem): string {
  return JSON.stringify(item);
}

export function parseDraggedItem(raw: string | null | undefined): DraggedItem | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.id !== "string" || value.id === "") return null;
    if (value.kind !== "file" && value.kind !== "folder") return null;
    return { id: value.id, kind: value.kind };
  } catch {
    return null;
  }
}
