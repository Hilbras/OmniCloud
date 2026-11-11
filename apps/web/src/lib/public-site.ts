/**
 * True for the marketing deployment (Vercel). The public build ships landing,
 * download, docs and legal pages only; the drive/login UI belongs to a
 * self-hosted OmniCloud server or the desktop/mobile apps.
 */
export const IS_PUBLIC_SITE = import.meta.env.VITE_PUBLIC_SITE === "true";
