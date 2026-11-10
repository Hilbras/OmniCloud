export interface ConsistencyFile {
  id: string;
  encryptionFormat?: string | null;
}

export interface ConsistencyReport {
  stale: string[];
  missing: string[];
  serverFiles: number;
  indexEntries: number;
}

/** Compares the local name index with the server's file list. */
export function analyzeIndex(
  serverFiles: ConsistencyFile[],
  indexIds: Iterable<string>,
): ConsistencyReport {
  const serverIds = new Set(serverFiles.map((file) => file.id));
  const indexSet = new Set(indexIds);
  return {
    stale: [...indexSet].filter((id) => !serverIds.has(id)),
    missing: serverFiles
      .filter((file) => file.encryptionFormat === "OCE2" && !indexSet.has(file.id))
      .map((file) => file.id),
    serverFiles: serverFiles.length,
    indexEntries: indexSet.size,
  };
}
