import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * Two concurrent storage creations can both see "no record" and race the
 * unique (userId, provider) insert. The loser must return the winner's row,
 * not a 500 that leaves an orphan channel.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("storage creation is idempotent (PostgreSQL)", () => {
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

  it("returns the same record for concurrent creates", async () => {
    const input = {
      userId,
      provider: "telegram",
      title: "OmniCloud Storage",
      telegramChatId: "100",
      telegramAccessHash: "200",
    };

    const [left, right] = await Promise.all([
      repos.storages.create(input),
      repos.storages.create(input),
    ]);

    expect(left.id).toBe(right.id);
    expect(await prisma.storage.count({ where: { userId } })).toBe(1);
  });
});
