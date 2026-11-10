import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { useToast } from "./Toasts";

interface DesktopBridge {
  omnicloudDesktop?: {
    desktopSettings?: {
      getLaunchAtLogin: () => Promise<boolean>;
      setLaunchAtLogin: (enabled: boolean) => Promise<void>;
    };
  };
}

export function DesktopSettings() {
  const toast = useToast();
  const bridge = (window as unknown as DesktopBridge).omnicloudDesktop?.desktopSettings;
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (bridge === undefined) {
      setLoading(false);
      return;
    }
    void bridge
      .getLaunchAtLogin()
      .then(setEnabled)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [bridge]);

  if (bridge === undefined) return null;

  const toggle = async (): Promise<void> => {
    const next = !enabled;
    setEnabled(next);
    try {
      await bridge.setLaunchAtLogin(next);
    } catch {
      setEnabled(!next);
      toast.error("Could not change the login setting");
    }
  };

  return (
    <section className="card flex items-start justify-between gap-4 p-5">
      <div className="flex items-start gap-3">
        <Monitor className="mt-0.5 h-5 w-5 text-gold-text" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold">Launch at login</h2>
          <p className="muted text-sm">
            Start OmniCloud in the tray when you sign in to this computer.
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Launch OmniCloud at login"
        disabled={loading}
        onClick={() => void toggle()}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full border transition-colors ${
          enabled ? "border-gold bg-gold" : "border-line bg-bg-soft"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </section>
  );
}
