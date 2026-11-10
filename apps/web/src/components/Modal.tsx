import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Generic dialog in the house style: blurred backdrop, glass panel with a
 * subtle scale/fade entrance and a close button top-right. Overlay click and
 * Escape close it; focus moves to the first control unless a child already has
 * it, Tab cycles inside the dialog, and focus returns to the trigger on close.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = (): HTMLElement[] => {
      if (panel === null) return [];
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
    };

    if (panel !== null && !panel.contains(document.activeElement)) {
      const first = focusable()[0];
      (first ?? panel).focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || panel === null) return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={
          reduceMotion
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 420, damping: 32, mass: 0.7 }
        }
        className="glass-strong w-full max-w-md rounded-2xl border border-line p-6 outline-none"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-[15px] font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="muted grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-bg-soft hover:text-gold-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
