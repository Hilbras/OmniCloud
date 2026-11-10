import { describe, expect, it } from "vitest";
import { OperationCancelledError } from "@omnicloud/core";
import { TelegramStorageProvider } from "../src/provider";
import { mapTelegramError } from "../src/errors";
import { RPCError } from "telegram/errors/index.js";

const input = {
  name: "a.bin",
  mimeType: "application/octet-stream" as const,
  data: Buffer.from("abc"),
  sha256: "a".repeat(64),
  caption: `${"a".repeat(64)}:op_0002`,
};

describe("upload cancellation", () => {
  it("exposes a live isCanceled getter to GramJS", async () => {
    const controller = new AbortController();
    let observed: { isCanceled?: boolean } | null = null;
    const client = {
      connected: true,
      async sendFile(_peer: unknown, options: { progressCallback: { isCanceled?: boolean } }) {
        const callback = options.progressCallback;
        observed = callback;
        expect(callback.isCanceled).toBe(false);
        controller.abort();
        expect(callback.isCanceled).toBe(true);
        throw new RPCError("USER_CANCELED", undefined as never, 400);
      },
    };
    const provider = new TelegramStorageProvider(client as never, {
      chatId: "10",
      accessHash: "20",
    });

    const failure = await provider
      .put(input, { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(observed).not.toBeNull();
    expect(failure).toBeInstanceOf(OperationCancelledError);
  });

  it("maps GramJS USER_CANCELED to OperationCancelledError", () => {
    const error = mapTelegramError(
      new RPCError("USER_CANCELED", undefined as never, 400),
      "Telegram upload failed",
    );
    expect(error).toBeInstanceOf(OperationCancelledError);
  });
});
