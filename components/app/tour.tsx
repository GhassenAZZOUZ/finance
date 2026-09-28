"use client";

import { Compass, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOptionalFinance } from "./finance-provider";
import { type Box, type Side, TOUR_STEPS, placePopover, tourStorageKey } from "./tour-logic";

/** Room left around the highlighted element. */
const SPOTLIGHT_PAD = 6;
const POPOVER_WIDTH = 360;

const TourContext = createContext<{ start: () => void } | null>(null);

function readSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeSeen(key: string): void {
  try {
    localStorage.setItem(key, new Date().toISOString());
  } catch {
    // Storage blocked: the tour simply shows again next time.
  }
}

/** First visible element tagged `data-tour~="token"` (the sidebar and the mobile bars both render one). */
function findTarget(token: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour~="${token}"]`);
  for (const el of all) if (el.getClientRects().length > 0) return el;
  return null;
}

/**
 * Guided tour: opens by itself the first time a user reaches the app (per user, in this browser),
 * and again from any « Guide » button. Sits inside <FinanceProvider>.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const finance = useOptionalFinance();
  // "auto": open once the data is loaded, unless this user has already seen it.
  const [mode, setMode] = useState<"auto" | "open" | "closed">("auto");
  const key = tourStorageKey(finance?.email ?? null);
  const open = mode === "open" || (mode === "auto" && finance !== null && !readSeen(key));

  const close = useCallback(() => {
    writeSeen(key);
    setMode("closed");
  }, [key]);
  const value = useMemo(() => ({ start: () => setMode("open") }), []);

  return (
    <TourContext.Provider value={value}>
      {children}
      {open ? <TourOverlay onClose={close} /> : null}
    </TourContext.Provider>
  );
}

export function useTour(): { start: () => void } {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour must be used inside <TourProvider>");
  return value;
}

/** « Guide » button that replays the tour (sidebar and mobile account menu). */
export function TourButton({ className, onStart }: { className?: string; onStart?: () => void }) {
  const { start } = useTour();
  return (
    <button
      type="button"
      data-tour="guide"
      onClick={() => {
        onStart?.();
        start();
      }}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <Compass aria-hidden className="size-4.5" />
      Guide de l’application
    </button>
  );
}

function TourOverlay({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; side: Side } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = TOUR_STEPS[index]!;
  const last = index === TOUR_STEPS.length - 1;

  // Measure the target and place the popover before paint; again on resize and scroll.
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? findTarget(step.target) : null;
      const r = el?.getBoundingClientRect();
      const box = r
        ? { top: r.top - SPOTLIGHT_PAD, left: r.left - SPOTLIGHT_PAD, width: r.width + 2 * SPOTLIGHT_PAD, height: r.height + 2 * SPOTLIGHT_PAD }
        : null;
      const pop = popoverRef.current?.getBoundingClientRect();
      setTarget(box);
      setPosition(
        placePopover(
          box,
          { width: pop?.width ?? POPOVER_WIDTH, height: pop?.height ?? 200 },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Focus moves into the tour, and back to where it was when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    primaryRef.current?.focus();
  }, [index]);

  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose]);
  const back = () => setIndex((i) => Math.max(0, i - 1));

  // Listened on the document: the keys work even if the page grabbed the focus meanwhile.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Tab") {
        // Keep the focus inside the popover.
        const items = popoverRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (!items?.length) return;
        const first = items[0]!;
        const end = items[items.length - 1]!;
        const inside = popoverRef.current?.contains(document.activeElement) ?? false;
        if (!inside || (e.shiftKey && document.activeElement === first)) {
          e.preventDefault();
          (e.shiftKey ? end : first).focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [next, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* Dimmed backdrop with a hole around the target (the hole is the spotlight's shadow). */}
      {target ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-2 ring-primary motion-safe:transition-all motion-safe:duration-300"
          style={{ top: target.top, left: target.left, width: target.width, height: target.height }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/55" />
      )}

      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cn(
          "fixed flex w-[min(360px,calc(100vw-32px))] flex-col gap-3 rounded-2xl border bg-popover p-5 text-popover-foreground shadow-xl",
          "motion-safe:transition-[top,left] motion-safe:duration-300",
          position ? "visible" : "invisible",
        )}
        style={{ top: position?.top ?? 0, left: position?.left ?? 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium tracking-wide text-muted-foreground tabular-nums">
            Étape {index + 1} sur {TOUR_STEPS.length}
          </p>
          <button
            type="button"
            aria-label="Fermer le guide"
            onClick={onClose}
            className="-m-2 flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <h2 id={titleId} className="font-heading text-lg leading-tight font-semibold">
          {step.title}
        </h2>
        <p id={bodyId} className="text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </p>
        <div aria-hidden className="flex gap-1.5">
          {TOUR_STEPS.map((s, i) => (
            <span key={s.title} className={cn("h-1.5 flex-1 rounded-full", i <= index ? "bg-primary" : "bg-muted")} />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          {last ? (
            <span />
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Passer
            </Button>
          )}
          <div className="flex gap-2">
            {index > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={back}>
                Précédent
              </Button>
            ) : null}
            <Button ref={primaryRef} type="button" size="sm" onClick={next}>
              {index === 0 ? "Commencer" : last ? "Terminer" : "Suivant"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
