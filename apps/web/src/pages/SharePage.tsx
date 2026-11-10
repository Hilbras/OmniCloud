import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import type { ShareMetaDTO } from "@omnicloud/shared";
import { formatBytes } from "../lib/format";
import { HEADER_SIZE, decryptBytes, readHeader } from "@omnicloud/crypto";
import { base64ToBytes, toArrayBuffer } from "../lib/bytes";

interface SharePageProps {
  token: string;
}

type State =
  | { kind: "loading" }
  | { kind: "password"; message: string }
  | { kind: "ready"; meta: ShareMetaDTO; password: string | null }
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
  const [downloading, setDownloading] = useState(false);

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
        meta: (await response.json()) as ShareMetaDTO,
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

  const download = async (ready: Extract<State, { kind: "ready" }>): Promise<void> => {
    setDownloading(true);
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
      if (
        ready.meta.file.encryptionFormat !== null &&
        ready.meta.file.encryptionFormat !== undefined
      ) {
        const fragment = new URLSearchParams(window.location.hash.slice(1)).get("k");
        if (ready.meta.sharedWrappedKey === null || fragment === null) {
          setState({ kind: "error", message: "This link is missing its decryption key." });
          return;
        }
        const envelope = new Uint8Array(await blob.arrayBuffer());
        const header = readHeader(envelope.subarray(0, HEADER_SIZE));
        const plaintext = await decryptBytes({
          urk: base64ToBytes(fragment),
          fileId: header.fileId,
          versionId: header.versionId,
          keyEpoch: ready.meta.file.keyEpoch ?? 0,
          wrappedKey: base64ToBytes(ready.meta.sharedWrappedKey),
          envelope,
        });
        blob = new Blob([toArrayBuffer(plaintext)], {
          type: ready.meta.file.mimeType || "application/octet-stream",
        });
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ready.meta.file.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const refreshed = await fetchMeta(token, ready.password);
      if (refreshed.ok) {
        setState({
          kind: "ready",
          meta: (await refreshed.json()) as ShareMetaDTO,
          password: ready.password,
        });
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-lg">
        <p className="muted mb-4 text-xs font-semibold uppercase tracking-[0.18em]">
          OmniCloud shared file
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

        {state.kind === "ready" ? (
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
              onClick={() => void download(state)}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {downloading ? "Preparing…" : "Download"}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
