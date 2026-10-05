"use client";

/**
 * Bottom sheet for the phone layouts (#111, #112; docs/design/MOBILE.md): a modal dialog sliding from
 * the bottom. Focus moves inside on open and back to where it was on close; Tab stays inside;
 * Escape, the backdrop and × close it; the page behind does not scroll meanwhile.
 */
import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Full height (long forms) instead of fitting the content. */
  full?: boolean;
}

export function Sheet({ open, ...props }: SheetProps) {
  return open ? <SheetPanel {...props} /> : null;
}

function SheetPanel({ title, onClose, children, full = false }: Omit<SheetProps, "open">) {
  // Read on the first render, before an autoFocus field inside takes the focus.
  const [returnTo] = useState(() => document.activeElement as HTMLElement | null);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel?.contains(document.activeElement)) (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      returnTo?.focus?.();
    };
  }, [returnTo]);

  return (
    <div className="fixed inset-0 z-60 flex flex-col justify-end">
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] flex-col rounded-t-[22px] bg-card pb-[env(safe-area-inset-bottom)] shadow-lg outline-none",
          full && "h-[92dvh]",
        )}
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-border" />
        <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </div>
  );
}
