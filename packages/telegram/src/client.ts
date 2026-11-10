import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import {
  StorageUnavailableError,
  TelegramAuthRequiredError,
  TelegramConnectionError,
  UnauthorizedError,
} from "@omnicloud/core";
import type { ConnectionState, SessionRepository, StorageHealth } from "@omnicloud/core";
import { mapTelegramError } from "./errors";

// The storage provider raises this one, so it belongs to the package's
// surface even though it is defined in the core.
export { StorageUnavailableError };

export interface TelegramCredentials {
  apiId: number;
  apiHash: string;
}

interface ManagedConnection {
  /** Null while the connection is still being established. */
  client: TelegramClient | null;
  state: ConnectionState;
  /** In-flight connect/reconnect promise, so callers can await it. */
  pending: Promise<TelegramClient> | null;
  lastError: string | null;
  lastCheckAt: number | null;
  lastCheckOk: boolean | null;
}

export interface ConnectionStatus {
  state: ConnectionState;
  lastError: string | null;
  lastCheckAt: Date | null;
  healthy: boolean | null;
}

/** How long a health probe is cached before re-probing. */
const HEALTH_TTL_MS = 30_000;
/** Minimum gap between reconnect attempts for the same user. */
const RECONNECT_COOLDOWN_MS = 5_000;

/**
 * Owns one Telegram (MTProto) connection per authenticated user and tracks an
 * explicit lifecycle state for each:
 *
 *   DISCONNECTED → CONNECTING → CONNECTED
 *                              ↘ RECONNECTING → CONNECTED
 *                              ↘ ERROR | AUTH_REQUIRED
 *
 * Responsibilities: connect, disconnect, reconnect, validateSession,
 * healthCheck, refreshConnection. Sessions never leave the server.
 */
export class TelegramClientManager {
  private connections = new Map<string, ManagedConnection>();
  private lastReconnectAt = new Map<string, number>();
  private changeListeners: Array<(userId: string) => void> = [];

  constructor(
    private readonly credentials: TelegramCredentials,
    private readonly sessions: SessionRepository,
    private readonly createClient: (sessionString: string) => TelegramClient = (sessionString) =>
      new TelegramClient(new StringSession(sessionString), credentials.apiId, credentials.apiHash, {
        connectionRetries: 3,
        autoReconnect: false,
      }),
  ) {}

  /** Called whenever a user's client is installed or dropped. */
  onClientChanged(listener: (userId: string) => void): void {
    this.changeListeners.push(listener);
  }

  private notifyClientChanged(userId: string): void {
    for (const listener of this.changeListeners) listener(userId);
  }

  /** Returns a connected client, (re)connecting when needed. */
  async getForUser(userId: string): Promise<TelegramClient> {
    const existing = this.connections.get(userId);

    if (existing) {
      if (
        existing.state === "CONNECTED" &&
        existing.client !== null &&
        this.isConnected(existing.client)
      ) {
        return existing.client;
      }
      if (existing.pending) return existing.pending;
      if (existing.state === "AUTH_REQUIRED") {
        throw new TelegramAuthRequiredError();
      }
      return this.reconnect(userId, existing);
    }

    return this.connectUser(userId);
  }

  /** Connection status for health reporting and the storage dashboard. */
  statusForUser(userId: string): ConnectionStatus {
    const connection = this.connections.get(userId);
    if (!connection) {
      return { state: "DISCONNECTED", lastError: null, lastCheckAt: null, healthy: null };
    }
    return {
      state: connection.state,
      lastError: connection.lastError,
      lastCheckAt: connection.lastCheckAt ? new Date(connection.lastCheckAt) : null,
      healthy: connection.lastCheckOk,
    };
  }

  /**
   * Probes a user's connection. Cheap by default (connection state only);
   * `deep` performs a real Telegram round-trip to validate the session.
   */
  async healthCheck(userId: string, deep = false): Promise<StorageHealth> {
    let connection = this.connections.get(userId);

    if (!connection) {
      try {
        await this.getForUser(userId);
      } catch (error) {
        const state: ConnectionState =
          error instanceof TelegramAuthRequiredError ? "AUTH_REQUIRED" : "ERROR";
        const current = this.connections.get(userId);
        if (current) current.state = state;
        return {
          healthy: false,
          latencyMs: null,
          message: error instanceof Error ? error.message : "Telegram is not connected",
          targetTitle: null,
        };
      }
      connection = this.connections.get(userId);
    }

    if (!connection) {
      return {
        healthy: false,
        latencyMs: null,
        message: "Telegram is not connected",
        targetTitle: null,
      };
    }

    if (connection.state === "AUTH_REQUIRED") {
      return {
        healthy: false,
        latencyMs: null,
        message: connection.lastError ?? "Telegram sign-in is required",
        targetTitle: null,
      };
    }

    if (connection.pending) {
      try {
        await connection.pending;
      } catch (error) {
        return {
          healthy: false,
          latencyMs: null,
          message: error instanceof Error ? error.message : "Telegram is not connected",
          targetTitle: null,
        };
      }
    }

    if (
      !deep &&
      connection.state === "CONNECTED" &&
      connection.lastCheckAt &&
      Date.now() - connection.lastCheckAt < HEALTH_TTL_MS
    ) {
      return {
        healthy: connection.lastCheckOk ?? false,
        latencyMs: null,
        message: connection.lastError,
        targetTitle: null,
      };
    }

    // An errored connection has no usable client. Reconnect rather than
    // reporting "still connecting" forever.
    if (connection.client === null || !this.isConnected(connection.client)) {
      try {
        await this.reconnect(userId, connection);
      } catch (error) {
        return {
          healthy: false,
          latencyMs: null,
          message: error instanceof Error ? error.message : "Telegram is not connected",
          targetTitle: null,
        };
      }
    }

    const active = connection;
    if (active.client === null) {
      return {
        healthy: false,
        latencyMs: null,
        message: active.lastError ?? "Telegram is not connected",
        targetTitle: null,
      };
    }

    const startedAt = Date.now();
    try {
      await active.client.getMe();
      active.lastCheckAt = Date.now();
      active.lastCheckOk = true;
      active.lastError = null;
      active.state = "CONNECTED";
      return {
        healthy: true,
        latencyMs: Date.now() - startedAt,
        message: null,
        targetTitle: null,
      };
    } catch (error) {
      const mapped = mapTelegramError(error, "Telegram health check failed");
      active.lastCheckAt = Date.now();
      active.lastCheckOk = false;
      active.lastError = mapped.message;
      active.state =
        mapped instanceof TelegramAuthRequiredError || mapped instanceof UnauthorizedError
          ? "AUTH_REQUIRED"
          : "ERROR";
      return {
        healthy: false,
        latencyMs: Date.now() - startedAt,
        message: mapped.message,
        targetTitle: null,
      };
    }
  }

  /** Registers an already-authenticated client (from the login flow). */
  cacheClient(userId: string, client: TelegramClient): void {
    const previous = this.connections.get(userId);
    if (previous?.client && previous.client !== client) {
      void previous.client.disconnect().catch(() => undefined);
    }
    this.lastReconnectAt.delete(userId);
    this.connections.set(userId, {
      client,
      state: "CONNECTED",
      pending: null,
      lastError: null,
      // The login flow proved the session, but no health probe has run yet.
      lastCheckAt: null,
      lastCheckOk: null,
    });
    this.notifyClientChanged(userId);
  }

  /** Drops a user's connection (e.g. after logout) without touching storage. */
  async disconnectUser(userId: string): Promise<void> {
    const connection = this.connections.get(userId);
    this.connections.delete(userId);
    this.lastReconnectAt.delete(userId);
    this.notifyClientChanged(userId);
    if (!connection) return;
    // Wait for an in-flight handshake so its client cannot escape the map.
    await connection.pending?.catch(() => undefined);
    try {
      await connection.client?.disconnect();
    } catch {
      // best effort
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = [...this.connections.keys()];
    await Promise.all(ids.map((userId) => this.disconnectUser(userId)));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private isConnected(client: TelegramClient): boolean {
    try {
      return client.connected === true;
    } catch {
      return false;
    }
  }

  private async connectUser(userId: string): Promise<TelegramClient> {
    const existing = this.connections.get(userId);
    if (existing?.pending) return existing.pending;

    // Reserve the slot before the first await, so two concurrent callers
    // cannot both establish a client that the map can only reference once.
    const connection: ManagedConnection = {
      client: null,
      state: "CONNECTING",
      pending: null,
      lastError: null,
      lastCheckAt: null,
      lastCheckOk: null,
    };
    this.connections.set(userId, connection);

    const attempt = (async () => {
      const session = await this.sessions.get(userId);
      if (!session) {
        throw new TelegramAuthRequiredError("Telegram account is not connected");
      }
      return this.establish(session.stringSession);
    })()
      .then(async (client) => {
        // A concurrent disconnect may have removed or replaced this slot while
        // the handshake was in flight. Do not leak an unmanaged client.
        if (this.connections.get(userId) !== connection) {
          await client.disconnect().catch(() => undefined);
          throw new TelegramAuthRequiredError("The Telegram connection was closed");
        }
        connection.client = client;
        connection.state = "CONNECTED";
        connection.pending = null;
        connection.lastError = null;
        await this.persistSession(userId, client);
        this.notifyClientChanged(userId);
        return client;
      })
      .catch((error: unknown) => {
        connection.pending = null;
        if (error instanceof TelegramAuthRequiredError) {
          if (this.connections.get(userId) === connection) {
            connection.state = "AUTH_REQUIRED";
            connection.lastError = error.message;
          }
          throw error;
        }
        const mapped = mapTelegramError(error, "Could not connect to Telegram");
        if (this.connections.get(userId) === connection) {
          connection.state =
            mapped instanceof TelegramAuthRequiredError || mapped instanceof UnauthorizedError
              ? "AUTH_REQUIRED"
              : "ERROR";
          connection.lastError = mapped.message;
        }
        throw mapped;
      });

    connection.pending = attempt;
    return attempt;
  }

  private async reconnect(userId: string, connection: ManagedConnection): Promise<TelegramClient> {
    if (connection.pending) return connection.pending;

    const lastAttempt = this.lastReconnectAt.get(userId) ?? 0;
    if (Date.now() - lastAttempt < RECONNECT_COOLDOWN_MS) {
      // Fail fast during the cooldown instead of hammering Telegram on every
      // request while it is unreachable.
      throw new TelegramConnectionError(
        connection.lastError ?? "Telegram is reconnecting — try again shortly",
      );
    }
    this.lastReconnectAt.set(userId, Date.now());
    connection.state = "RECONNECTING";

    const attempt = (async () => {
      const session = await this.sessions.get(userId);
      if (!session) {
        throw new TelegramAuthRequiredError("Telegram account is not connected");
      }
      await connection.client?.disconnect().catch(() => undefined);
      return this.establish(session.stringSession);
    })()
      .then(async (client) => {
        if (this.connections.get(userId) !== connection) {
          await client.disconnect().catch(() => undefined);
          throw new TelegramAuthRequiredError("The Telegram connection was closed");
        }
        connection.client = client;
        connection.state = "CONNECTED";
        connection.pending = null;
        connection.lastError = null;
        await this.persistSession(userId, client);
        this.notifyClientChanged(userId);
        return client;
      })
      .catch((error: unknown) => {
        connection.pending = null;
        if (error instanceof TelegramAuthRequiredError) {
          if (this.connections.get(userId) === connection) {
            connection.state = "AUTH_REQUIRED";
            connection.lastError = error.message;
          }
          throw error;
        }
        const mapped = mapTelegramError(error, "Could not reconnect to Telegram");
        if (this.connections.get(userId) === connection) {
          connection.state =
            mapped instanceof TelegramAuthRequiredError || mapped instanceof UnauthorizedError
              ? "AUTH_REQUIRED"
              : "ERROR";
          connection.lastError = mapped.message;
        }
        throw mapped;
      });

    connection.pending = attempt;
    return attempt;
  }

  /** Persists auth-key/DC updates GramJS applies while connecting or reconnecting. */
  private async persistSession(userId: string, client: TelegramClient): Promise<void> {
    if (!(client.session instanceof StringSession)) return;
    try {
      await this.sessions.save(userId, client.session.save());
    } catch {
      // A session write failure must not tear down a working connection; the
      // previous persisted session stays valid.
    }
  }

  private async establish(sessionString: string): Promise<TelegramClient> {
    const client = this.createClient(sessionString);
    try {
      await client.connect();
      // Validate the session immediately so expired sessions surface as
      // AUTH_REQUIRED instead of a generic failure on the first operation.
      if (!client.connected) {
        throw new TelegramConnectionError("Telegram client did not connect");
      }
      await client.getMe();
      return client;
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      throw mapTelegramError(error, "Could not connect to Telegram");
    }
  }
}

export function newTelegramClient(credentials: TelegramCredentials): TelegramClient {
  return new TelegramClient(new StringSession(""), credentials.apiId, credentials.apiHash, {
    connectionRetries: 3,
    autoReconnect: false,
  });
}

/**
 * Extracts the freshly created broadcast channel from a
 * channels.CreateChannel response.
 */
export function extractCreatedChannel(result: Api.TypeUpdates): Api.Channel {
  const chats =
    result instanceof Api.Updates || result instanceof Api.UpdatesCombined ? result.chats : [];
  for (const chat of chats) {
    if (chat instanceof Api.Channel) return chat;
  }
  throw new TelegramConnectionError("Telegram did not return the created storage channel");
}
