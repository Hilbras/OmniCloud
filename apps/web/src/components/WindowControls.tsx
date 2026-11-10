import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

interface WindowControlsBridge {
  omnicloudDesktop?: {
    windowControls?: {
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onStateChange: (listener: (maximized: boolean) => void) => () => void;
    };
  };
}

/**
 * App-drawn minimize/maximize/close for the frameless desktop window.
 * Hidden by CSS outside Electron and on macOS, which keeps its traffic lights.
 */
export function WindowControls() {
  const controls = (window as unknown as WindowControlsBridge).omnicloudDesktop?.windowControls;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (controls === undefined) return;
    void controls.isMaximized().then(setMaximized);
    return controls.onStateChange(setMaximized);
  }, [controls]);

  if (controls === undefined) return null;

  return (
    <div className="window-controls" aria-label="Window controls">
      <button
        type="button"
        className="window-control"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void controls.minimize()}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? "Restore window" : "Maximize window"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void controls.toggleMaximize()}
      >
        {maximized ? (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        aria-label="Close window"
        title="Close"
        onClick={() => void controls.close()}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
