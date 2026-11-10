-- A share link targets exactly one file or one folder.
ALTER TABLE "ShareLink" ALTER COLUMN "fileId" DROP NOT NULL;
ALTER TABLE "ShareLink" ADD COLUMN "folderId" TEXT;

ALTER TABLE "ShareLink"
  ADD CONSTRAINT "ShareLink_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ShareLink_folderId_idx" ON "ShareLink"("folderId");

ALTER TABLE "ShareLink"
  ADD CONSTRAINT "ShareLink_target_check"
  CHECK (((("fileId" IS NOT NULL)::int + ("folderId" IS NOT NULL)::int)) = 1);
