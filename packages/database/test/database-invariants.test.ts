import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * Invariants that only a real database can prove: a file may only point at its
 * own version, and terminal upload replay records are pruned by age.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("database invariants (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "invariants" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("refuses a currentVersionId that belongs to another file", async () => {
    const base = {
      userId,
      folderId: null,
      size: 1,
      mimeType: "text/plain",
      sha256: "a".repeat(64),
    };
    const first = await repos.files.createWithFirstVersion({
      ...base,
      name: "a.txt",
      telegramMessageId: 1,
      version: { ...base, telegramMessageId: 1 },
    });
    const second = await repos.files.createWithFirstVersion({
      ...base,
      name: "b.txt",
      telegramMessageId: 2,
      version: { ...base, telegramMessageId: 2 },
    });
    // Make the other file's first version historical: the unique pointer index
    // no longer rejects the attempt, so the ownership trigger must.
    await repos.files.createVersion({
      fileId: second.id,
      userId,
      size: 1,
      mimeType: "text/plain",
      sha256: "b".repeat(64),
      telegramMessageId: 3,
    });
    const foreignVersion = (await repos.files.listVersions(second.id)).find(
      (version) => version.versionNumber === 1,
    )!;

    await expect(
      prisma.file.update({
        where: { id: first.id },
        data: { currentVersionId: foreignVersion.id },
      }),
    ).rejects.toThrow(/must belong to the same file/i);
  });

  it("prunes only terminal operations older than the cutoff", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const completed = await repos.uploadOperations.create({ userId, operationId: "prune_done_1" });
    const failed = await repos.uploadOperations.create({ userId, operationId: "prune_fail_1" });
    const pending = await repos.uploadOperations.create({ userId, operationId: "prune_pend_1" });
    await repos.uploadOperations.claim(completed.id, "PENDING", "FAILED");
    await repos.uploadOperations.claim(failed.id, "PENDING", "FAILED");
    await prisma.uploadOperation.update({
      where: { id: completed.id },
      data: { status: "COMPLETED", updatedAt: old },
    });
    await prisma.uploadOperation.update({
      where: { id: failed.id },
      data: { updatedAt: old },
    });

    const removed = await repos.uploadOperations.deleteTerminalBefore(new Date());

    expect(removed).toBe(2);
    expect(await prisma.uploadOperation.findUnique({ where: { id: pending.id } })).not.toBeNull();
  });
});
