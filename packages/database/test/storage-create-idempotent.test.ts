import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * Multiple channels per account are supported, so concurrent creates both
 * succeed. The contract that matters is that the *default* lookup is stable:
 * it always resolves to the oldest registration for that provider.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("storage defaults under concurrent creates (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "storage-create" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("keeps one stable default and allows additional channels", async () => {
    const input = {
      userId,
      provider: "telegram",
      title: "OmniCloud Storage",
      telegramChatId: "100",
      telegramAccessHash: "200",
    };

    const [left, right] = await Promise.all([
      repos.storages.create(input),
      repos.storages.create({ ...input, telegramChatId: "101", title: "Archive" }),
    ]);

    expect(left.id).not.toBe(right.id);
    expect(await prisma.storage.count({ where: { userId } })).toBe(2);

    const first = await repos.storages.findByUserAndProvider(userId, "telegram");
    const second = await repos.storages.findByUserAndProvider(userId, "telegram");
    expect(first).not.toBeNull();
    expect(second?.id).toBe(first?.id);
  });
});
