-- Operations are always read per user and status. The existing (status,
-- updatedAt) index cannot serve that predicate efficiently.
--
-- The prefix is 99 so this file sorts after 9_*: Prisma applies migrations in
-- lexicographic order, and "11_" would run before "2_".."9_".
CREATE INDEX "UploadOperation_userId_status_idx"
  ON "UploadOperation" ("userId", "status");
