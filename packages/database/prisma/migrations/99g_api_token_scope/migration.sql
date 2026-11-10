-- Narrow API tokens to a purpose. Existing tokens keep full access.
ALTER TABLE "ApiToken" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'full';
