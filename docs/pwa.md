# Installable PWA

The web app ships a manifest, a service worker and an offline fallback. It can
be installed from Chrome/Edge (desktop and Android) and added to the Home Screen
on iOS.

## Files

| File                               | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `public/manifest.webmanifest`      | Name, icons, start URL (`/drive`), standalone display         |
| `public/sw.js`                     | App-shell precache, static cache, offline navigation fallback |
| `public/offline.html`              | Self-contained offline page (no build assets)                 |
| `public/icons/*`                   | 192/512 any + maskable icons                                  |
| `src/lib/pwa.ts`                   | Registration, `beforeinstallprompt` capture, install state    |
| `src/components/InstallPrompt.tsx` | Bottom-left install card                                      |

## Behaviour

- The worker is registered only in production builds, after `load`.
- Navigations are network-first; the cached `index.html` (then `offline.html`)
  is served when the network fails.
- Static assets under `/assets/`, `/icons/`, `/brand/` and font/image files are
  cache-first and refreshed on later visits.
- API requests are never cached: `/api/` is skipped entirely.
- The install card appears only when the browser fires
  `beforeinstallprompt`, is hidden in standalone mode, and stays dismissed after
  “Not now” (localStorage `omnicloud.install.dismissed`).
- The drive's own IndexedDB caches (listing, thumbnails, offline copies) still
  apply, so the installed app shows the last listing offline.

## Manual checks

Desktop (Chrome/Edge):

- [ ] Install icon appears in the address bar; installing opens `/drive` in its
      own window.
- [ ] DevTools → Application → Manifest shows name, icons, start URL with no
      errors.
- [ ] DevTools → Application → Service Workers shows `sw.js` activated.
- [ ] Offline mode: reload a drive route → cached shell or `offline.html`; the
      last listing still renders with the offline banner.

Android (Chrome):

- [ ] “Add to Home screen” uses the 192/512 and maskable icons.
- [ ] Launching from the icon shows no browser chrome.
- [ ] Airplane mode opens the shell and the cached listing.

iOS (Safari):

- [ ] Share → Add to Home Screen uses the apple-touch icon and title OmniCloud.
- [ ] Launching shows the app without Safari chrome.
- [ ] Offline launch shows the cached shell (iOS ignores the install prompt).

## Limits

- iOS has no `beforeinstallprompt`; the install card cannot appear there.
- A new deployment keeps the old worker until the next navigation; there is no
  “update available” banner yet.
- Web Share Target (sending files from the OS into OmniCloud) is not implemented.
