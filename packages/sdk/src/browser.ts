/**
 * Browser entry point for `@hilbras/omnicloud`.
 *
 * Only the parts that run without Node builtins: the HTTP client, the in-memory
 * OCE1 encryption helpers, the crypto primitives and the shared DTOs. The
 * filesystem/spool helpers (`encryptFileToSpool`, `uploadEncryptedStream`,
 * `downloadDecryptedToFile`) and the Telegram server integration are
 * intentionally absent — import the package root in Node for those.
 *
 * Dynamic `node:` imports inside the shared modules are only reached by those
 * Node-only functions, so a bundler can leave them unresolved.
 */

export { OmniCloudClient, OmniCloudError } from "./client";
export type {
  DownloadProgress,
  DownloadResult,
  OmniCloudClientOptions,
  RetryOptions,
  UploadInput,
  StreamedDownload,
  UploadOptions,
  UploadProgress,
} from "./client";

export { downloadEncrypted, uploadEncrypted } from "./encryption";
export type {
  EncryptedDownloadOptions,
  EncryptedDownloadResult,
  EncryptedUploadInput,
  EncryptedUploadOptions,
  EncryptedUploadResult,
} from "./encryption";

export {
  AuthenticationError,
  BindingError,
  ENCRYPTION_FORMAT,
  KEY_EPOCH_V1,
  ManifestError,
  Oce1Error,
  TrailingDataError,
  UnsupportedFormatError,
  ValidationError,
  decryptFile,
  encryptFile,
  generateId,
  generateUrk,
  readHeader,
} from "@omnicloud/crypto";
export type { EncryptedVersion, FileMetadata, Oce1Header } from "@omnicloud/crypto";

export {
  ERROR_CODES,
  fileCategory,
  isFileCategory,
  isEncryptedFormat,
  mimeFromFilename,
  mimeMatchersForType,
  parseSearchQuery,
  parseSize,
  paginationMeta,
} from "@omnicloud/shared";
export type {
  FileDTO,
  FileVersionDTO,
  FolderDTO,
  ItemStatus,
  PaginationDTO,
  SearchResultDTO,
  SortField,
  SortOrder,
} from "@omnicloud/shared";
