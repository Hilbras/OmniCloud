import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * The recent view deduplicates files before LIMIT/OFFSET. Deduplicating after
 * the SQL LIMIT returns short pages and makes the reported total unstable.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("recent file pagination (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "recent-dedup" },
    });
    userId = user.id;
    const base = Date.now();
    for (const [index, resourceId] of ["a", "b", "a", "c"].entries()) {
      await prisma.activityEvent.create({
        data: {
          userId,
          action: "download",
          resourceType: "file",
          resourceId,
          createdAt: new Date(base + index * 1000),
        },
      });
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("returns distinct files per page with a stable total", async () => {
    const first = await repos.activity.recentFiles(userId, ["download"], {
      page: 1,
      limit: 2,
    });
    const second = await repos.activity.recentFiles(userId, ["download"], {
      page: 2,
      limit: 2,
    });

    expect(first.total).toBe(3);
    // a appears twice but only once, at its latest timestamp.
    expect(first.items.map((event) => event.resourceId)).toEqual(["c", "a"]);
    expect(second.items.map((event) => event.resourceId)).toEqual(["b"]);
  });
});
