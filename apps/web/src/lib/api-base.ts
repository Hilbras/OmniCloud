import { Capacitor } from "@capacitor/core";

const SERVER_KEY = "omnicloud.serverUrl";
const TOKEN_KEY = "omnicloud.sessionToken";

/** True inside the Capacitor iOS/Android shell. */
export function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

export function normalizeServerUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function getServerUrl(): string | null {
  try {
    return normalizeServerUrl(window.localStorage.getItem(SERVER_KEY) ?? "");
  } catch {
    return null;
  }
}

export function setServerUrl(raw: string): string | null {
  const normalized = normalizeServerUrl(raw);
  try {
    if (normalized === null) window.localStorage.removeItem(SERVER_KEY);
    else window.localStorage.setItem(SERVER_KEY, normalized);
  } catch {
    return null;
  }
  return normalized;
}

export function nativeSessionToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setNativeSessionToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ignore: the session then lasts for this page only.
  }
}

/**
 * Absolute API URL inside the native shell (bundled assets talk to the chosen
 * server). Relative on the web, where the server serves the app itself.
 */
export function apiUrl(path: string): string {
  if (!isNativeRuntime()) return path;
  const base = getServerUrl();
  if (base === null) return path;
  return new URL(path, `${base}/`).toString();
}

export function nativeAuthHeaders(): Record<string, string> {
  if (!isNativeRuntime()) return {};
  const token = nativeSessionToken();
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

export function nativeClientHeaders(): Record<string, string> {
  return isNativeRuntime() ? { "x-omnicloud-client": "native" } : {};
}
