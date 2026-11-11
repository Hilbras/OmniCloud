import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Writes a static HTML shell per public route with route-specific metadata.
 *
 * The app is a SPA, so every path would otherwise serve index.html and social
 * crawlers would see the landing title on /download, /privacy and the rest.
 * Vercel serves `<route>/index.html` before applying the SPA rewrite, so each
 * route gets correct title, description, canonical, OG and Twitter tags while
 * still booting the same React bundle.
 */
const SITE = process.env.VITE_SITE_URL?.replace(/\/+$/, "") || "https://omnicloud.hilbras.com";
const dist = join(process.cwd(), "dist");

const routes = [
  {
    path: "download",
    title: "Download OmniCloud — desktop app for Linux, macOS and Windows",
    description:
      "Download the OmniCloud desktop app for Linux, macOS and Windows, or install the CLI and SDK from npm.",
  },
  {
    path: "docs",
    title: "Documentation — OmniCloud",
    description:
      "Setup, architecture, API, SDK, security, desktop and mobile documentation for OmniCloud.",
  },
  {
    path: "about",
    title: "About OmniCloud — open-source storage you control",
    description:
      "OmniCloud is open-source, self-hosted cloud storage backed by a private Telegram channel you control.",
  },
  {
    path: "privacy",
    title: "Privacy — OmniCloud",
    description:
      "What the OmniCloud website and server store, what they never collect, and which third parties are involved.",
  },
  {
    path: "terms",
    title: "Terms of use — OmniCloud",
    description:
      "The MIT licence, the warranty disclaimer and the rules for using the hosted OmniCloud site.",
  },
  {
    path: "faq",
    title: "FAQ — OmniCloud",
    description:
      "Common questions about OmniCloud: storage, pricing, encryption, clients, key recovery and mobile support.",
  },
];

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

function replaceMeta(html, pattern, replacement) {
  if (!pattern.test(html)) {
    throw new Error(`Metadata pattern not found: ${pattern}`);
  }
  return html.replace(pattern, replacement);
}

const template = await readFile(join(dist, "index.html"), "utf8");

for (const route of routes) {
  const url = `${SITE}/${route.path}`;
  const title = escapeHtml(route.title);
  const description = escapeHtml(route.description);

  let html = template;
  html = replaceMeta(html, /<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  html = replaceMeta(
    html,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${description}" />`,
  );
  html = replaceMeta(
    html,
    /<link rel="canonical" href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${url}" />`,
  );
  html = replaceMeta(
    html,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${title}" />`,
  );
  html = replaceMeta(
    html,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${description}" />`,
  );
  html = replaceMeta(
    html,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:url" content="${url}" />`,
  );
  html = replaceMeta(
    html,
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:title" content="${title}" />`,
  );
  html = replaceMeta(
    html,
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="twitter:description" content="${description}" />`,
  );

  const directory = join(dist, route.path);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), html);
  await writeFile(join(dist, `${route.path}.html`), html);
}

console.log(`route html: wrote ${routes.length} routes for ${SITE}`);
