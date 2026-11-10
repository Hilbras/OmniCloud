export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const MAX_SIZE = 10000;

/** Rejects corrupt or absurd saved bounds instead of creating an invisible window. */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const numbers = ["x", "y", "width", "height"].every(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  );
  if (!numbers) return null;
  const x = value.x as number;
  const y = value.y as number;
  const width = value.width as number;
  const height = value.height as number;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;
  if (width > MAX_SIZE || height > MAX_SIZE) return null;
  if (Math.abs(x) > MAX_SIZE || Math.abs(y) > MAX_SIZE) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: value.maximized === true,
  };
}

export function defaultWindowState(): WindowState {
  return { x: 80, y: 60, width: 1280, height: 800, maximized: false };
}
