import { useEffect, useRef, useState } from "react";
import { fetchThumbnailBlob } from "../api/download";
import { isThumbnailable, loadThumbnail } from "../lib/thumbnails";
import type { DriveItem } from "../lib/drive";

interface FileThumbProps {
  item: DriveItem;
  /** Rendered until the thumbnail is ready, or when there is none to show. */
  children: React.ReactNode;
}

/**
 * A drive card's media area.
 *
 * The thumbnail is fetched only once the card scrolls into view, so opening a
 * large drive does not download every image in it. Encrypted files are
 * decrypted in the tab exactly as the preview does; the bytes are exposed only
 * as an object URL held in a bounded cache and are never written to disk.
 * Plaintext images may come from the on-disk thumbnail cache instead.
 */
export function FileThumb({ item, children }: FileThumbProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const file = item.file;
  const thumbnailable = isThumbnailable(file);

  // Load when the card first becomes visible.
  useEffect(() => {
    if (!thumbnailable) return;
    const node = containerRef.current;
    if (node === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumbnailable]);

  // Fetch once visible.
  useEffect(() => {
    if (!visible || !thumbnailable || file === null) return;
    let cancelled = false;
    loadThumbnail(file.id, () => fetchThumbnailBlob(file.id, file))
      .then((objectUrl) => {
        if (cancelled) return;
        setUrl(objectUrl);
      })
      .catch(() => {
        // A thumbnail is a nicety: on failure the card keeps its icon.
      });
    return () => {
      cancelled = true;
    };
  }, [visible, thumbnailable, file]);

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
      {url !== null ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        children
      )}
    </div>
  );
}
