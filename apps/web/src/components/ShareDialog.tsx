import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, Trash2 } from "lucide-react";
import type { ShareLinkDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { Modal } from "./Modal";
import { useToast } from "./Toasts";
import type { DriveItem } from "../lib/drive";
import { deriveKek, unwrapDek, wrapDek } from "@omnicloud/crypto";
import { getUrk } from "../lib/crypto-session";
import { useNameIndex } from "../hooks/useNameIndex";
import { base64ToBytes, bytesToBase64, hexToBytes } from "../lib/bytes";

interface ShareDialogProps {
  item: DriveItem;
  onClose: () => void;
  onChanged: () => void;
}

export function ShareDialog({ item, onClose, onChanged }: ShareDialogProps) {
  const toast = useToast();
  const nameIndex = useNameIndex();
  const [shares, setShares] = useState<ShareLinkDTO[]>([]);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState("");
  const [days, setDays] = useState("7");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.shares
      .list()
      .then((result) => {
        if (!cancelled) setShares(result.shares);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const existing = useMemo(
    () =>
      shares.filter(
        (share) =>
          share.revokedAt === null &&
          (item.kind === "file" ? share.fileId === item.id : share.folderId === item.id),
      ),
    [shares, item.id, item.kind],
  );

  async function encryptedShareKey(): Promise<{
    sharedWrappedKey: string;
    fragment: string;
  } | null> {
    if (!item.file?.encryptionFormat) return null;
    if (item.file.encryptionFormat === "OCE2") {
      throw new Error("OCE2 files cannot be shared yet");
    }
    const urk = getUrk();
    const entry = nameIndex.entries.get(item.id);
    if (urk === null || entry?.cryptoFileId === undefined || entry.cryptoVersionId === undefined) {
      throw new Error("Unlock the drive and wait for the index before sharing an encrypted file");
    }
    if (item.file.wrappedKey === null || item.file.wrappedKey === undefined) {
      throw new Error("This file has no wrapped key");
    }
    const keyEpoch = item.file.keyEpoch ?? 0;
    const ctx = {
      fileId: hexToBytes(entry.cryptoFileId),
      versionId: hexToBytes(entry.cryptoVersionId),
      keyEpoch,
    };
    const dek = unwrapDek(deriveKek(urk), base64ToBytes(item.file.wrappedKey), ctx, keyEpoch);
    const secret = new Uint8Array(32);
    crypto.getRandomValues(secret);
    const sharedWrappedKey = bytesToBase64(wrapDek(deriveKek(secret), dek, ctx));
    return {
      sharedWrappedKey,
      fragment: `#k=${encodeURIComponent(bytesToBase64(secret))}`,
    };
  }

  async function create(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const keyMaterial = item.kind === "file" ? await encryptedShareKey() : null;
      const expiresAt =
        days === "never"
          ? undefined
          : new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000).toISOString();
      const max = maxDownloads.trim() === "" ? null : Number(maxDownloads);
      const result = await api.shares.create(
        item.kind === "file" ? { fileId: item.id } : { folderId: item.id },
        {
          ...(expiresAt ? { expiresAt } : {}),
          ...(max !== null ? { maxDownloads: max } : {}),
          ...(password.trim() !== "" ? { password: password.trim() } : {}),
          ...(keyMaterial !== null ? { sharedWrappedKey: keyMaterial.sharedWrappedKey } : {}),
        },
      );
      const url = `${window.location.origin}/s/${result.token}${keyMaterial?.fragment ?? ""}`;
      setLink(url);
      setShares((await api.shares.list()).shares);
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure, "Could not create the link"));
    } finally {
      setCreating(false);
    }
  }

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the link");
    }
  }

  async function revoke(id: string): Promise<void> {
    try {
      await api.shares.revoke(id);
      onChanged();
      toast.success("Link revoked");
    } catch (failure) {
      toast.error(errorMessage(failure, "Could not revoke the link"));
    }
  }

  return (
    <Modal title={`Share “${item.name}”`} onClose={onClose}>
      <div className="grid gap-4">
        <p className="muted text-sm">
          Anyone with the link can download this file. The link is not listed publicly.
        </p>

        {item.file?.encryptionFormat === "OCE2" ? (
          <p className="notice notice-error" role="alert">
            OCE2 files cannot be shared: the link cannot carry a hidden name safely.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Expires
                <select
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                >
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="never">Never</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Download limit
                <input
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2"
                  inputMode="numeric"
                  placeholder="Unlimited"
                  value={maxDownloads}
                  onChange={(event) => setMaxDownloads(event.target.value)}
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              Password
              <input
                className="w-full rounded-lg border border-line bg-surface px-3 py-2"
                type="password"
                autoComplete="new-password"
                placeholder="Optional"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {item.kind === "folder" ? (
              <p className="muted text-[12px]">
                Folder links include active subfolders. Encrypted files are listed but stay locked
                until the per-file key transfer is implemented.
              </p>
            ) : null}

            {error !== null ? (
              <p role="alert" className="notice notice-error">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              className="btn-gold"
              onClick={() => void create()}
              disabled={creating}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {creating ? "Creating…" : "Create link"}
            </button>
          </>
        )}

        {link !== null ? (
          <div className="rounded-xl border border-line bg-bg-soft p-3">
            <p className="muted mb-2 text-xs font-semibold uppercase tracking-wide">Share link</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-xs">{link}</code>
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => void copy(link)}
              >
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : null}

        {existing.length > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-semibold">Active links</p>
            {existing.map((share) => (
              <div
                key={share.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <span className="muted min-w-0 break-words">
                  {share.downloadCount}
                  {share.maxDownloads !== null ? ` / ${share.maxDownloads}` : ""} downloads
                  {share.hasPassword ? " · password" : ""}
                  {share.expiresAt
                    ? ` · expires ${new Date(share.expiresAt).toLocaleDateString()}`
                    : ""}
                </span>
                <button
                  type="button"
                  className="btn-danger shrink-0 px-2 py-1 text-xs"
                  onClick={() => void revoke(share.id)}
                >
                  <Trash2 className="mr-1 inline h-4 w-4" aria-hidden="true" />
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
