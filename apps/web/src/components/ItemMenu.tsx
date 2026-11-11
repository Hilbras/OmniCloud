import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Ellipsis } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface ItemMenuProps {
  /** Accessible name for the trigger button and the menu. */
  label: string;
  items: MenuItem[];
  /** Override the trigger icon (defaults to the "⋯" ellipsis). */
  trigger?: ReactNode;
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
  /** Horizontal alignment of the panel relative to the trigger. */
  align?: "start" | "end";
}

/**
 * Per-item "⋯" dropdown in the house menu style. Closes on item selection,
 * Escape (returning focus to the trigger), and pointer-downs outside.
 */
export function ItemMenu({
  label,
  items,
  trigger,
  triggerClassName,
  align = "end",
}: ItemMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        menuRef.current?.contains(event.target) === true ||
        triggerRef.current?.contains(event.target) === true
      ) {
        return;
      }
      setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  // Position against the viewport, not the card: an absolute menu was clipped by
  // the scrolling list and by rows stacked below it. Flip above when the bottom
  // would overflow.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (trigger === null || menu === null) return;
    const rect = trigger.getBoundingClientRect();
    const width = menu.offsetWidth || 192;
    const height = menu.offsetHeight || 260;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(
        align === "end" ? rect.right - width : rect.left,
        window.innerWidth - width - margin,
      ),
    );
    const below = rect.bottom + 6;
    const top =
      below + height <= window.innerHeight - margin
        ? below
        : Math.max(margin, rect.top - height - 6);
    setPosition({ left, top });
  }, [open, align, items.length]);

  const focusMenuItem = (index: number) => {
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']");
    buttons?.[index]?.focus();
  };

  const moveFocus = (current: HTMLElement, offset: number) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    if (buttons.length === 0) return;
    const index = buttons.indexOf(current as HTMLButtonElement);
    const nextIndex = (index + offset + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  const menuShift = reduceMotion ? 0 : -6;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (open) {
              focusMenuItem(0);
            } else {
              setOpen(true);
              window.requestAnimationFrame(() => focusMenuItem(0));
            }
          }
        }}
        className={
          triggerClassName ??
          "muted grid h-8 w-8 place-items-center rounded-lg hover:bg-bg-soft hover:text-gold-text"
        }
      >
        {trigger ?? <Ellipsis className="h-4 w-4" aria-hidden="true" />}
      </button>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={menuRef}
              key="item-menu"
              role="menu"
              aria-label={label}
              initial={{ opacity: 0, y: menuShift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: menuShift }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
                visibility: position === null ? "hidden" : "visible",
              }}
              className="menu-panel fixed z-[120] w-48"
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  disabled={item.disabled === true}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveFocus(event.currentTarget, 1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveFocus(event.currentTarget, -1);
                    }
                  }}
                  className={`menu-item text-left ${item.danger === true ? "menu-item-danger" : ""}`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
