import { Capacitor } from "@capacitor/core";

/**
 * Native-shell behaviour for the web build. No-ops in a regular browser, so the
 * same bundle runs on the site and inside the Capacitor apps.
 */
export function initNative(): void {
  if (!Capacitor.isNativePlatform()) return;

  void (async () => {
    const [{ App }, { Browser }] = await Promise.all([
      import("@capacitor/app"),
      import("@capacitor/browser"),
    ]);

    void App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    });

    const url = new URL(window.location.href);
    window.localStorage.setItem("omnicloud.native", "1");

    // External http(s) links open in the system browser; in-app anchors keep
    // SPA navigation.
    document.addEventListener(
      "click",
      (event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const anchor = (event.target as Element | null)?.closest?.("a");
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const href = anchor.getAttribute("href");
        if (href === null) return;
        let target: URL;
        try {
          target = new URL(href, window.location.href);
        } catch {
          return;
        }
        if (target.protocol !== "https:" && target.protocol !== "http:") return;
        if (target.host === url.host) return;
        event.preventDefault();
        void Browser.open({ url: target.toString() });
      },
      true,
    );
  })();
}
