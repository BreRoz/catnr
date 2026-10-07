"use client";
import { createContext, useCallback, useContext, useEffect, useId, useRef, type ReactNode } from "react";

// Open dialogs, innermost last. Only the innermost one reacts to Escape and Tab, so a sheet opened over
// another sheet closes alone instead of taking its parent with it.
const stack: Array<{ id: string; el: HTMLElement; requestClose: () => void }> = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const DirtyContext = createContext<(dirty: boolean) => void>(() => {});
/** Forms call this with true while they hold changes that haven't been saved. */
export const useReportDirty = () => useContext(DirtyContext);

export const DISCARD_PROMPT = "Discard what you’ve typed? It hasn’t been saved.";
export const confirmDiscard = () => typeof window === "undefined" || window.confirm(DISCARD_PROMPT);

type SheetProps = { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; className?: string; footer?: boolean };

/**
 * A modal bottom sheet: labelled for screen readers, keeps keyboard focus inside, closes on Escape, gives
 * focus back to whatever opened it, and asks before throwing away unsaved typing.
 */
export function Sheet({ title, eyebrow, onClose, children, className = "recSheet", footer = true }: SheetProps) {
  const ref = useRef<HTMLElement>(null);
  const dirty = useRef(false);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  const requestClose = useCallback(() => { if (dirty.current && !confirmDiscard()) return; onCloseRef.current(); }, []);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    const entry = { id: titleId, el, requestClose };
    stack.push(entry);
    if (!el.contains(document.activeElement)) (el.querySelector<HTMLElement>("[data-autofocus]") ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== entry) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); requestClose(); return; }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(entry), 1);
      if (opener?.isConnected) opener.focus();
    };
  }, [requestClose, titleId]);

  return (
    <div className="sheetBackdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <DirtyContext.Provider value={setDirty}>
        <section ref={ref} tabIndex={-1} className={`sheet ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="handle" aria-hidden="true" />
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
          {children}
          {footer && <button type="button" className="close" onClick={requestClose}>Close</button>}
        </section>
      </DirtyContext.Provider>
    </div>
  );
}

/** Drop inside a Sheet to mark it as holding unsaved typing while `when` is true. */
export function DirtyWhen({ when }: { when: boolean }) {
  const report = useReportDirty();
  useEffect(() => { report(when); return () => report(false); }, [when, report]);
  return null;
}
