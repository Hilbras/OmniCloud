import { describe, expect, it } from "vitest";
import * as browser from "../src/browser";

/**
 * The browser entry must stay free of server-only modules. The build enforces
 * that (no static `node:` imports in `dist/browser.js`); this test guards the
 * export surface so a refactor cannot silently drop or rename it.
 */
describe("browser entry", () => {
  it("exports the HTTP client and OCE1 helpers", () => {
    expect(typeof browser.OmniCloudClient).toBe("function");
    expect(typeof browser.OmniCloudError).toBe("function");
    expect(typeof browser.uploadEncrypted).toBe("function");
    expect(typeof browser.downloadEncrypted).toBe("function");
    expect(typeof browser.encryptFile).toBe("function");
    expect(typeof browser.decryptFile).toBe("function");
    expect(typeof browser.generateUrk).toBe("function");
    expect(typeof browser.readHeader).toBe("function");
  });

  it("exports shared helpers used by browser callers", () => {
    expect(typeof browser.isEncryptedFormat).toBe("function");
    expect(browser.ERROR_CODES).toBeTypeOf("object");
    expect(typeof browser.fileCategory).toBe("function");
    expect(typeof browser.paginationMeta).toBe("function");
  });

  it("does not leak server-only Telegram integration", () => {
    expect("TelegramStorageProvider" in browser).toBe(false);
    expect("TelegramClientManager" in browser).toBe(false);
    expect("StorageEngine" in browser).toBe(false);
  });
});
