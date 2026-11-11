import { getServerUrl, isNativeRuntime } from "../lib/api-base";

/** Native-only server switcher shown at the bottom of the shell. */
export function NativeServerHint() {
  if (!isNativeRuntime()) return null;
  const server = getServerUrl();
  if (server === null) return null;
  let host = server;
  try {
    host = new URL(server).host;
  } catch {
    // Keep the raw value when parsing fails.
  }
  return (
    <p className="pointer-events-none fixed inset-x-0 bottom-3 z-20 text-center text-[11px] text-muted">
      Server: <span className="font-mono">{host}</span>
      <span className="pointer-events-auto">
        {" "}
        ·{" "}
        <a href="/setup-server" className="text-gold-text underline-offset-2 hover:underline">
          Change
        </a>
      </span>
    </p>
  );
}
