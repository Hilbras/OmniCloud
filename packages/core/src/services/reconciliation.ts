/**
 * Read-only reconciliation between the storage channel and the database.
 *
 * The channel is the user's own account storage, so this module never proposes
 * a deletion. It classifies what it finds and leaves every decision to a person:
 *
 *  - `referenced`   the message is recorded by a file, a version, or an
 *                   upload operation; nothing to do
 *  - `unknown`      a message exists in the channel that no record references;
 *                   it may be a leaked upload, or something the user put there
 *                   themselves, so it is reported and never removed
 *  - `dangling`     a record points at a message that is no longer in the channel
 */

export interface ReferenceSet {
  /** Message ids referenced by live file rows and version rows. */
  fileMessageIds: Set<number>;
  /** Historical version message ids, mapped to the row that owns them. */
  versionByMessageId?: Map<number, { fileId: string; versionId: string }>;
  /** Message ids referenced by upload operations that have stored an object. */
  pendingUploadMessageIds: Set<number>;
}

export type ReconciliationFinding =
  | { kind: "referenced"; messageId: number }
  | { kind: "unknown"; messageId: number; sizeBytes: number | null }
  | {
      kind: "dangling";
      messageId: number;
      recordedBy: "file" | "version" | "upload";
      fileId?: string;
      versionId?: string;
    };

export interface ReconciliationReport {
  scannedMessages: number;
  referencedMessages: number;
  /** The cap the scan used, so a caller can judge how much of the channel it saw. */
  limit: number;
  /** True when the channel listing reached the cap, so older messages were not read. */
  truncated: boolean;
  unknown: Extract<ReconciliationFinding, { kind: "unknown" }>[];
  dangling: Extract<ReconciliationFinding, { kind: "dangling" }>[];
}

/** How much of the channel the scan read. */
export interface ScanInfo {
  limit: number;
  truncated: boolean;
}

/**
 * Classifies channel messages against the database references. Pure: it reads
 * its inputs and decides nothing about what to delete.
 */
export function reconcile(
  channel: { messageId: number; sizeBytes: number | null }[],
  references: ReferenceSet,
  scan: ScanInfo = { limit: 0, truncated: false },
): ReconciliationReport {
  const inChannel = new Set(channel.map((message) => message.messageId));
  const unknown: ReconciliationReport["unknown"] = [];
  let referenced = 0;

  for (const message of channel) {
    const isReferenced =
      references.fileMessageIds.has(message.messageId) ||
      references.pendingUploadMessageIds.has(message.messageId);
    if (isReferenced) {
      referenced += 1;
    } else {
      unknown.push({ kind: "unknown", messageId: message.messageId, sizeBytes: message.sizeBytes });
    }
  }

  const dangling: ReconciliationReport["dangling"] = [];
  // A capped listing says nothing about older messages: every one of them would
  // look missing. Report unknowns from the scanned window, but never dangling
  // references until the whole channel was read.
  if (!scan.truncated) {
    for (const messageId of references.fileMessageIds) {
      if (inChannel.has(messageId)) continue;
      const version = references.versionByMessageId?.get(messageId);
      dangling.push(
        version
          ? {
              kind: "dangling",
              messageId,
              recordedBy: "version",
              fileId: version.fileId,
              versionId: version.versionId,
            }
          : { kind: "dangling", messageId, recordedBy: "file" },
      );
    }
    for (const messageId of references.pendingUploadMessageIds) {
      if (!inChannel.has(messageId)) {
        dangling.push({ kind: "dangling", messageId, recordedBy: "upload" });
      }
    }
  }

  return {
    scannedMessages: channel.length,
    referencedMessages: referenced,
    limit: scan.limit,
    truncated: scan.truncated,
    unknown,
    dangling,
  };
}
