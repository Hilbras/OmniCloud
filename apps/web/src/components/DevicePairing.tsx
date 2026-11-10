import { useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import { api, errorMessage } from "../api/client";
import { useToast } from "./Toasts";
import { getUrk } from "../lib/crypto-session";
import { createPairingKeyMaterial } from "../lib/key-pairing";

export function DevicePairing() {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async (): Promise<void> => {
    const urk = getUrk();
    if (urk === null) {
      toast.error("Unlock your encryption key first, then create a pairing link.");
      return;
    }
    setCreating(true);
    try {
      const material = createPairingKeyMaterial(urk);
      const pairing = await api.keyPairing.create({
        wrappedUrk: material.wrappedUrk,
        fileId: material.fileId,
        versionId: material.versionId,
        keyEpoch: material.keyEpoch,
      });
      setLink(
        `${window.location.origin}/pair/${pairing.id}#p=${encodeURIComponent(material.secretBase64)}`,
      );
      setCopied(false);
    } catch (error) {
      toast.error(errorMessage(error, "Could not create a pairing link"));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error("Could not copy the link");
    }
  };

  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <Smartphone className="h-5 w-5 text-gold-text" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Pair another device</h2>
      </div>
      <p className="muted text-sm">
        Open the link on a second device that is already signed in to this account. It transfers
        your encryption key once; the link expires in 10 minutes and the server never sees the key.
      </p>
      <button
        type="button"
        className="btn-secondary w-fit"
        onClick={() => void create()}
        disabled={creating}
      >
        {creating ? "Creating…" : "Create pairing link"}
      </button>
      {link !== null ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-bg-soft p-3">
          <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs">
            {link}
          </code>
          <button type="button" className="btn-ghost" onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
