-- Allow more than one storage channel per account. The oldest row stays the
-- default, so existing lookups keep resolving to the same channel.
DROP INDEX "Storage_userId_provider_key";
CREATE INDEX "Storage_userId_provider_idx" ON "Storage"("userId", "provider");
