import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dismissInstall,
  hasInstallPrompt,
  installDismissed,
  isStandalone,
  onInstallAvailable,
  promptInstall,
} from "../lib/pwa";

/** Bottom-left install card for browsers that expose beforeinstallprompt. */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (isStandalone() || installDismissed()) return;
    const update = () => setVisible(hasInstallPrompt());
    update();
    return onInstallAvailable(update);
  }, []);

  if (!visible) return null;

  const close = () => {
    dismissInstall();
    setVisible(false);
  };

  return (
    <aside
      className="fixed bottom-4 left-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-xl"
      aria-label="Install OmniCloud"
    >
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Install OmniCloud</p>
          <p className="muted mt-1 text-[12.5px] leading-5">
            Open the drive in its own window, with an offline app shell.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className="btn-gold px-3 py-1.5 text-xs"
              disabled={installing}
              onClick={() => {
                setInstalling(true);
                void promptInstall().finally(() => {
                  setInstalling(false);
                  setVisible(false);
                });
              }}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {installing ? "Installing…" : "Install"}
            </button>
            <button type="button" className="muted text-xs hover:text-text" onClick={close}>
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          className="muted rounded p-0.5 hover:bg-bg-soft hover:text-text"
          aria-label="Dismiss install prompt"
          onClick={close}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
