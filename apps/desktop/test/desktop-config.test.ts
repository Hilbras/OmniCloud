import { describe, expect, it } from "vitest";
import {
  generateEncryptionKey,
  parseEnvFile,
  serializeEnvFile,
  setupValuesFromEnv,
  validateSetup,
} from "../desktop-config";

const valid = {
  TELEGRAM_API_ID: "123456",
  TELEGRAM_API_HASH: "0123456789abcdef0123456789abcdef",
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
  OMNICLOUD_ENCRYPTION_KEY: "a".repeat(64),
};

describe("desktop setup validation", () => {
  it("accepts a complete configuration and trims values", () => {
    const result = validateSetup({
      ...valid,
      TELEGRAM_API_ID: `  ${valid.TELEGRAM_API_ID}  `,
      DATABASE_URL: ` ${valid.DATABASE_URL} `,
    });
    expect(result.ok).toBe(true);
    expect(result.values.TELEGRAM_API_ID).toBe("123456");
    expect(result.values.DATABASE_URL).toBe(valid.DATABASE_URL);
  });

  it("reports every missing or malformed field", () => {
    const result = validateSetup({
      TELEGRAM_API_ID: "abc",
      TELEGRAM_API_HASH: "short",
      DATABASE_URL: "mysql://nope",
      OMNICLOUD_ENCRYPTION_KEY: "short",
    });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      ["DATABASE_URL", "OMNICLOUD_ENCRYPTION_KEY", "TELEGRAM_API_HASH", "TELEGRAM_API_ID"].sort(),
    );
  });

  it("rejects non-string input without throwing", () => {
    const result = validateSetup({ TELEGRAM_API_ID: 42, DATABASE_URL: null } as never);
    expect(result.ok).toBe(false);
    expect(result.errors.TELEGRAM_API_ID).toBeDefined();
    expect(result.errors.DATABASE_URL).toBeDefined();
  });

  it("generates a 64-character key", () => {
    expect(generateEncryptionKey()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips quoted dotenv values", () => {
    const parsed = parseEnvFile('A="value with spaces"\nB=plain # comment\n# ignored\n');
    expect(parsed).toEqual({ A: "value with spaces", B: "plain" });
    expect(serializeEnvFile({ A: "1", OTHER: "kept" })).toBe("A=1\nOTHER=kept\n");
  });

  it("prefills from process environment", () => {
    expect(setupValuesFromEnv(valid)).toEqual(valid);
  });
});
