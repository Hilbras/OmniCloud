import { describe, expect, it } from "vitest";
import type { SessionRepository, TelegramSessionRecord } from "@omnicloud/core";
import { TelegramClientManager } from "../src/client";

interface FakeClient {
  connected: boolean;
  connects: number;
  disconnects: number;
  getMe(): Promise<unknown>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

function client(): FakeClient {
  return {
    connected: false,
    connects: 0,
    disconnects: 0,
    async connect() {
      this.connects += 1;
      this.connected = true;
    },
    async getMe() {
      return { id: 1 };
    },
    async disconnect() {
      this.disconnects += 1;
      this.connected = false;
    },
  };
}

function sessions(
  record: TelegramSessionRecord | null = { userId: "u1", stringSession: "s" },
): SessionRepository & { get: () => Promise<TelegramSessionRecord | null> } {
  return {
    async get() {
      return record;
    },
    async save() {},
    async delete() {},
  };
}

function manager(
  options: {
    session?: TelegramSessionRecord | null;
    create?: () => FakeClient;
  } = {},
) {
  const created: FakeClient[] = [];
  const factory = () => {
    const next = options.create ? options.create() : client();
    created.push(next);
    return next;
  };
  const instance = new TelegramClientManager(
    { apiId: 1, apiHash: "hash" },
    sessions(options.session ?? undefined),
    (() => factory()) as never,
  );
  return { instance, created };
}

describe("TelegramClientManager lifecycle", () => {
  it("establishes one client for concurrent callers", async () => {
    const { instance, created } = manager();
    const [left, right] = await Promise.all([instance.getForUser("u1"), instance.getForUser("u1")]);
    expect(created).toHaveLength(1);
    expect(left).toBe(right);
  });

  it("refuses to leak a client that finished connecting after disconnect", async () => {
    const fake = client();
    let releaseConnect: (() => void) | undefined;
    fake.connect = async () => {
      fake.connects += 1;
      await new Promise<void>((resolve) => {
        releaseConnect = resolve;
      });
      fake.connected = true;
    };
    const { instance } = manager({ create: () => fake });

    const connecting = instance.getForUser("u1");
    await Promise.resolve();
    await Promise.resolve();
    const disconnecting = instance.disconnectUser("u1");
    expect(releaseConnect).toBeDefined();
    (releaseConnect as () => void)();
    await disconnecting;

    await expect(connecting).rejects.toThrow(/closed/i);
    expect(fake.disconnects).toBeGreaterThanOrEqual(1);
  });

  it("reconnects an errored connection during a health check", async () => {
    const first = client();
    const second = client();
    let calls = 0;
    const { instance, created } = manager({
      create: () => {
        calls += 1;
        return calls === 1 ? first : second;
      },
    });

    await instance.getForUser("u1");
    first.connected = false;

    const health = await instance.healthCheck("u1");
    expect(health.healthy).toBe(true);
    expect(created).toHaveLength(2);
  });

  it("does not retry during the reconnect cooldown", async () => {
    let calls = 0;
    const { instance } = manager({
      create: () => {
        calls += 1;
        if (calls === 1) return client();
        throw new Error("socket hang up");
      },
    });

    const connected = (await instance.getForUser("u1")) as unknown as FakeClient;
    connected.connected = false;

    const first = await instance.healthCheck("u1");
    expect(first.healthy).toBe(false);
    const attemptsAfterFirst = calls;

    const second = await instance.healthCheck("u1");
    expect(second.healthy).toBe(false);
    expect(calls).toBe(attemptsAfterFirst);
  });

  it("drops the previous client and leaves health unprobed when caching a new one", async () => {
    const first = client();
    const second = client();
    let calls = 0;
    const { instance } = manager({
      create: () => {
        calls += 1;
        return calls === 1 ? first : second;
      },
    });

    await instance.getForUser("u1");
    instance.cacheClient("u1", second as never);
    expect(first.disconnects).toBe(1);
    expect(instance.statusForUser("u1")).toMatchObject({
      state: "CONNECTED",
      lastCheckAt: null,
      healthy: null,
    });
  });
});
