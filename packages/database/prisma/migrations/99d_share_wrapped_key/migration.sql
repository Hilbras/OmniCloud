-- OCE1 share links carry a DEK wrapped with a key derived from a URL-fragment
-- secret. The server stores the opaque wrapped key but never the fragment.
ALTER TABLE "ShareLink" ADD COLUMN "sharedWrappedKey" TEXT;
