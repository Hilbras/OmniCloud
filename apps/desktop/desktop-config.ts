import { randomBytes } from "node:crypto";

/** Values the first-run wizard collects before the server can start. */
export interface DesktopSetupValues {
  TELEGRAM_API_ID: string;
  TELEGRAM_API_HASH: string;
  DATABASE_URL: string;
  OMNICLOUD_ENCRYPTION_KEY: string;
}

export const SETUP_KEYS = [
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "DATABASE_URL",
  "OMNICLOUD_ENCRYPTION_KEY",
] as const;

export interface SetupValidation {
  ok: boolean;
  errors: Partial<Record<(typeof SETUP_KEYS)[number], string>>;
  values: DesktopSetupValues;
}

/** Reads dotenv-style KEY=VALUE lines, preserving quoted values. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    const comment = value.indexOf(" #");
    if (comment >= 0) value = value.slice(0, comment).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Serialises the merged map without dropping keys the wizard does not own. */
export function serializeEnvFile(values: Record<string, string>): string {
  return (
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n"
  );
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

export function validateSetup(values: Record<string, string>): SetupValidation {
  // Only strings are accepted from the renderer; coercion would let `42`
  // silently become a valid-looking API id.
  const read = (key: string): string => {
    const value = values[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const normalized: DesktopSetupValues = {
    TELEGRAM_API_ID: read("TELEGRAM_API_ID"),
    TELEGRAM_API_HASH: read("TELEGRAM_API_HASH"),
    DATABASE_URL: read("DATABASE_URL"),
    OMNICLOUD_ENCRYPTION_KEY: read("OMNICLOUD_ENCRYPTION_KEY"),
  };
  const errors: SetupValidation["errors"] = {};

  if (!/^\d{1,12}$/.test(normalized.TELEGRAM_API_ID) || Number(normalized.TELEGRAM_API_ID) <= 0) {
    errors.TELEGRAM_API_ID = "Use the numeric API ID from my.telegram.org.";
  }
  if (normalized.TELEGRAM_API_HASH.length < 16) {
    errors.TELEGRAM_API_HASH = "Paste the full API hash from my.telegram.org.";
  }
  if (!/^postgres(ql)?:\/\/\S+$/i.test(normalized.DATABASE_URL)) {
    errors.DATABASE_URL = "Enter a PostgreSQL URL starting with postgresql://";
  }
  if (normalized.OMNICLOUD_ENCRYPTION_KEY.length < 32) {
    errors.OMNICLOUD_ENCRYPTION_KEY =
      "The encryption key needs at least 32 characters. Use Generate.";
  }

  return { ok: Object.keys(errors).length === 0, errors, values: normalized };
}

/** Values safe to prefill in the wizard. */
export function setupValuesFromEnv(env: NodeJS.ProcessEnv): DesktopSetupValues {
  return {
    TELEGRAM_API_ID: env.TELEGRAM_API_ID ?? "",
    TELEGRAM_API_HASH: env.TELEGRAM_API_HASH ?? "",
    DATABASE_URL: env.DATABASE_URL ?? "",
    OMNICLOUD_ENCRYPTION_KEY: env.OMNICLOUD_ENCRYPTION_KEY ?? "",
  };
}
