import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { api, errorMessage } from "../api/client";
import { getUrk, toHex, unlockFromHex } from "../lib/crypto-session";
import { clearNameIndex, forgetLoadedIndex } from "../lib/name-index-session";
import { openPairingKeyMaterial } from "../lib/key-pairing";

interface PairPageProps {
  id: string;
}

export function PairPage({ id }: PairPageProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const secret = new URLSearchParams(window.location.hash.slice(1)).get("p");
    if (secret === null) {
      setState("error");
      setMessage("This pairing link is missing its key. Ask the other device for a new link.");
      return;
    }
    if (getUrk() !== null && !window.confirm("Replace the encryption key on this device?")) {
      navigate("/drive", { replace: true });
      return;
    }

    void api.keyPairing
      .claim(id)
      .then((payload) => {
        const urk = openPairingKeyMaterial(payload, secret);
        unlockFromHex(toHex(urk));
        clearNameIndex();
        forgetLoadedIndex();
        // Drop the fragment so a refresh cannot replay the secret.
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/drive", { replace: true });
      })
      .catch((error: unknown) => {
        setState("error");
        setMessage(errorMessage(error, "This pairing link is not available."));
      });
  }, [id, navigate]);

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-lg">
        <KeyRound className="mx-auto mb-3 h-8 w-8 text-gold-text" aria-hidden="true" />
        {state === "working" ? (
          <>
            <h1 className="text-lg font-semibold">Pairing this device</h1>
            <p className="muted mt-2 flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Decrypting the key…
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Pairing failed</h1>
            <p role="alert" className="notice notice-error mt-3 text-left">
              {message}
            </p>
            <button type="button" className="btn-secondary mt-4" onClick={() => navigate("/drive")}>
              Back to drive
            </button>
          </>
        )}
      </div>
    </main>
  );
}
