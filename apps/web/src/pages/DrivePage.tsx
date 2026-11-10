import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CloudUpload,
  FolderInput,
  FolderUp,
  FolderPlus,
  LockKeyhole,
  Star,
  StarOff,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { SortField, SortOrder } from "@omnicloud/shared";
import { api, ERROR_CODES, errorMessage, isApiError } from "../api/client";
import { downloadFile } from "../api/download";
import { breadcrumbPath, buildFolderTree } from "../lib/tree";
import { fileToItem, folderToItem, isViewMode, itemKeyOf } from "../lib/drive";
import { directorySegments } from "../lib/folder-upload";
import type { DraggedItem } from "../lib/drag-move";
import type { DriveItem, ViewMode } from "../lib/drive";
import { TREE_QUERY_KEY, invalidateDriveQueries } from "../lib/queries";
import { useDriveShell } from "../hooks/useDriveShell";
import { useInfiniteList } from "../hooks/useInfiniteList";
import { useItemActions } from "../hooks/useItemActions";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { usePageShortcuts } from "../hooks/usePageShortcuts";
import { useSelection } from "../hooks/useSelection";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { ContextMenu } from "../components/ContextMenu";
import type { ContextMenuState } from "../components/ContextMenu";
import { DetailsPanel } from "../components/DetailsPanel";
import { EmptyState } from "../components/EmptyState";
import { ItemCollection } from "../components/ItemCollection";
import { PageHeader, PageTitle } from "../components/PageHeader";
import { SelectionBar } from "../components/SelectionBar";
import { SortMenu } from "../components/SortMenu";
import { useToast } from "../components/Toasts";
import { ViewToggle } from "../components/ViewToggle";

const PAGE_LIMIT = 100;

function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes("Files");
}

export default function DrivePage() {
  const { uploads, setActiveFolderId, openCreateFolder, clearSearch } = useDriveShell();
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get("folder");

  const [view, setView] = useLocalStorage<ViewMode>("omnicloud-view", "list", isViewMode);
  const [sort, setSort] = useState<SortField>("name");
  const [order, setOrder] = useState<SortOrder>("asc");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const queryClient = useQueryClient();
  const [detailsItem, setDetailsItem] = useState<DriveItem | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // `omnicloud://file/<id>` opens the drive with this file's details.
  useEffect(() => {
    const fileId = searchParams.get("file");
    if (fileId === null || fileId === "") return;
    let cancelled = false;
    void api.files
      .get(fileId)
      .then(({ file }) => {
        if (!cancelled) setDetailsItem(fileToItem(file));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [searchParams]);
  const selection = useSelection();
  const toast = useToast();

  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    setActiveFolderId(folderId);
    // Leaving the drive must clear the shell's active folder, or a later page
    // uploads into the folder the user was last browsing.
    return () => setActiveFolderId(null);
  }, [folderId, setActiveFolderId]);

  const treeQuery = useQuery({ queryKey: TREE_QUERY_KEY, queryFn: api.folders.tree });
  const tree = useMemo(() => buildFolderTree(treeQuery.data?.folders ?? []), [treeQuery.data]);
  const breadcrumbs = useMemo(() => breadcrumbPath(tree, folderId), [tree, folderId]);

  const folders = useInfiniteList({
    queryKey: ["folders", "children", folderId, sort, order],
    queryFn: (page) =>
      api.folders
        .list({ parentId: folderId, page, limit: PAGE_LIMIT, sort, order, status: "active" })
        .then((result) => ({ items: result.folders, pagination: result.pagination })),
  });

  const files = useInfiniteList({
    queryKey: ["files", "folder", folderId, sort, order],
    queryFn: (page) =>
      api.files
        .list({ folderId, page, limit: PAGE_LIMIT, sort, order, status: "active" })
        .then((result) => ({ items: result.files, pagination: result.pagination })),
  });

  const items = useMemo<DriveItem[]>(
    () => [...folders.items.map(folderToItem), ...files.items.map(fileToItem)],
    [folders.items, files.items],
  );

  const validKeys = useMemo(() => items.map(itemKeyOf), [items]);
  useEffect(() => {
    selection.prune(validKeys);
  }, [validKeys, selection]);

  const navigateToFolder = useCallback(
    (target: string | null) => {
      clearSearch();
      selection.clear();
      setDetailsItem(null);
      setSearchParams(target === null ? {} : { folder: target }, { replace: false });
    },
    [clearSearch, selection, setSearchParams],
  );

  const actions = useItemActions({
    onOpenItem: (item) => {
      if (item.kind === "folder") {
        navigateToFolder(item.id);
      } else {
        void downloadFile(item.id, item.file).catch((error) =>
          toast.error(errorMessage(error, "Could not download the file")),
        );
      }
    },
    onShowDetails: setDetailsItem,
    onReplaceFile: uploads.replace,
  });

  const selectedItems = useMemo(
    () => items.filter((item) => selection.isSelected(itemKeyOf(item))),
    [items, selection],
  );

  // Recover from a deleted/unknown folder: return to the root.
  useEffect(() => {
    const notFound =
      isApiError(folders.error, ERROR_CODES.NOT_FOUND, ERROR_CODES.FOLDER_NOT_FOUND) ||
      isApiError(files.error, ERROR_CODES.NOT_FOUND, ERROR_CODES.FOLDER_NOT_FOUND);
    if (folderId !== null && notFound) setSearchParams({}, { replace: true });
  }, [folderId, folders.error, files.error, setSearchParams]);

  usePageShortcuts({
    onDelete: () => actions.runBatch("trash", selectedItems),
    onEnter: () => {
      const first = selectedItems[0];
      if (first !== undefined) {
        actions.handleAction(first.kind === "folder" ? "open" : "download", first);
      }
    },
    onSelectAll: () => selection.selectAll(validKeys),
    onEscape: () => setDetailsItem(null),
  });

  const storageUnavailable =
    isApiError(folders.error, ERROR_CODES.STORAGE_NOT_INITIALIZED) ||
    isApiError(files.error, ERROR_CODES.STORAGE_NOT_INITIALIZED) ||
    isApiError(folders.error, ERROR_CODES.TELEGRAM_AUTH_REQUIRED) ||
    isApiError(files.error, ERROR_CODES.TELEGRAM_AUTH_REQUIRED) ||
    isApiError(folders.error, ERROR_CODES.STORAGE_UNAVAILABLE) ||
    isApiError(files.error, ERROR_CODES.STORAGE_UNAVAILABLE);

  const contentError = folders.error ?? files.error;
  const loading = folders.isLoading || files.isLoading;
  const offlineSnapshot = folders.isOfflineSnapshot || files.isOfflineSnapshot;

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length > 0) uploads.enqueue(dropped, folderId);
  };

  const moveInto = async (targetFolderId: string, dragged: DraggedItem): Promise<void> => {
    if (dragged.id === targetFolderId) return;
    try {
      if (dragged.kind === "file") await api.files.move(dragged.id, targetFolderId);
      else await api.folders.move(dragged.id, targetFolderId);
      invalidateDriveQueries(queryClient);
      toast.success("Moved");
    } catch (error) {
      toast.error(errorMessage(error, "Could not move the item"));
    }
  };

  const uploadFolder = async (files: File[]): Promise<void> => {
    const cache = new Map<string, string | null>([["", folderId]]);
    for (const file of files) {
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const segments = directorySegments(relative ?? file.name);
      let key = "";
      let parentId = folderId;
      for (const segment of segments) {
        key = key === "" ? segment : `${key}/${segment}`;
        let id = cache.get(key);
        if (id === undefined) {
          const created = await api.folders.create(segment, parentId);
          id = created.folder.id;
          cache.set(key, id);
        }
        parentId = id ?? null;
      }
      uploads.enqueue([file], parentId);
    }
    invalidateDriveQueries(queryClient);
  };

  return (
    <div
      className="relative min-h-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <PageHeader
          title={
            folderId === null ? (
              <PageTitle>My Drive</PageTitle>
            ) : (
              <Breadcrumbs path={breadcrumbs} onNavigate={navigateToFolder} />
            )
          }
          actions={
            <>
              <ViewToggle view={view} onChange={setView} />
              <SortMenu
                sort={sort}
                order={order}
                onChange={(nextSort, nextOrder) => {
                  setSort(nextSort);
                  setOrder(nextOrder);
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                {...{ webkitdirectory: "" }}
                onChange={(event) => {
                  const input = event.currentTarget;
                  const files = Array.from(input.files ?? []);
                  input.value = "";
                  if (files.length > 0) void uploadFolder(files);
                }}
              />
              <button
                type="button"
                className="btn-secondary hidden sm:inline-flex"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderUp className="h-4 w-4" aria-hidden="true" />
                Folder
              </button>
              <button
                type="button"
                className="btn-secondary sm:hidden"
                onClick={() => uploads.openPicker(folderId)}
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                Upload
              </button>
            </>
          }
        />

        {offlineSnapshot ? (
          <p role="status" className="notice">
            Offline — showing the last listing saved on this device. Opening, uploading and moving
            items will fail until the connection returns.
          </p>
        ) : null}

        {storageUnavailable ? (
          <p role="alert" className="notice notice-error">
            {errorMessage(contentError, "Your storage is unavailable right now.")}
          </p>
        ) : null}

        <div className="mt-5">
          <ItemCollection
            items={items}
            view={view}
            transitionKey={`${folderId ?? "root"}:${view}`}
            selection={selection}
            onOpen={(item) =>
              actions.handleAction(item.kind === "folder" ? "open" : "download", item)
            }
            onAction={actions.handleAction}
            onMoveInto={(targetFolderId, dragged) => void moveInto(targetFolderId, dragged)}
            onContextMenu={setContextMenu}
            loading={loading}
            error={
              storageUnavailable || offlineSnapshot || contentError === null
                ? null
                : errorMessage(contentError, "Could not load this folder.")
            }
            onRetry={() => {
              folders.refetch();
              files.refetch();
            }}
            hasMore={!offlineSnapshot && (folders.hasMore || files.hasMore)}
            loadingMore={folders.isLoadingMore || files.isLoadingMore}
            onLoadMore={() => {
              if (folders.hasMore) folders.loadMore();
              if (files.hasMore) files.loadMore();
            }}
            emptyState={
              <EmptyState
                icon={CloudUpload}
                title="Nothing here yet"
                description="Upload your first file or create a folder to get started."
              >
                <button
                  type="button"
                  className="btn-gold"
                  onClick={() => uploads.openPicker(folderId)}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Upload files
                </button>
                <button type="button" className="btn-secondary" onClick={openCreateFolder}>
                  <FolderPlus className="h-4 w-4" aria-hidden="true" />
                  New folder
                </button>
              </EmptyState>
            }
          />
        </div>
      </div>

      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm"
        >
          <div className="glass-strong rounded-2xl border-2 border-dashed border-gold/60 px-8 py-6 text-sm font-medium text-gold-text">
            Drop files to upload
          </div>
        </div>
      ) : null}

      <SelectionBar
        count={selection.count}
        onClear={selection.clear}
        onSelectAll={() => selection.selectAll(validKeys)}
      >
        <button
          type="button"
          className="btn-secondary"
          onClick={() => actions.openMove(selectedItems)}
        >
          <FolderInput className="h-4 w-4" aria-hidden="true" />
          Move
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => actions.runBatch("star", selectedItems)}
        >
          <Star className="h-4 w-4" aria-hidden="true" />
          Star
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => actions.runBatch("unstar", selectedItems)}
        >
          <StarOff className="h-4 w-4" aria-hidden="true" />
          Unstar
        </button>
        {selectedItems.some(
          (item) =>
            item.kind === "file" && !item.trashed && (item.file?.encryptionFormat ?? null) === null,
        ) ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => actions.migrateBatch(selectedItems)}
          >
            <LockKeyhole className="h-4 w-4" aria-hidden="true" />
            Encrypt
          </button>
        ) : null}
        <button
          type="button"
          className="btn-danger"
          onClick={() => actions.runBatch("trash", selectedItems)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Trash
        </button>
      </SelectionBar>

      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      <DetailsPanel
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
        onAction={actions.handleAction}
      />
      {actions.dialogs}
    </div>
  );
}
