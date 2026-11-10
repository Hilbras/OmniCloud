import { useEffect, useState } from "react";
import { Download, File as FileIcon, Folder, Loader2, Lock } from "lucide-react";
import type { SharedLinkMetaDTO } from "@omnicloud/shared";
import { formatBytes } from "../lib/format";
import { HEADER_SIZE, decryptBytes, readHeader } from "@omnicloud/crypto";
import { base64ToBytes, toArrayBuffer } from "../lib/bytes";

interface SharePageProps {
  token: string;
}

type State =
  | { kind: "loading" }
  | { kind: "password"; message: string }
  | { kind: "ready"; meta: SharedLinkMetaDTO; password: string | null }
  | { kind: "error"; message: string };

async function fetchMeta(token: string, password: string | null): Promise<Response> {
  return fetch(`/api/shares/download/${encodeURIComponent(token)}/meta`, {
    headers: password !== null ? { "x-share-password": password } : {},
    credentials: "omit",
  });
}

export default function SharePage({ token }: SharePageProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = async (withPassword: string | null): Promise<void> => {
    setState({ kind: "loading" });
    try {
      const response = await fetchMeta(token, withPassword);
      if (response.status === 401) {
        setState({ kind: "password", message: "This link is password protected." });
        return;
      }
      if (!response.ok) {
        setState({ kind: "error", message: "This link is not available." });
        return;
      }
      setState({
        kind: "ready",
        meta: (await response.json()) as SharedLinkMetaDTO,
        password: withPassword,
      });
    } catch {
      setState({ kind: "error", message: "Could not reach the server." });
    }
  };

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const saveBlob = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadFile = async (ready: Extract<State, { kind: "ready" }>): Promise<void> => {
    const meta = ready.meta;
    if (meta.kind !== "file") return;
    setDownloading(meta.file.id);
    try {
      const response = await fetch(`/api/shares/download/${encodeURIComponent(token)}`, {
        headers: ready.password !== null ? { "x-share-password": ready.password } : {},
        credentials: "omit",
      });
      if (!response.ok) {
        setState({ kind: "error", message: "This link is not available." });
        return;
      }
      let blob = await response.blob();
      if (meta.file.encryptionFormat !== null && meta.file.encryptionFormat !== undefined) {
        const fragment = new URLSearchParams(window.location.hash.slice(1)).get("k");
        if (meta.sharedWrappedKey === null || fragment === null) {
          setState({ kind: "error", message: "This link is missing its decryption key." });
          return;
        }
        const envelope = new Uint8Array(await blob.arrayBuffer());
        const header = readHeader(envelope.subarray(0, HEADER_SIZE));
        const plaintext = await decryptBytes({
          urk: base64ToBytes(fragment),
          fileId: header.fileId,
          versionId: header.versionId,
          keyEpoch: meta.file.keyEpoch ?? 0,
          wrappedKey: base64ToBytes(meta.sharedWrappedKey),
          envelope,
        });
        blob = new Blob([toArrayBuffer(plaintext)], {
          type: meta.file.mimeType || "application/octet-stream",
        });
      }
      saveBlob(blob, meta.file.name);
      const refreshed = await fetchMeta(token, ready.password);
      if (refreshed.ok) {
        setState({
          kind: "ready",
          meta: (await refreshed.json()) as SharedLinkMetaDTO,
          password: ready.password,
        });
      }
    } finally {
      setDownloading(null);
    }
  };

  const downloadFolderFile = async (
    ready: Extract<State, { kind: "ready" }>,
    fileId: string,
    name: string,
  ): Promise<void> => {
    setDownloading(fileId);
    try {
      const response = await fetch(
        `/api/shares/download/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}`,
        {
          headers: ready.password !== null ? { "x-share-password": ready.password } : {},
          credentials: "omit",
        },
      );
      if (!response.ok) {
        setState({ kind: "error", message: "This file is not available." });
        return;
      }
      saveBlob(await response.blob(), name);
      const refreshed = await fetchMeta(token, ready.password);
      if (refreshed.ok) {
        setState({
          kind: "ready",
          meta: (await refreshed.json()) as SharedLinkMetaDTO,
          password: ready.password,
        });
      }
    } finally {
      setDownloading(null);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <p className="muted mb-4 text-xs font-semibold uppercase tracking-[0.18em]">
          {state.kind === "ready" && state.meta.kind === "folder"
            ? "OmniCloud shared folder"
            : "OmniCloud shared file"}
        </p>

        {state.kind === "loading" ? (
          <div role="status" className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading link…
          </div>
        ) : null}

        {state.kind === "error" ? (
          <p role="alert" className="notice notice-error">
            {state.message}
          </p>
        ) : null}

        {state.kind === "password" ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void load(password);
            }}
          >
            <p className="muted text-sm">{state.message}</p>
            <input
              className="w-full rounded-lg border border-line bg-bg-soft px-3 py-2"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
            <button type="submit" className="btn-gold">
              Open link
            </button>
          </form>
        ) : null}

        {state.kind === "ready" && state.meta.kind === "file" ? (
          <div className="grid gap-4">
            <div>
              <h1 className="text-lg font-semibold">{state.meta.file.name}</h1>
              <p className="muted text-sm">
                {formatBytes(state.meta.file.size)} · {state.meta.file.mimeType}
              </p>
            </div>
            <p className="muted text-xs">
              {state.meta.downloadCount}
              {state.meta.maxDownloads !== null ? ` / ${state.meta.maxDownloads}` : ""} downloads
              {state.meta.expiresAt
                ? ` · expires ${new Date(state.meta.expiresAt).toLocaleString()}`
                : ""}
            </p>
            <button
              type="button"
              className="btn-gold"
              onClick={() => void downloadFile(state)}
              disabled={downloading !== null}
            >
              {downloading !== null ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {downloading !== null ? "Preparing…" : "Download"}
            </button>
          </div>
        ) : null}

        {state.kind === "ready" && state.meta.kind === "folder" ? (
          <div className="grid gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold">
                <Folder className="h-5 w-5 text-gold-text" aria-hidden="true" />
                {state.meta.name}
              </h1>
              <p className="muted text-sm">
                {state.meta.entries.filter((entry) => entry.kind === "file").length} files ·{" "}
                {state.meta.entries.filter((entry) => entry.kind === "folder").length} folders
              </p>
            </div>
            <p className="muted text-xs">
              {state.meta.downloadCount}
              {state.meta.maxDownloads !== null ? ` / ${state.meta.maxDownloads}` : ""} downloads
              {state.meta.expiresAt
                ? ` · expires ${new Date(state.meta.expiresAt).toLocaleString()}`
                : ""}
            </p>
            <ul className="grid max-h-[24rem] gap-1 overflow-y-auto">
              {state.meta.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-bg-soft"
                >
                  {entry.kind === "folder" ? (
                    <Folder className="h-4 w-4 shrink-0 text-gold-text" aria-hidden="true" />
                  ) : (
                    <FileIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {entry.kind === "file" ? (
                    entry.locked ? (
                      <span className="muted inline-flex items-center gap-1 text-xs">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        encrypted
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1 text-xs"
                        disabled={downloading !== null}
                        onClick={() => void downloadFolderFile(state, entry.id, entry.name)}
                      >
                        {downloading === entry.id ? "…" : "Download"}
                      </button>
                    )
                  ) : (
                    <span className="muted text-xs">{formatBytes(entry.size)}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted text-[11px]">
              Encrypted files in a folder link stay locked until the per-file key transfer lands.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
