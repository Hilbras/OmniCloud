import { useState } from "react";
import { ArrowRight, Loader2, Server } from "lucide-react";
import { normalizeServerUrl, setNativeSessionToken, setServerUrl } from "../lib/api-base";

/**
 * First screen in the native apps: the bundle carries the UI, but the drive
 * needs an OmniCloud server. The origin is stored locally and used for every
 * API call; changing it later signs the app out of the previous server.
 */
export function NativeServerSetup() {
  const [value, setValue] = useState("https://");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const normalized = normalizeServerUrl(value);
    if (normalized === null) {
      setError("Enter a full http:// or https:// address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${normalized}/api/auth/mode`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setServerUrl(normalized);
      setNativeSessionToken(null);
      window.location.reload();
    } catch {
      setError("Could not reach an OmniCloud server at that address.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-lg"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/brand/logo-mark.svg" alt="" className="brand-mark-dark h-9 w-9" />
          <img src="/brand/logo-mark-light.svg" alt="" className="brand-mark-light h-9 w-9" />
          <span className="text-[15px] font-semibold tracking-tight">
            Omni<span className="muted font-normal">Cloud</span>
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.03em]">Connect to your server</h1>
        <p className="muted mt-1.5 text-sm">
          This app bundles the drive; your files live on the OmniCloud server you run.
        </p>
        <label htmlFor="server-url" className="mt-5 grid gap-1.5">
          <span className="text-[13px] font-medium">Server address</span>
          <span className="relative">
            <Server
              className="muted pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="server-url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              className="w-full rounded-lg border border-line bg-bg-soft py-2 pe-3 ps-9"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://cloud.example.com"
            />
          </span>
        </label>
        {error !== null ? (
          <p role="alert" className="notice notice-error mt-3">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-gold mt-4 w-full justify-center" disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          )}
          {busy ? "Checking…" : "Continue"}
        </button>
        <p className="muted mt-4 text-[11px]">
          Use https:// for a real server. http:// only works on a trusted local network.
        </p>
      </form>
    </div>
  );
}
