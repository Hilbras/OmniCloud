CREATE TABLE "KeyPairing" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wrappedUrk" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "keyEpoch" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeyPairing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KeyPairing_userId_createdAt_idx" ON "KeyPairing"("userId", "createdAt");
CREATE INDEX "KeyPairing_expiresAt_idx" ON "KeyPairing"("expiresAt");
ALTER TABLE "KeyPairing" ADD CONSTRAINT "KeyPairing_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
