import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { BookmarkPlus, Folder, Search, SearchX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { FileDTO, FolderDTO } from "@omnicloud/shared";
import { filterByListQuery, parseSearchQuery } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { formatBytes } from "../lib/format";
import { fileVisual } from "../lib/fileIcons";
import { fileToItem } from "../lib/drive";
import type { DriveItem } from "../lib/drive";
import { entryToFileDTO, useNameIndexEntries, withRealName } from "../lib/name-index-session";
import { LoadingSpinner } from "./LoadingSpinner";
import { listSavedSearches, removeSavedSearch, saveSearch } from "../lib/saved-searches";

interface SearchOverlayProps {
  query: string;
  onClose: () => void;
  onOpenFolder: (folder: FolderDTO) => void;
  onOpenFile: (item: DriveItem) => void;
  onSelectQuery: (query: string) => void;
}

const SYNTAX_HINT = "Try  type:pdf  size:>100MB  folder:Projects  starred:true  after:2026-01-01";

function ResultRow({
  icon,
  label,
  meta,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-gold/40 hover:bg-bg-soft"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={label}>
          {label}
        </span>
        <span className="muted shrink-0 text-[12px]">{meta}</span>
      </button>
    </li>
  );
}

/** Full-width overlay showing search results for the debounced topbar query. */
export function SearchOverlay({
  query,
  onClose,
  onOpenFolder,
  onOpenFile,
  onSelectQuery,
}: SearchOverlayProps) {
  const reduceMotion = useReducedMotion();
  const [saved, setSaved] = useState<string[]>(() => listSavedSearches());

  const results = useQuery({
    queryKey: ["search", query],
    queryFn: () => api.search.query(query),
    enabled: query !== "",
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const folders = useMemo(() => results.data?.folders ?? [], [results.data]);
  const nameIndex = useNameIndexEntries();

  // Files the server cannot match, because it does not know their names: they
  // are matched here, against the client's index.
  const localFiles = useMemo(() => {
    if (nameIndex.size === 0) return [];
    const { query: parsed } = parseSearchQuery(query);
    // Server search covers active and trashed files by default; mirror that.
    const effective = { ...parsed, status: parsed.status ?? "all" };
    // `folder:` is resolved by the server; the matching folder ids come back
    // with the result, so the local index uses the same set.
    const options =
      parsed.folderName !== undefined ? { folderIds: folders.map((folder) => folder.id) } : {};
    return filterByListQuery([...nameIndex.values()], effective, options).map(entryToFileDTO);
  }, [nameIndex, query, folders]);

  // The server answers for the files whose names it still knows, and the index
  // answers for the rest. A file appears once, whichever found it.
  const files = useMemo(() => {
    const serverFiles = (results.data?.files ?? []).map((file) => withRealName(file, nameIndex));
    const seen = new Set(serverFiles.map((file) => file.id));
    return [...serverFiles, ...localFiles.filter((file) => !seen.has(file.id))];
  }, [results.data, localFiles, nameIndex]);

  const empty = folders.length === 0 && files.length === 0;
  const [actionError, setActionError] = useState<string | null>(null);

  // Local index rows do not carry encryption metadata. Fetch the full record
  // before acting so an encrypted file is decrypted instead of saved as
  // ciphertext.
  const openFile = (file: FileDTO): void => {
    if (file.sha256 !== "") {
      onOpenFile(fileToItem(file));
      return;
    }
    setActionError(null);
    void api.files
      .get(file.id)
      .then(({ file: full }) => onOpenFile(fileToItem(withRealName(full, nameIndex))))
      .catch((error: unknown) => setActionError(errorMessage(error, "Could not open the file.")));
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex justify-center bg-black/40 p-4 pt-20"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`Search results for ${query}`}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="glass-strong flex max-h-[70dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line"
      >
        <header className="flex items-center gap-3 border-b border-line/70 px-5 py-4">
          <Search className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            Results for “{query}”
          </h2>
          <button
            type="button"
            aria-label="Close search"
            onClick={onClose}
            className="muted grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-bg-soft hover:text-gold-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <p className="muted border-b border-line/70 px-5 py-2 font-mono text-[11.5px]">
          {SYNTAX_HINT}
        </p>

        <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-5 py-2">
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => setSaved(saveSearch(query))}
          >
            <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Save search
          </button>
          {saved.map((item) => (
            <span
              key={item}
              className="flex items-center gap-1 rounded-full border border-line bg-bg-soft py-0.5 pl-2.5 pr-1 text-xs"
            >
              <button
                type="button"
                className="max-w-40 truncate hover:text-gold-text"
                title={item}
                onClick={() => onSelectQuery(item)}
              >
                {item}
              </button>
              <button
                type="button"
                aria-label={`Remove saved search ${item}`}
                className="muted grid h-5 w-5 place-items-center rounded-full hover:bg-surface hover:text-gold-text"
                onClick={() => setSaved(removeSavedSearch(item))}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {results.isPending ? (
            <LoadingSpinner label="Searching" />
          ) : results.error !== null ? (
            <p role="alert" className="notice notice-error">
              {errorMessage(results.error, "The search failed.")}
            </p>
          ) : empty ? (
            <div className="flex flex-col items-center py-12 text-center">
              <SearchX className="h-7 w-7 text-gold" aria-hidden="true" />
              <p className="muted mt-3 text-sm">No matches for “{query}”.</p>
            </div>
          ) : (
            <>
              {folders.length > 0 ? (
                <section className="mb-3">
                  <h3 className="eyebrow mb-2">Folders</h3>
                  <ul className="grid gap-0.5">
                    {folders.map((folder: FolderDTO) => (
                      <ResultRow
                        key={folder.id}
                        icon={<Folder className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />}
                        label={folder.name}
                        meta="Folder"
                        onSelect={() => onOpenFolder(folder)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}
              {files.length > 0 ? (
                <section>
                  <h3 className="eyebrow mb-2">Files</h3>
                  <ul className="grid gap-0.5">
                    {files.map((file: FileDTO) => {
                      const { Icon, color, label } = fileVisual(file.mimeType);
                      return (
                        <ResultRow
                          key={file.id}
                          icon={<Icon className={`h-4 w-4 shrink-0 ${color}`} aria-hidden="true" />}
                          label={file.name}
                          meta={`${formatBytes(file.size)} · ${label}`}
                          onSelect={() => openFile(file)}
                        />
                      );
                    })}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>
        {actionError !== null ? (
          <p role="alert" className="notice notice-error mx-3 mb-3">
            {actionError}
          </p>
        ) : null}
      </motion.div>
    </div>
  );
}

export type { DriveItem };
