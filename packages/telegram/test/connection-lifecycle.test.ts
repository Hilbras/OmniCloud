import { describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import bigInt from "big-integer";
import { StringSession } from "telegram/sessions/index.js";
import { TelegramConnectionService } from "../src/connection";

function userRecord() {
  return {
    id: "u1",
    telegramUserId: "1",
    username: "test",
    firstName: "Test",
    lastName: null,
    phone: "+100",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function storageRecord() {
  return {
    id: "storage-1",
    userId: "u1",
    provider: "telegram",
    title: "OmniCloud Storage",
    telegramChatId: "10",
    telegramAccessHash: "20",
    createdAt: new Date(),
  };
}

function channelResponse(): Api.Updates {
  return new Api.Updates({
    updates: [],
    chats: [
      new Api.Channel({
        id: bigInt(10),
        accessHash: bigInt(20),
        title: "OmniCloud Storage",
        photo: new Api.ChatPhotoEmpty(),
        date: 1700000000,
      }),
    ],
    users: [],
    date: 1700000000,
    seq: 1,
  });
}

function repos(overrides: Record<string, unknown> = {}) {
  return {
    users: {
      upsertFromTelegram: vi.fn(async () => userRecord()),
    },
    sessions: {
      save: vi.fn(async () => undefined),
    },
    storages: {
      findByUserAndProvider: vi.fn(async () => null),
      create: vi.fn(async () => storageRecord()),
    },
    ...overrides,
  };
}

function service(
  fakeRepos: ReturnType<typeof repos>,
  clientManager: unknown = { cacheClient: vi.fn() },
) {
  return new TelegramConnectionService(fakeRepos as never, clientManager as never, {
    apiId: 1,
    apiHash: "hash",
  });
}

function qrFlow(client: unknown, approved = true) {
  return {
    client,
    createdAt: Date.now(),
    approved,
    needsPassword: false,
    failure: null,
    tokenRequest: null,
    token: null,
    completion: null,
  };
}

describe("Telegram connection lifecycle", () => {
  it("reports an expired QR flow as expired instead of throwing", async () => {
    const disconnect = vi.fn(async () => undefined);
    const instance = service(repos());
    const flows = instance as unknown as {
      qrFlows: Map<string, ReturnType<typeof qrFlow>>;
    };
    flows.qrFlows.set("expired-id", {
      ...qrFlow({ disconnect }),
      createdAt: Date.now() - 6 * 60 * 1000,
    });

    await expect(instance.pollQrLogin("expired-id")).resolves.toEqual({ status: "expired" });
    expect(disconnect).toHaveBeenCalledTimes(1);
    await expect(instance.pollQrLogin("unknown-id")).resolves.toEqual({ status: "expired" });
  });

  it("creates the storage channel once for concurrent callers", async () => {
    const fakeRepos = repos();
    const invoke = vi.fn(async (request: unknown) => {
      if (request instanceof Api.channels.CreateChannel) return channelResponse();
      throw new Error("not available in this test");
    });
    const client = {
      invoke,
      uploadFile: vi.fn(async () => {
        throw new Error("cosmetic upload failed");
      }),
    };
    const instance = service(fakeRepos);

    const [left, right] = await Promise.all([
      instance.ensureStorageForClient("u1", client as never),
      instance.ensureStorageForClient("u1", client as never),
    ]);

    expect(left).toEqual(right);
    expect(fakeRepos.storages.create).toHaveBeenCalledTimes(1);
    expect(
      invoke.mock.calls.filter(([request]) => request instanceof Api.channels.CreateChannel),
    ).toHaveLength(1);
  });

  it("finalizes an approved QR login once for concurrent polls", async () => {
    const fakeRepos = repos();
    const invoke = vi.fn(async (request: unknown) => {
      if (request instanceof Api.channels.CreateChannel) return channelResponse();
      throw new Error("not available in this test");
    });
    const client = {
      session: new StringSession(""),
      getMe: vi.fn(
        async () =>
          new Api.User({
            id: bigInt(1),
            accessHash: bigInt(1),
            firstName: "Test",
          }),
      ),
      invoke,
      uploadFile: vi.fn(async () => {
        throw new Error("cosmetic upload failed");
      }),
      disconnect: vi.fn(async () => undefined),
    };
    const cacheClient = vi.fn();
    const instance = service(fakeRepos, { cacheClient });
    const flows = instance as unknown as {
      qrFlows: Map<string, ReturnType<typeof qrFlow>>;
    };
    flows.qrFlows.set("flow-1", qrFlow(client));

    const [left, right] = await Promise.all([
      instance.pollQrLogin("flow-1"),
      instance.pollQrLogin("flow-1"),
    ]);

    expect(left).toMatchObject({ status: "approved", user: { id: "u1" } });
    expect(right).toEqual(left);
    expect(fakeRepos.users.upsertFromTelegram).toHaveBeenCalledTimes(1);
    expect(cacheClient).toHaveBeenCalledTimes(1);
  });
});
