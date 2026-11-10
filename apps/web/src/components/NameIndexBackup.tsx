import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { openIndexContainer } from "@omnicloud/crypto";
import type { IndexEntry } from "@omnicloud/crypto";
import { useMe } from "../hooks/useMe";
import { useCryptoSession } from "../lib/crypto-session";
import { setNameIndex } from "../lib/name-index-session";
import { readIndexBytes, writeIndexBytes } from "../lib/name-index-store";
import { useToast } from "./Toasts";

export function NameIndexBackup() {
  const toast = useToast();
  const me = useMe();
  const urk = useCryptoSession();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const accountId = me.data?.user?.id ?? null;

  const exportIndex = async (): Promise<void> => {
    if (accountId === null) return;
    try {
      const bytes = await readIndexBytes(accountId);
      if (bytes === null) {
        toast.error("There is no saved name index on this device yet.");
        return;
      }
      const blob = new Blob([bytes.slice().buffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "omnicloud-name-index.ocindex";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Name index exported. It is encrypted with your root key.");
    } catch {
      toast.error("Could not export the name index.");
    }
  };

  const importIndex = async (file: File): Promise<void> => {
    if (accountId === null || urk === null) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Validate before replacing: a wrong key or corrupt file must not wipe
      // the working index.
      const entries = openIndexContainer(urk, bytes);
      const next = new Map<string, IndexEntry>();
      for (const entry of entries) next.set(entry.id, entry);
      await writeIndexBytes(accountId, bytes);
      setNameIndex(next);
      toast.success(`Imported ${next.size} names.`);
    } catch {
      toast.error("That index could not be opened with the current root key.");
    }
  };

  if (accountId === null) return null;

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold">Name index backup</h2>
      <p className="muted text-sm">
        The local index maps hidden filenames back to readable names. Export it to keep a backup; it
        stays encrypted with your root key.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => void exportIndex()}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Export index
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => fileRef.current?.click()}
          disabled={urk === null}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Import index
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ocindex,application/octet-stream"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file !== undefined) void importIndex(file);
          }}
        />
      </div>
      {urk === null ? (
        <p className="muted text-xs">Unlock the root key to import a backup.</p>
      ) : null}
    </section>
  );
}
