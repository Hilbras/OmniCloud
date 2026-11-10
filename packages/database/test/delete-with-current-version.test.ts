import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaRepos } from "../src/index";

const url = process.env.OMNICLOUD_TEST_DATABASE_URL;

/** A random id per test user, so parallel test files never collide on the unique column. */
const uniqueTelegramId = () => BigInt(Math.floor(Math.random() * 2 ** 52) + 1);

/**
 * Permanent deletion must remove a file and its versions in one step while the
 * file still points at its current version. Deleting the version rows first
 * violates the `File.currentVersionId` foreign key.
 *
 * Runs only against a real PostgreSQL database given in OMNICLOUD_TEST_DATABASE_URL.
 */
describe.skipIf(!url)("permanent file deletion with a current version (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let repos: ReturnType<typeof createPrismaRepos>;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: url });
    repos = createPrismaRepos(prisma, null);
    const user = await prisma.user.create({
      data: { telegramUserId: uniqueTelegramId(), username: "delete-current-version" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  });

  it("deletes the file and its current version without a foreign-key error", async () => {
    const file = await repos.files.createWithFirstVersion({
      userId,
      folderId: null,
      name: "versioned.txt",
      size: 1,
      mimeType: "text/plain",
      sha256: "a",
      telegramMessageId: 1,
      version: {
        userId,
        size: 1,
        mimeType: "text/plain",
        sha256: "a",
        telegramMessageId: 1,
      },
    });

    expect(await prisma.fileVersion.count({ where: { fileId: file.id } })).toBe(1);

    await expect(repos.files.deleteMany([file.id])).resolves.toBeUndefined();

    expect(await prisma.file.count({ where: { id: file.id } })).toBe(0);
    expect(await prisma.fileVersion.count({ where: { fileId: file.id } })).toBe(0);
  });
});
