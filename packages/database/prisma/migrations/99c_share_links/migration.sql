-- Public share links are file-only for now. The raw token is never stored.
CREATE TABLE "ShareLink" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "passwordHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "maxDownloads" INTEGER,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShareLink_tokenHash_key" ON "ShareLink"("tokenHash");
CREATE INDEX "ShareLink_userId_createdAt_idx" ON "ShareLink"("userId", "createdAt");
CREATE INDEX "ShareLink_expiresAt_idx" ON "ShareLink"("expiresAt");

ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
