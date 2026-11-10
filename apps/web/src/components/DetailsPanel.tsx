import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { Download, Folder, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FileDTO, FileVersionDTO, FolderDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { hasOfflineCopy, removeOfflineCopy, saveOfflineCopy } from "../api/download";
import { isOfflineCopyEligible } from "../lib/offline-files";
import { formatBytes, formatDateTime, plural } from "../lib/format";
import { fileVisual } from "../lib/fileIcons";
import { invalidateVersionQueries } from "../lib/queries";
import type { DriveItem } from "../lib/drive";
import type { ItemAction } from "./itemActions";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toasts";

interface DetailsPanelProps {
  item: DriveItem | null;
  onClose: () => void;
  onAction: (action: ItemAction, item: DriveItem) => void;
  /** False hides the Download/New version buttons in contexts without handlers. */
  showActions?: boolean;
  /** False hides only "New version". */
  showReplace?: boolean;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="muted text-[11px] font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="mt-1 text-[13.5px] break-words">{children}</dd>
    </div>
  );
}

function ItemGlyph({ item }: { item: DriveItem }) {
  if (item.kind === "folder") {
    return <Folder className="h-6 w-6 shrink-0 text-gold" aria-hidden="true" />;
  }
  const { Icon, color } = fileVisual(item.mimeType);
  return <Icon className={`h-6 w-6 shrink-0 ${color}`} aria-hidden="true" />;
}

/**
 * Slide-over with file/folder metadata and version history. On desktop it slides
 * in from the right; on small screens it becomes a bottom sheet. Escape closes.
 */
export function DetailsPanel({
  item,
  onClose,
  onAction,
  showActions = true,
  showReplace = true,
}: DetailsPanelProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (item === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [item, onClose]);

  if (item === null) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-end sm:items-stretch">
      <motion.div
        className="absolute inset-0 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${item.name}`}
        initial={reduceMotion ? { opacity: 0 } : { x: "100%" }}
        animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="glass-strong relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-line sm:h-full sm:max-h-none sm:w-96 sm:rounded-none sm:border-r-0"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <ItemGlyph item={item} />
            <h2 className="min-w-0 text-[15px] font-semibold break-words">{item.name}</h2>
          </div>
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="muted grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-bg-soft hover:text-gold-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!item.trashed && showActions ? (
            <div className="flex flex-wrap gap-2">
              {item.kind === "file" ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onAction("download", item)}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </button>
                  {showReplace ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => onAction("replace", item)}
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      New version
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {item.kind === "file" &&
          item.file !== undefined &&
          item.file !== null &&
          isOfflineCopyEligible(item.file) ? (
            <OfflineCopyControl file={item.file} />
          ) : null}

          {item.kind === "file" && item.file !== undefined && item.file !== null ? (
            <FileStorageMigration file={item.file} />
          ) : null}

          {item.kind === "folder" && item.folder !== undefined && item.folder !== null ? (
            <FolderStorageTarget folder={item.folder} />
          ) : null}

          <dl className="mt-5 grid gap-4">
            <Field label="Type">
              {item.kind === "folder" ? "Folder" : fileVisual(item.mimeType).label}
              {item.kind === "file" ? <span className="muted"> · {item.mimeType}</span> : null}
            </Field>
            {item.kind === "file" ? <Field label="Size">{formatBytes(item.size)}</Field> : null}
            {item.kind === "file" ? (
              <Field label="SHA-256">
                <code className="font-mono text-[12px] break-all select-all">
                  {item.file?.sha256 ?? ""}
                </code>
              </Field>
            ) : null}
            <Field label="Folder">
              {item.kind === "file"
                ? (item.file?.folderId ?? "My Drive")
                : (item.folder?.parentId ?? "My Drive")}
            </Field>
            <Field label="Created">{formatDateTime(item.createdAt)}</Field>
            <Field label="Modified">{formatDateTime(item.updatedAt)}</Field>
            {item.trashed && item.deletedAt !== null ? (
              <Field label="Deleted">{formatDateTime(item.deletedAt)}</Field>
            ) : null}
            {item.kind === "file" ? (
              <Field label="Versions">{plural(item.versionCount, "version")}</Field>
            ) : null}
          </dl>

          {item.kind === "file" ? (
            <VersionList fileId={item.id} versionCount={item.versionCount} />
          ) : null}
        </div>
      </motion.aside>
    </div>
  );
}

function FileStorageMigration({ file }: { file: FileDTO }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState("");
  const storages = useQuery({
    queryKey: ["storages"],
    queryFn: api.storage.listStorages,
  });
  const migrate = useMutation({
    mutationFn: (storageId: string) => api.files.migrate(file.id, storageId),
    onSuccess: () => {
      toast.success("Moved to the chosen channel");
      setTarget("");
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not move the file")),
  });

  const channels = storages.data?.storages ?? [];
  if (channels.length < 2) return null;

  return (
    <section className="mt-5" aria-label="Storage channel">
      <h3 className="eyebrow">Storage channel</h3>
      <p className="muted mt-1 text-[12.5px]">
        Copies every version to another channel, verifies the bytes, then removes the old copy.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          className="field min-w-0 flex-1 px-3 py-2 text-sm"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          aria-label="Move to channel"
        >
          <option value="">Choose a channel…</option>
          {channels
            .filter((channel) => channel.id !== file.storageId)
            .map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.title}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="btn-secondary"
          disabled={target === "" || migrate.isPending}
          onClick={() => migrate.mutate(target)}
        >
          {migrate.isPending ? "Moving…" : "Move"}
        </button>
      </div>
    </section>
  );
}

function FolderStorageTarget({ folder }: { folder: FolderDTO }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const storages = useQuery({
    queryKey: ["storages"],
    queryFn: api.storage.listStorages,
  });
  const update = useMutation({
    mutationFn: (storageId: string | null) => api.folders.update(folder.id, { storageId }),
    onSuccess: () => {
      toast.success("Upload target updated");
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not change the upload target")),
  });

  const channels = storages.data?.storages ?? [];
  // With one channel there is nothing to choose; the default is implied.
  if (channels.length < 2) return null;

  return (
    <section className="mt-5" aria-label="Upload target">
      <h3 className="eyebrow">Upload target</h3>
      <p className="muted mt-1 text-[12.5px]">
        New files in this folder go to the chosen channel. Subfolders inherit it unless they set
        their own.
      </p>
      <select
        className="field mt-2 w-full px-3 py-2 text-sm"
        value={folder.storageId ?? ""}
        disabled={update.isPending}
        onChange={(event) => update.mutate(event.target.value === "" ? null : event.target.value)}
        aria-label="Upload target channel"
      >
        <option value="">Inherit / default</option>
        {channels.map((channel, index) => (
          <option key={channel.id} value={channel.id}>
            {channel.title}
            {index === 0 ? " (default)" : ""}
          </option>
        ))}
      </select>
    </section>
  );
}

function OfflineCopyControl({ file }: { file: FileDTO }) {
  const toast = useToast();
  const [state, setState] = useState<"checking" | "available" | "missing">("checking");
  const [busy, setBusy] = useState(false);
  // The effect only re-checks when the file identity changes; the latest DTO is
  // read from a ref so an unrelated re-render does not refetch the state.
  const fileRef = useRef(file);
  fileRef.current = file;

  useEffect(() => {
    let cancelled = false;
    setState("checking");
    void hasOfflineCopy(fileRef.current).then((available) => {
      if (!cancelled) setState(available ? "available" : "missing");
    });
    return () => {
      cancelled = true;
    };
  }, [file.id, file.updatedAt]);

  const keep = async () => {
    setBusy(true);
    try {
      await saveOfflineCopy(file);
      setState("available");
      toast.success(`"${file.name}" is now available offline`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save an offline copy"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeOfflineCopy(file);
      setState("missing");
      toast.success(`Removed the offline copy of "${file.name}"`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove the offline copy"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5" aria-label="Offline copy">
      <h3 className="eyebrow">Offline</h3>
      {state === "checking" ? (
        <p className="muted mt-2 text-[13px]">Checking for an offline copy…</p>
      ) : state === "available" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="muted text-[13px]">Saved on this device.</p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={remove}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="muted text-[13px]">Not saved on this device.</p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={keep}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy ? "Saving…" : "Keep offline"}
          </button>
        </div>
      )}
    </section>
  );
}

function VersionList({ fileId, versionCount }: { fileId: string; versionCount: number }) {
  const versions = useQuery({
    queryKey: ["versions", fileId],
    queryFn: () => api.files.versions(fileId),
  });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [deleting, setDeleting] = useState<FileVersionDTO | null>(null);
  const [busy, setBusy] = useState(false);

  // A restore or a delete changes the file itself, so the file's own record
  // and the version list are both refreshed.
  const refresh = () => {
    invalidateVersionQueries(queryClient, fileId);
    void queryClient.invalidateQueries({ queryKey: ["files"] });
  };

  const restore = async (version: FileVersionDTO) => {
    setBusy(true);
    try {
      await api.files.restoreVersion(fileId, version.id);
      toast.success(`Restored version ${version.versionNumber}`);
      refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Could not restore that version"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (version: FileVersionDTO) => {
    setBusy(true);
    try {
      await api.files.deleteVersion(fileId, version.id);
      toast.success(`Deleted version ${version.versionNumber}`);
      setDeleting(null);
      refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete that version"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6">
      <h3 className="eyebrow">Version history</h3>
      {versions.isPending ? (
        <p className="muted mt-3 text-[13px]">Loading versions...</p>
      ) : versions.error !== null ? (
        <p className="mt-3 text-[13px] text-bad">
          {errorMessage(versions.error, "Could not load versions")}
        </p>
      ) : (versions.data?.versions.length ?? 0) === 0 ? (
        <p className="muted mt-3 text-[13px]">
          {versionCount > 1 ? "Version history is unavailable." : "No earlier versions."}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {(versions.data?.versions ?? []).map((version) => (
            <li
              key={version.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2"
            >
              <span className="muted w-9 shrink-0 font-mono text-[12px]">
                v{version.versionNumber}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px]">{formatBytes(version.size)}</span>
                <span className="muted block text-[11px]">{formatDateTime(version.createdAt)}</span>
              </span>
              {version.isCurrent ? (
                <span className="shrink-0 rounded-full border border-gold/50 bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-gold-text">
                  Current
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-[12px]"
                    disabled={busy}
                    onClick={() => void restore(version)}
                    title={`Make version ${version.versionNumber} the current one`}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete version ${version.versionNumber}`}
                    className="muted grid h-7 w-7 place-items-center rounded-lg hover:bg-surface hover:text-bad"
                    disabled={busy}
                    onClick={() => setDeleting(version)}
                    title={`Delete version ${version.versionNumber}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleting !== null ? (
        <ConfirmDialog
          title={`Delete version ${deleting.versionNumber}?`}
          message="This permanently removes that version and its stored file. The current version is not affected."
          confirmLabel="Delete version"
          destructive
          busy={busy}
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}
