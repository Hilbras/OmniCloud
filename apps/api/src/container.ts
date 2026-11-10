import type { AppConfig } from "./config";
import {
  ActivityService,
  FileService,
  FolderService,
  IntegrityService,
  KeyPairingService,
  RecentService,
  SearchService,
  ShareService,
  StatsService,
  StorageEngine,
  StorageNotInitializedError,
  TrashService,
} from "@omnicloud/core";
import type {
  EngineResolver,
  Repos,
  StorageHealth,
  StorageRecord,
  UserRecord,
} from "@omnicloud/core";
import {
  TELEGRAM_PROVIDER,
  TelegramClientManager,
  TelegramConnectionService,
  TelegramStorageProvider,
} from "@omnicloud/telegram";
import { createPrismaClient, createPrismaRepos } from "@omnicloud/database";
import {
  ApiTokenService,
  AuthSessionService,
  ReconciliationFlow,
  ReconciliationService,
  SecretBox,
  deriveKey,
  type OperationSink,
} from "@omnicloud/core";

/**
 * The dependency-injection container: wires the Telegram connection manager,
 * the per-user storage engine, and the v0.2 domain services together.
 */

/** The subset of the Telegram connection service the API depends on. */
export interface ConnectionService {
  startLogin(phone: string): Promise<void>;
  verifyCode(
    phone: string,
    code: string,
  ): Promise<{ status: "ok"; user: UserRecord } | { status: "password_required" }>;
  verifyPassword(
    phone: string,
    password: string,
  ): Promise<{ status: "ok"; user: UserRecord } | { status: "password_required" }>;
  startQrLogin(): Promise<{ flowId: string; token: { url: string; expiresAt: number } }>;
  pollQrLogin(
    flowId: string,
  ): Promise<
    | { status: "waiting"; token: { url: string; expiresAt: number } }
    | { status: "approved"; user: UserRecord }
    | { status: "password_required" }
    | { status: "expired" }
  >;
  submitQrPassword(
    flowId: string,
    password: string,
  ): Promise<{ status: "approved"; user: UserRecord }>;
  ensureStorage(userId: string): Promise<StorageRecord>;
  /** Creates an extra private channel; the oldest registration stays default. */
  createStorage(userId: string, title?: string): Promise<StorageRecord>;
}

export interface StorageHealthService {
  /** Connection state + storage probe for a user. */
  health(userId: string, deep?: boolean): Promise<StorageHealth & { state: string }>;
  /** Drops a user's Telegram connection (logout / reconnect). */
  disconnect(userId: string): Promise<void>;
}

export interface Container {
  config: AppConfig;
  repos: Repos;
  connection: ConnectionService;
  storageHealth: StorageHealthService;
  files: FileService;
  folders: FolderService;
  search: SearchService;
  stats: StatsService;
  trash: TrashService;
  recent: RecentService;
  activity: ActivityService;
  integrity: IntegrityService;
  /** Read-only comparison of the storage channel with the database. */
  reconciliation: ReconciliationService;
  reconciliationFlow: ReconciliationFlow;
  /** Browser sign-in sessions: issue, resolve and revoke. */
  authSessions: AuthSessionService;
  apiTokens: ApiTokenService;
  shares: ShareService;
  keyPairings: KeyPairingService;
  /** Resolves the StorageEngine for a user (their own Telegram channel). */
  engineFor: EngineResolver;
  shutdown(): Promise<void>;
}

export function buildContainer(
  config: AppConfig,
  options: { operationLog?: OperationSink | null } = {},
): Container {
  const prisma = createPrismaClient();
  const box = config.encryptionKey
    ? new SecretBox([{ version: 1, key: deriveKey(config.encryptionKey) }])
    : null;
  const repos = createPrismaRepos(prisma, box);
  return buildContainerFromRepos(config, repos, {
    operationLog: options.operationLog ?? null,
    dispose: () => prisma.$disconnect(),
  });
}

export function buildContainerFromRepos(
  config: AppConfig,
  repos: Repos,
  overrides: {
    connection?: ConnectionService;
    engineFor?: EngineResolver;
    storageHealth?: StorageHealthService;
    /** Receives one structured record per upload, download and permanent delete. */
    operationLog?: OperationSink | null;
    dispose?: () => Promise<void>;
  } = {},
): Container {
  const credentials = {
    apiId: config.telegramApiId,
    apiHash: config.telegramApiHash,
  };

  const clientManager = new TelegramClientManager(credentials, repos.sessions);
  const connection =
    overrides.connection ?? new TelegramConnectionService(repos, clientManager, credentials);

  const engineCache = new Map<string, Promise<StorageEngine>>();
  // A cached engine holds the client it was built with. Drop it whenever the
  // manager installs or disconnects a client, so logout/re-login/reconnect
  // cannot leave requests talking to a dead connection.
  clientManager.onClientChanged((userId) => {
    engineCache.delete(userId);
  });

  const defaultEngineFor: EngineResolver = async (userId, storageId = null) => {
    const cacheKey = `${userId}:${storageId ?? "default"}`;
    const cached = engineCache.get(cacheKey);
    if (cached) {
      try {
        return await cached;
      } catch {
        engineCache.delete(cacheKey);
      }
    }
    const promise = (async () => {
      const storage =
        storageId === null
          ? await repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER)
          : await repos.storages.findByIdForUser(userId, storageId);
      if (!storage) throw new StorageNotInitializedError();
      const client = await clientManager.getForUser(userId);
      return new StorageEngine(
        new TelegramStorageProvider(client, {
          chatId: storage.telegramChatId,
          accessHash: storage.telegramAccessHash,
          title: storage.title,
        }),
      );
    })();
    engineCache.set(cacheKey, promise);
    try {
      return await promise;
    } catch (error) {
      engineCache.delete(cacheKey);
      throw error;
    }
  };

  const engineFor = overrides.engineFor ?? defaultEngineFor;

  const defaultStorageHealth: StorageHealthService = {
    async health(userId, deep = false) {
      const status = clientManager.statusForUser(userId);
      const storage = await repos.storages.findByUserAndProvider(userId, TELEGRAM_PROVIDER);
      if (!storage) {
        return {
          healthy: false,
          latencyMs: null,
          message: "Storage is not initialized",
          targetTitle: null,
          state: "DISCONNECTED",
        };
      }
      const probe = await clientManager.healthCheck(userId, deep);
      return {
        ...probe,
        targetTitle: probe.targetTitle ?? storage.title,
        state: clientManager.statusForUser(userId).state || status.state,
      };
    },
    async disconnect(userId) {
      await clientManager.disconnectUser(userId);
    },
  };

  const activity = new ActivityService(repos.activity);

  return {
    config,
    repos,
    connection,
    storageHealth: overrides.storageHealth ?? defaultStorageHealth,
    files: new FileService(
      repos.files,
      repos.folders,
      engineFor,
      activity,
      repos.uploadOperations,
      overrides.operationLog ?? null,
    ),
    folders: new FolderService(repos.folders, repos.files, engineFor, activity),
    search: new SearchService(repos.files, repos.folders),
    stats: new StatsService(repos.files, repos.folders),
    trash: new TrashService(repos.files, repos.folders, engineFor),
    recent: new RecentService(repos.activity, repos.files),
    activity,
    integrity: new IntegrityService(repos.files, engineFor),
    reconciliation: new ReconciliationService(repos, engineFor),
    reconciliationFlow: new ReconciliationFlow(repos, engineFor),
    authSessions: new AuthSessionService(repos.browserSessions),
    apiTokens: new ApiTokenService(repos.apiTokens),
    shares: new ShareService(repos.shareLinks, repos.files, repos.folders),
    keyPairings: new KeyPairingService(repos.keyPairings),
    engineFor,
    shutdown: async () => {
      await clientManager.disconnectAll();
      await overrides.dispose?.();
    },
  };
}
