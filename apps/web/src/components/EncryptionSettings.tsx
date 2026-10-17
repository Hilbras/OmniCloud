import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { errorMessage } from "../api/client";
import { useLocalStorage } from "../hooks/useLocalStorage";
import {
  ENCRYPT_UPLOADS_KEY,
  clear as clearKey,
  generate as generateKey,
  isEncryptUploadsPref,
  toHex,
  unlockFromHex,
  useCryptoSession,
} from "../lib/crypto-session";
import type { EncryptUploadsPref } from "../lib/crypto-session";
import { useToast } from "./Toasts";

/**
 * "Encryption (experimental)" settings block: generate / unlock / clear the
 * in-memory URK and opt in to encrypting new uploads. Rendered on the
 * settings (API tokens) page.
 */
export function EncryptionSettings() {
  const toast = useToast();
  const urk = useCryptoSession();
  const active = urk !== null;

  const [generatedHex, setGeneratedHex] = useState<string | null>(null);
  const [unlockValue, setUnlockValue] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [encryptUploads, setEncryptUploads] = useLocalStorage<EncryptUploadsPref>(
    ENCRYPT_UPLOADS_KEY,
    "off",
    isEncryptUploadsPref,
  );

  const handleGenerate = () => {
    setGeneratedHex(toHex(generateKey()));
    setUnlockValue("");
    setUnlockError(null);
  };

  const handleUnlock = (event: FormEvent) => {
    event.preventDefault();
    try {
      unlockFromHex(unlockValue);
    } catch (error) {
      setUnlockError(errorMessage(error, "Invalid key"));
      return;
    }
    setUnlockError(null);
    setUnlockValue("");
    setGeneratedHex(null);
    toast.success("Encryption key unlocked for this tab");
  };

  const handleClear = () => {
    clearKey();
    setGeneratedHex(null);
    setUnlockValue("");
    setUnlockError(null);
    toast.success("Encryption key cleared from this tab");
  };

  const copyGenerated = async () => {
    if (generatedHex === null) return;
    try {
      await navigator.clipboard.writeText(generatedHex);
      toast.success("Key copied");
    } catch {
      toast.error("Could not copy. Select the key and copy it manually.");
    }
  };

  return (
    <section className="card space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold">Encryption (experimental)</h2>
        <p className="muted mt-1 text-[13px]">
          Client-side end-to-end encryption for file contents. Experimental and not yet
          independently audited — filenames are still sent to the server for listing.
        </p>
      </div>

      <div className="flex items-center gap-2 text-[13px]">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-ok" : "bg-line-strong"}`}
          aria-hidden="true"
        />
        <span className="font-medium">{active ? "Key active" : "Not active"}</span>
        <span className="muted">· held in memory for this tab only, never stored</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-gold" onClick={handleGenerate}>
          <KeyRound className="h-4 w-4" aria-hidden="true" /> Generate key
        </button>
        <button type="button" className="btn-ghost" onClick={handleClear} disabled={!active}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Clear key
        </button>
      </div>

      {generatedHex !== null ? (
        <div className="space-y-2 rounded-xl border border-gold/50 bg-gold-soft p-4">
          <p className="text-[13px] font-semibold text-gold-text">
            Save this key now — it is shown only once
          </p>
          <p className="muted text-[12.5px]">
            Copy it somewhere safe and offline. It cannot be recovered: without it, files encrypted
            with it can never be opened again, and it is not saved on this device.
          </p>
          <code className="block rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[12.5px] break-all select-all">
            {generatedHex}
          </code>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={copyGenerated}>
              <Copy className="h-4 w-4" aria-hidden="true" /> Copy
            </button>
            <button type="button" className="btn-ghost" onClick={() => setGeneratedHex(null)}>
              I have saved it
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleUnlock} className="space-y-2">
        <label className="block text-[13px] font-medium" htmlFor="encryption-unlock-key">
          Unlock by pasting a key
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="encryption-unlock-key"
            type="text"
            value={unlockValue}
            onChange={(event) => {
              setUnlockValue(event.target.value);
              if (unlockError !== null) setUnlockError(null);
            }}
            placeholder="64 hexadecimal characters"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-bg-soft px-3 py-2 font-mono text-[13px] outline-none focus:border-gold"
          />
          <button
            type="submit"
            className="btn-secondary"
            disabled={unlockValue.trim().length === 0}
          >
            Unlock
          </button>
        </div>
        {unlockError !== null ? (
          <p role="alert" className="text-[12.5px] text-bad">
            {unlockError}
          </p>
        ) : null}
      </form>

      <div className="border-t border-line pt-4">
        <label
          className={`flex items-start gap-3 ${active ? "cursor-pointer" : "cursor-not-allowed"}`}
        >
          <input
            type="checkbox"
            checked={encryptUploads === "on"}
            disabled={!active}
            onChange={(event) => setEncryptUploads(event.target.checked ? "on" : "off")}
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
          />
          <span>
            <span className="block text-[13px] font-medium">Encrypt new uploads</span>
            <span className="muted block text-[12.5px]">
              {active
                ? "New uploads and new versions are encrypted in this browser before they are sent."
                : "No key active — generate or unlock a key first. Uploads stay plaintext until then."}
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
