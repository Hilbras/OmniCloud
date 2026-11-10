export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_EVENT = "omnicloud:install-available";
let deferredPrompt: BeforeInstallPromptEvent | null = null;

/** Registers the service worker and captures the install prompt once, early. */
export function initPwa(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
  });

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    });
  }
}

export function hasInstallPrompt(): boolean {
  return deferredPrompt !== null;
}

export function onInstallAvailable(listener: () => void): () => void {
  window.addEventListener(INSTALL_EVENT, listener);
  return () => window.removeEventListener(INSTALL_EVENT, listener);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (deferredPrompt === null) return "unavailable";
  const event = deferredPrompt;
  deferredPrompt = null;
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

const DISMISSED_KEY = "omnicloud.install.dismissed";

export function installDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstall(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Ignore: a blocked storage only means the prompt may return.
  }
}
