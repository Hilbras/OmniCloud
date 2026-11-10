# Desktop platform checklist

Manual checks for the Electron app, per operating system. Automated coverage is
listed first so the manual list stays short.

## Automated

| Area                     | Test                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| Window state persistence | `apps/desktop/test/window-state.test.ts` (bounds validation/fallback)          |
| Deep links               | `apps/desktop/test/deep-link.test.ts` (`omnicloud://drive`, `/file/<id>`)      |
| Upload notifications     | `apps/web/test/notifications.test.ts`                                          |
| Folder upload paths      | `apps/web/test/folder-upload.test.ts`                                          |
| Drag-to-move logic       | `apps/web/test/drag-move.test.ts`                                              |
| Reduced motion           | `prefers-reduced-motion` honoured in every `motion/react` component and in CSS |

## Linux (`.deb`, AppImage)

- [ ] First launch shows the setup wizard; completing it opens the drive.
- [ ] Closing the window keeps the app in the tray; double-click restores it.
- [ ] Tray → Upload files… opens the picker and the upload finishes while the
      window is hidden.
- [ ] Tray → Open in Browser opens the same account.
- [ ] Move/resize the window, quit, relaunch: size, position and maximized state
      are restored.
- [ ] `omnicloud://drive` and `omnicloud://file/<id>` open the app (after the
      desktop entry is installed).
- [ ] Launch at login toggles on/off and survives a reboot.
- [ ] An upload completes/fails while the window is hidden and raises an OS
      notification.
- [ ] Window controls (minimize, maximize, close) work in the custom title bar;
      no native title bar is shown.
- [ ] Drag a file from the desktop onto the drive: it uploads to the open folder.

## macOS (`.dmg`, `.zip`)

- [ ] Unsigned build: Gatekeeper warning is expected; the signed/notarized build
      opens without it.
- [ ] Traffic-light controls are in the native position; the header does not
      overlap them.
- [ ] Dock icon shows the OmniCloud logo, not the default Electron icon.
- [ ] Closing the window hides it; the app stays in the menu bar/tray.
- [ ] `omnicloud://file/<id>` opens the file's details.
- [ ] Launch at login uses the login-item API and appears in System Settings.

## Windows (NSIS `.exe`)

- [ ] Installer creates a desktop/start-menu shortcut and the app icon is correct.
- [ ] Minimize/maximize/close work in the custom title bar; the window can be
      resized from every edge.
- [ ] Closing hides to the tray; the tray menu restores and quits.
- [ ] `omnicloud://file/<id>` opens the app after installation.
- [ ] Launch at login writes a startup entry and can be turned off.
- [ ] Notifications appear in the Action Center while the window is hidden.

## Known gaps

- EXIF stripping is not implemented; uploads keep the original metadata.
- The full accessibility audit (focus order across every dialog, contrast
  measurements) has not been completed. Reduced motion and dialog focus traps
  are implemented.
- The real auto-update path needs two published releases and signed installers
  to verify end to end; see the signing notes in
  [`deployment.md`](deployment.md).
