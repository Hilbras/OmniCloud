/**
 * Native OS notification for background upload results.
 *
 * Permission is requested from a user gesture (enqueue), and notifications are
 * only shown after the user has allowed them. In Electron this uses the OS
 * notification centre; in a browser it uses the Web Notifications API.
 */
export function requestNotificationPermission(): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    // Notifications are optional.
  }
}

export function notify(title: string, body: string, tag?: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const notification = new Notification(title, {
      body,
      tag,
      icon: "/brand/logo-512.png",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some platforms throw when the app is not allowed to notify.
  }
}
