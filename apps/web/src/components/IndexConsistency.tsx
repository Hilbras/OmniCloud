import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { FileDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { useNameIndex } from "../hooks/useNameIndex";
import { useCryptoSession } from "../lib/crypto-session";
import { rebuildIndexEntries } from "../lib/index-rebuild";
import { analyzeIndex, type ConsistencyReport } from "../lib/index-consistency";
import { useToast } from "./Toasts";

async function listAll(status: "active" | "trashed"): Promise<FileDTO[]> {
  const files: FileDTO[] = [];
  for (let page = 1; ; page += 1) {
    const result = await api.files.list({ status, page, limit: 200 });
    files.push(...result.files);
    if (!result.pagination.hasMore) return files;
  }
}

export function IndexConsistency() {
  const toast = useToast();
  const index = useNameIndex();
  const urk = useCryptoSession();
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const [active, trashed] = await Promise.all([listAll("active"), listAll("trashed")]);
      setReport(analyzeIndex([...active, ...trashed], index.entries.keys()));
    } catch (error) {
      toast.error(errorMessage(error, "Could not check the name index"));
    } finally {
      setChecking(false);
    }
  };

  const rebuild = async (): Promise<void> => {
    if (urk === null) {
      toast.error("Unlock your encryption key first.");
      return;
    }
    setRebuilding(true);
    try {
      const [active, trashed] = await Promise.all([listAll("active"), listAll("trashed")]);
      const entries = await rebuildIndexEntries([...active, ...trashed], urk, api.files.header);
      for (const entry of entries) index.upsert(entry);
      toast.success(`Rebuilt ${entries.length} names.`);
      setReport(analyzeIndex([...active, ...trashed], index.entries.keys()));
    } catch (error) {
      toast.error(errorMessage(error, "Could not rebuild the index"));
    } finally {
      setRebuilding(false);
    }
  };

  const removeStale = (): void => {
    if (report === null) return;
    for (const id of report.stale) index.remove(id);
    setReport({ ...report, stale: [], indexEntries: report.indexEntries - report.stale.length });
    toast.success("Removed stale name entries");
  };

  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-gold-text" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Name index health</h2>
      </div>
      <p className="muted text-sm">
        Checks local names against the server: stale entries for deleted files, and hidden files
        that have no name on this device.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary w-fit"
          onClick={() => void check()}
          disabled={checking}
        >
          {checking ? "Checking…" : "Check index"}
        </button>
        <button
          type="button"
          className="btn-secondary w-fit"
          onClick={() => void rebuild()}
          disabled={rebuilding || urk === null}
        >
          {rebuilding ? "Rebuilding…" : "Rebuild names"}
        </button>
      </div>
      {urk === null ? <p className="muted text-xs">Unlock the root key to rebuild.</p> : null}

      {report !== null ? (
        <div className="space-y-2 text-sm">
          <p>
            {report.serverFiles} files on the server · {report.indexEntries} local names
          </p>
          {report.stale.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-bad">{report.stale.length} stale entries</span>
              <button
                type="button"
                className="btn-secondary px-2 py-1 text-xs"
                onClick={removeStale}
              >
                Remove stale
              </button>
            </div>
          ) : (
            <p className="muted">No stale entries.</p>
          )}
          {report.missing.length > 0 ? (
            <p className="notice notice-error" role="status">
              {report.missing.length} hidden files have no name on this device. Import an index
              backup or open them from the device that named them.
            </p>
          ) : (
            <p className="muted">Every hidden file has a local name.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
