-- Record which channel holds each file, and let a folder target a channel.
-- Existing rows belong to the account's single Telegram storage.
ALTER TABLE "File" ADD COLUMN "storageId" TEXT;
ALTER TABLE "Folder" ADD COLUMN "storageId" TEXT;

ALTER TABLE "File"
  ADD CONSTRAINT "File_storageId_fkey"
  FOREIGN KEY ("storageId") REFERENCES "Storage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Folder"
  ADD CONSTRAINT "Folder_storageId_fkey"
  FOREIGN KEY ("storageId") REFERENCES "Storage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "File_storageId_idx" ON "File"("storageId");
CREATE INDEX "Folder_storageId_idx" ON "Folder"("storageId");

UPDATE "File" AS f
SET "storageId" = s."id"
FROM "Storage" AS s
WHERE s."userId" = f."userId" AND s."provider" = 'telegram' AND f."storageId" IS NULL;

UPDATE "Folder" AS f
SET "storageId" = s."id"
FROM "Storage" AS s
WHERE s."userId" = f."userId" AND s."provider" = 'telegram' AND f."storageId" IS NULL;
