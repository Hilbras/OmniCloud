export interface AppConfig {
  /** Key that seals Telegram sessions at rest. Null only outside production. */
  encryptionKey: string | null;
  port: number;
  host: string;
  logLevel: string;
  nodeEnv: string;
  cookieSecure: boolean;
  telegramApiId: number;
  telegramApiHash: string;
  maxUploadBytes: number;
  webDistDir: string | null;
  /** Explicit CORS/CSRF origin allowlist; empty = same-origin only. */
  allowedOrigins: string[];
  /** Optional storage quota shown on the dashboard (null = unlimited). */
  quotaBytes: number | null;
  trustProxy: boolean;
  /** npm package checked for newer releases; empty disables the update check. */
  updatePackageName: string;
  /** Whether the periodic npm update check runs. */
  updateCheckEnabled: boolean;
  /**
   * Days a trashed file or folder is kept before it is permanently removed.
   * Zero or less keeps everything in the trash indefinitely.
   */
  trashRetentionDays: number;
  /** Days a terminal upload-operation replay record is kept. */
  uploadOperationRetentionDays: number;
  webDavEnabled: boolean;
  /** Interface the WebDAV listener binds to. Loopback by default. */
  webDavHost: string;
  webDavPort: number;
  webDavWriteEnabled: boolean;
  /** Storage backend: Telegram (default) or a local directory. */
  storageProvider: "telegram" | "local";
  /** Root directory for the local provider. */
  localStorageDir: string;
  /** Sign-in mode: Telegram (default) or a single local account. */
  authMode: "telegram" | "local";
  localAuthEmail: string;
  localAuthPassword: string;
}

function optional(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be zero or a positive integer`);
  }
  return value;
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (!raw || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const storageProvider = optional(env, "STORAGE_PROVIDER", "telegram").toLowerCase();
  if (storageProvider !== "telegram" && storageProvider !== "local") {
    throw new Error('STORAGE_PROVIDER must be "telegram" or "local"');
  }
  const authMode = optional(env, "AUTH_MODE", "telegram").toLowerCase();
  if (authMode !== "telegram" && authMode !== "local") {
    throw new Error('AUTH_MODE must be "telegram" or "local"');
  }
  const localAuthEmail = optional(env, "LOCAL_AUTH_EMAIL", "");
  const localAuthPassword = optional(env, "LOCAL_AUTH_PASSWORD", "");
  if (authMode === "local" && (localAuthEmail === "" || localAuthPassword.length < 8)) {
    throw new Error(
      "LOCAL_AUTH_EMAIL and a LOCAL_AUTH_PASSWORD of at least 8 characters are required when AUTH_MODE=local",
    );
  }

  const telegramApiId = int(env, "TELEGRAM_API_ID", 0);
  const telegramApiHash = optional(env, "TELEGRAM_API_HASH", "");
  const needsTelegram = storageProvider === "telegram" || authMode === "telegram";
  if (needsTelegram && (telegramApiId === 0 || !telegramApiHash)) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH are required. Create an application at https://my.telegram.org (see .env.example).",
    );
  }

  const nodeEnv = optional(env, "NODE_ENV", "development");

  const encryptionKey = optional(env, "OMNICLOUD_ENCRYPTION_KEY", "");
  if (!encryptionKey && nodeEnv === "production") {
    throw new Error("OMNICLOUD_ENCRYPTION_KEY must be set when NODE_ENV=production");
  }

  const quotaGb = Number(optional(env, "STORAGE_QUOTA_GB", "0"));

  return {
    encryptionKey: encryptionKey || null,
    port: int(env, "PORT", 4000),
    host: optional(env, "HOST", "0.0.0.0"),
    logLevel: optional(env, "LOG_LEVEL", "info"),
    nodeEnv,
    // Secure by default in production; a plain-HTTP deployment must opt out
    // explicitly rather than silently sending session cookies in clear text.
    cookieSecure: bool(env, "COOKIE_SECURE", nodeEnv === "production"),
    telegramApiId,
    telegramApiHash,
    maxUploadBytes: int(env, "MAX_UPLOAD_MB", 256) * 1024 * 1024,
    webDistDir: optional(env, "WEB_DIST_DIR", "") || null,
    allowedOrigins: optional(env, "ALLOWED_ORIGINS", "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    quotaBytes: Number.isFinite(quotaGb) && quotaGb > 0 ? Math.round(quotaGb * 1024 ** 3) : null,
    trustProxy: bool(env, "TRUST_PROXY", false),
    updatePackageName: optional(env, "UPDATE_PACKAGE_NAME", "@hilbras/omnicloud"),
    updateCheckEnabled: bool(env, "UPDATE_CHECK_ENABLED", true),
    // Zero keeps the trash indefinitely, which is what TrashService does with
    // a retention of zero or less.
    trashRetentionDays: nonNegativeInt(env, "TRASH_RETENTION_DAYS", 30),
    uploadOperationRetentionDays: nonNegativeInt(env, "UPLOAD_OPERATION_RETENTION_DAYS", 7),
    webDavEnabled: bool(env, "WEBDAV_ENABLED", false),
    webDavHost: optional(env, "WEBDAV_HOST", "127.0.0.1"),
    webDavPort: int(env, "WEBDAV_PORT", 8551),
    webDavWriteEnabled: bool(env, "WEBDAV_WRITE", false),
    storageProvider,
    localStorageDir: optional(env, "LOCAL_STORAGE_DIR", "./data/local-storage"),
    authMode,
    localAuthEmail,
    localAuthPassword,
  };
}
