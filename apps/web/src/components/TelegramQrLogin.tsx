import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, errorMessage } from "../api/client";
import type { QrPollResponse, QrStartResponse, QrToken } from "../api/client";

const POLL_INTERVAL_MS = 2_000;

interface TelegramQrLoginProps {
  onSignedIn: () => Promise<void> | void;
  onPasswordRequired: (flowId: string) => void;
  /**
   * "qr" shows the scannable code. "app" opens the same `tg://login` token in
   * the Telegram app installed on this device (no camera needed).
   */
  mode?: "qr" | "app";
  /** Offered in app mode when Telegram is not installed. */
  onUseQr?: () => void;
}

function TelegramMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M21.94 4.31a1.5 1.5 0 0 0-1.53-.25L3.4 11.02c-.55.21-.9.73-.89 1.32.01.59.38 1.1.94 1.28l4.1 1.34 1.52 4.88c.17.54.64.92 1.2.98.57.06 1.1-.22 1.36-.72l2.02-3.83 4.6 3.38c.28.2.6.3.93.3.2 0 .4-.04.6-.12.5-.23.83-.7.88-1.24l1.81-12.8a1.5 1.5 0 0 0-.53-1.4ZM9.4 14.4l-.6 3.1-1.1-3.55 8.4-5.2-6.7 5.65Z" />
    </svg>
  );
}

const TELEGRAM_BLUE = "#229ED9";

/**
 * Shows a QR code for the Telegram app to approve. Polls until the phone
 * approves, then hands control back to the page to finish sign-in.
 */
export function TelegramQrLogin({
  onSignedIn,
  onPasswordRequired,
  mode = "qr",
  onUseQr,
}: TelegramQrLoginProps) {
  const [flow, setFlow] = useState<QrStartResponse | null>(null);
  const [token, setToken] = useState<QrToken | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [expired, setExpired] = useState(false);
  const approvedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.auth
      .startQrLogin()
      .then((started) => {
        if (cancelled) return;
        setFlow(started);
        setToken(started.token);
      })
      .catch((startError: unknown) => {
        if (!cancelled) setError(errorMessage(startError, "Could not start Telegram sign-in"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (token === null || mode === "app") return;
    let cancelled = false;
    QRCode.toDataURL(token.url, { margin: 1, width: 240 })
      .then((dataUrl) => {
        if (!cancelled) setImage(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setError("Could not draw the QR code. Use the phone form below.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, mode]);

  useEffect(() => {
    if (flow === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled || approvedRef.current) return;
      try {
        const result: QrPollResponse = await api.auth.pollQrLogin(flow.flowId);
        if (cancelled) return;
        if (result.status === "ok") {
          approvedRef.current = true;
          setFinishing(true);
          await onSignedIn();
          return;
        }
        if (result.status === "password_required") {
          onPasswordRequired(flow.flowId);
          return;
        }
        if (result.status === "expired") {
          setFlow(null);
          setToken(null);
          setImage(null);
          setExpired(true);
          return;
        }
        setToken(result.token);
      } catch (pollError) {
        if (!cancelled) {
          setError(errorMessage(pollError, "Telegram is reconnecting. Retrying shortly."));
          timer = setTimeout(() => {
            setError(null);
            void tick();
          }, POLL_INTERVAL_MS * 2);
        }
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [flow, onSignedIn, onPasswordRequired]);

  const restart = () => {
    approvedRef.current = false;
    setError(null);
    setImage(null);
    setFlow(null);
    setToken(null);
    setExpired(false);
    api.auth
      .startQrLogin()
      .then((started) => {
        setFlow(started);
        setToken(started.token);
      })
      .catch((startError: unknown) =>
        setError(errorMessage(startError, "Could not start Telegram sign-in")),
      );
  };

  if (mode === "app") {
    return (
      <section aria-labelledby="app-login-heading" className="grid gap-3">
        <div>
          <h2 id="app-login-heading" className="text-base font-semibold">
            Connect with Telegram
          </h2>
          <p className="muted mt-1 text-sm">
            Send the login request to the Telegram app installed on this device. Approve it there
            and you are in — no camera required.
          </p>
        </div>

        <div className="grid min-h-[196px] place-items-center rounded-xl border border-line bg-bg-soft/45 p-4">
          {finishing ? (
            <div role="status" className="flex items-center gap-2.5 text-sm">
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-gold-text"
                aria-hidden="true"
              />
              <span>Approved. Preparing your private storage...</span>
            </div>
          ) : expired ? (
            <div role="status" className="text-center text-sm">
              <p className="font-medium">This login request expired.</p>
              <button type="button" className="btn-secondary mt-3" onClick={restart}>
                Try again
              </button>
            </div>
          ) : (
            <div className="grid w-full max-w-xs gap-3 text-center">
              <a
                href={token?.url ?? "#"}
                aria-disabled={token === null}
                onClick={(event) => {
                  if (token === null) event.preventDefault();
                }}
                className="inline-flex items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                style={{ backgroundColor: TELEGRAM_BLUE }}
              >
                <TelegramMark />
                Open Telegram
              </a>
              <p className="muted text-xs">
                Approve the “OmniCloud” login in Telegram, then come back to this tab.
              </p>
            </div>
          )}
        </div>

        {error !== null ? (
          <div role="alert" className="notice notice-error">
            {error}{" "}
            <button type="button" className="font-semibold underline" onClick={restart}>
              Try again
            </button>
          </div>
        ) : null}

        <p className="muted text-xs">
          Telegram not installed on this device?{" "}
          {onUseQr !== undefined ? (
            <button type="button" className="font-semibold underline" onClick={onUseQr}>
              Scan the QR code instead
            </button>
          ) : (
            "Use the QR code instead."
          )}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="qr-login-heading" className="grid gap-3">
      <div>
        <h2 id="qr-login-heading" className="text-base font-semibold">
          Connect with the Telegram app
        </h2>
        <p className="muted mt-1 text-sm">
          Open Telegram on your phone, go to Settings → Devices → Link Desktop Device, and scan this
          code.
        </p>
      </div>

      <div className="flex min-h-[196px] items-center justify-center rounded-xl border border-line bg-bg-soft/45 p-2">
        {finishing ? (
          <div role="status" className="flex items-center gap-2.5 text-sm">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gold-text" aria-hidden="true" />
            <span>Approved. Preparing your private storage...</span>
          </div>
        ) : expired ? (
          <div role="status" className="text-center text-sm">
            <p className="font-medium">This QR code expired.</p>
            <button type="button" className="btn-secondary mt-3" onClick={restart}>
              Show a new code
            </button>
          </div>
        ) : image !== null ? (
          <img
            src={image}
            alt="Telegram login QR code"
            width={184}
            height={184}
            className="h-[184px] w-[184px]"
          />
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-gold-text" aria-label="Loading QR code" />
        )}
      </div>

      {error !== null ? (
        <div role="alert" className="notice notice-error">
          {error}{" "}
          <button type="button" className="font-semibold underline" onClick={restart}>
            Try again
          </button>
        </div>
      ) : null}

      {token !== null && !finishing ? (
        <p className="muted text-xs">The code refreshes automatically while you wait.</p>
      ) : null}
    </section>
  );
}
