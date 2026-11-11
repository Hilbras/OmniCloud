import type { OperationSink } from "@omnicloud/core";
import type { FastifyInstance } from "fastify";
import type { UserRecord } from "@omnicloud/core";
import { NotFoundError, StorageEngine } from "@omnicloud/core";
import { TELEGRAM_PROVIDER } from "@omnicloud/telegram";
import type { Container, ConnectionService, StorageHealthService } from "../src/container";
import { buildContainerFromRepos } from "../src/container";
import type { AppConfig } from "../src/config";
import { createApp } from "../src/app";
import type { UpdateChecker } from "../src/update-checker";
import { FakeStorageProvider, createInMemoryRepos, type InMemoryRepos } from "./repos";
import { startWebDavServer } from "../src/webdav/server";
import { loadWebDavConfig } from "../src/webdav/config";

export function testConfig(maxUploadBytes = 1024 * 1024, webDistDir?: string): AppConfig {
  return {
    encryptionKey: "test-encryption-key-that-is-long-enough",
    port: 0,
    host: "127.0.0.1",
    logLevel: "error",
    nodeEnv: "test",
    cookieSecure: false,
    telegramApiId: 12345,
    telegramApiHash: "test-hash",
    maxUploadBytes,
    webDistDir: webDistDir ?? null,
    allowedOrigins: [],
    quotaBytes: null,
    trustProxy: false,
    updatePackageName: "@hilbras/omnicloud",
    updateCheckEnabled: false,
    trashRetentionDays: 30,
    uploadOperationRetentionDays: 7,
    webDavEnabled: false,
    webDavHost: "127.0.0.1",
    webDavPort: 8551,
    webDavWriteEnabled: false,
    storageProvider: "telegram",
    localStorageDir: "./data/local-storage",
    authMode: "telegram",
    localAuthEmail: "",
    localAuthPassword: "",
  };
}

/**
 * Telegram connection double: login code "12345" succeeds, "0000" triggers the
 * two-factor password step, anything else is rejected.
 */
export class FakeTelegramConnection implements ConnectionService {
  constructor(private readonly repos: InMemoryRepos) {}

  async startLogin(_phone: string): Promise<void> {}

  async verifyCode(
    phone: string,
    code: string,
  ): Promise<{ status: "ok"; user: UserRecord } | { status: "password_required" }> {
    if (code === "0000") return { status: "password_required" };
    if (code !== "12345") throw new Error("Invalid confirmation code");
    return this.complete(phone);
  }

  async verifyPassword(
    phone: string,
    _password: string,
  ): Promise<{ status: "ok"; user: UserRecord }> {
    return this.complete(phone);
  }

  private qrFlows = new Map<string, { approved: boolean; passwordRequired: boolean }>();

  async startQrLogin() {
    const flowId = `qr-${this.qrFlows.size + 1}`;
    this.qrFlows.set(flowId, { approved: false, passwordRequired: false });
    return {
      flowId,
      token: { url: `tg://login?token=fake-${flowId}`, expiresAt: Date.now() + 30_000 },
    };
  }

  /** Test hook: marks a QR flow approved on the phone, or requires a password. */
  approveQr(flowId: string, passwordRequired = false): void {
    const flow = this.qrFlows.get(flowId);
    if (!flow) throw new Error(`no QR flow ${flowId}`);
    flow.approved = true;
    flow.passwordRequired = passwordRequired;
  }

  async pollQrLogin(flowId: string) {
    const flow = this.qrFlows.get(flowId);
    if (!flow) throw new NotFoundError("This Telegram QR sign-in has ended. Start again.");
    if (!flow.approved) {
      return {
        status: "waiting" as const,
        token: { url: `tg://login?token=fake-${flowId}`, expiresAt: Date.now() + 30_000 },
      };
    }
    if (flow.passwordRequired) return { status: "password_required" as const };
    this.qrFlows.delete(flowId);
    const result = await this.complete("+15550000001");
    return { status: "approved" as const, user: result.user };
  }

  async submitQrPassword(flowId: string, _password: string) {
    const flow = this.qrFlows.get(flowId);
    if (!flow) throw new NotFoundError("This Telegram QR sign-in has ended. Start again.");
    this.qrFlows.delete(flowId);
    const result = await this.complete("+15550000001");
    return { status: "approved" as const, user: result.user };
  }

  async ensureStorage(userId: string) {
    const existing = await this.repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER);
    if (existing) return existing;
    return this.repos.storages.create({
      userId,
      provider: TELEGRAM_PROVIDER,
      title: "OmniCloud Storage",
      telegramChatId: "-1001234567890",
      telegramAccessHash: "987654321",
    });
  }

  async createStorage(userId: string, title?: string) {
    const existing = await this.repos.storages.listByUser(userId);
    if (existing.length >= 5) throw new Error("At most 5 storage channels per account");
    return this.repos.storages.create({
      userId,
      provider: TELEGRAM_PROVIDER,
      title: title?.trim() || "OmniCloud Storage",
      telegramChatId: `-10012345678${existing.length + 1}`,
      telegramAccessHash: `98765432${existing.length + 1}`,
    });
  }

  private async complete(phone: string) {
    const telegramUserId = phone.replace(/\D/g, "") || "424242";
    const user = await this.completeUser(phone, telegramUserId);
    await this.repos.sessions.save(user.id, `fake-telegram-session-${telegramUserId}-secret`);
    return { status: "ok" as const, user };
  }

  private async completeUser(phone: string, telegramUserId: string) {
    const user = await this.repos.users.upsertFromTelegram({
      telegramUserId,
      username: `user_${telegramUserId.slice(-4)}`,
      firstName: "Test",
      lastName: null,
      phone,
    });
    await this.ensureStorage(user.id);
    return user;
  }
}

/** Storage health double that reflects the fake provider. */
export class FakeStorageHealth implements StorageHealthService {
  constructor(private readonly provider: FakeStorageProvider) {}

  async health(_userId: string, _deep = false) {
    const result = await this.provider.healthCheck();
    return { ...result, state: result.healthy ? "CONNECTED" : "ERROR" };
  }

  async disconnect(_userId: string): Promise<void> {}
}

export interface TestHarness {
  app: FastifyInstance;
  container: Container;
  provider: FakeStorageProvider;
  repos: InMemoryRepos;
  /** Performs a fake Telegram login and returns the session cookie value. */
  login(phone?: string): Promise<string>;
  /** The Telegram double, for tests that approve login flows. */
  connectionDouble: FakeTelegramConnection;
  /** Base URL for the WebDAV server when `webDavEnabled` is true. */
  webDavUrl?: string;
  /** Stops the WebDAV server when `webDavEnabled` is true. */
  webDavStop: (() => Promise<void>) | null;
}

/** Builds the Fastify app wired to in-memory repos, a fake provider and a fake Telegram connection. */
export async function createTestHarness(
  maxUploadBytes?: number,
  provider: FakeStorageProvider = new FakeStorageProvider(),
  operationLog: OperationSink | null = null,
  webDistDir?: string,
  engineFor?: (userId: string) => Promise<StorageEngine>,
  updateChecker?: UpdateChecker | null,
  webDavEnabled = false,
  webDavWriteEnabled = false,
  webDavPort = 0,
  configOverrides: Partial<AppConfig> = {},
): Promise<TestHarness> {
  const repos = createInMemoryRepos();

  const connectionDouble = new FakeTelegramConnection(repos);
  const config = {
    ...testConfig(maxUploadBytes, webDistDir),
    updateCheckEnabled: updateChecker !== null && updateChecker !== undefined,
    ...configOverrides,
  };
  const container = buildContainerFromRepos(config, repos, {
    operationLog,
    connection: connectionDouble,
    storageHealth: new FakeStorageHealth(provider),
    engineFor: engineFor ?? (async () => new StorageEngine(provider)),
  });

  const app = await createApp(container, { updateChecker: updateChecker ?? null });
  await app.ready();

  let webDavStop: (() => Promise<void>) | null = null;
  let webDavUrl: string | undefined;
  if (webDavEnabled) {
    const webdavConfig = {
      ...loadWebDavConfig(testConfig(maxUploadBytes, webDistDir)),
      port: webDavPort,
      writeEnabled: webDavWriteEnabled,
    };
    const started = await startWebDavServer(app, container, webdavConfig);
    webDavStop = started.stop;
    webDavUrl = `http://${webdavConfig.host}:${started.port}`;
  }

  return {
    app,
    container,
    provider,
    repos,
    connectionDouble,
    webDavUrl,
    webDavStop,
    async login(phone = "+15551234567") {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/telegram/verify",
        payload: { phone, code: "12345" },
      });
      if (response.statusCode !== 200) {
        throw new Error(`fake login failed: ${response.statusCode} ${response.body}`);
      }
      const cookie = response.cookies[0];
      if (!cookie) throw new Error("fake login did not set a session cookie");
      return cookie.value;
    },
  };
}

/** Builds a multipart/form-data body without external dependencies. */
export function multipartBody(
  fields: Record<string, string>,
  file: { name: string; data: Buffer },
  options: { fileFirst?: boolean } = {},
): { payload: Buffer; contentType: string } {
  const boundary = "----omnicloudtestboundary";
  const fieldParts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    fieldParts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  const fileParts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file.data,
    Buffer.from("\r\n"),
  ];
  const parts = options.fileFirst ? [...fileParts, ...fieldParts] : [...fieldParts, ...fileParts];
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export { FakeStorageProvider, createInMemoryRepos };
export type { InMemoryRepos };
