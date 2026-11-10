import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

function read(relative: string): string {
  return readFileSync(join(webRoot, relative), "utf8");
}

describe("PWA assets", () => {
  it("ships a complete web app manifest", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      name: string;
      start_url: string;
      display: string;
      background_color: string;
      theme_color: string;
      icons: Array<{ src: string; sizes: string; purpose?: string }>;
    };

    expect(manifest.name).toBe("OmniCloud");
    expect(manifest.start_url).toBe("/drive");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);

    const anyIcon = manifest.icons.filter((icon) => icon.purpose !== "maskable");
    const maskable = manifest.icons.filter((icon) => icon.purpose === "maskable");
    expect(anyIcon.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(maskable.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
  });

  it("links the manifest and install metadata from the document", () => {
    const html = read("index.html");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('name="application-name" content="OmniCloud"');
  });

  it("keeps API traffic out of the service worker cache and falls back offline", () => {
    const worker = read("public/sw.js");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('cache.match("/offline.html")');
    expect(worker).toContain('cache.match("/index.html")');
    expect(worker).toContain("SKIP_WAITING");
  });

  it("has a self-contained offline page", () => {
    const offline = read("public/offline.html");
    expect(offline).toContain("You are offline");
    expect(offline).toContain("location.reload()");
    expect(offline).not.toContain("/assets/");
  });
});
