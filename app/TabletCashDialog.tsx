"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";

export function TabletCashDialog({ title, wide = false, busy = false, onClose, children }: { title: string; wide?: boolean; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose), blocked = useRef(busy);
  useEffect(() => { close.current = onClose; blocked.current = busy; });
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = root.current!;
    const focusable = () => [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length);
    (node.querySelector<HTMLElement>('input:not(:disabled)') || focusable()[0] || node).focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !blocked.current) { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const fields = focusable(), first = fields[0], last = fields.at(-1);
      if (!first) { event.preventDefault(); node.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    node.addEventListener("keydown", keyboard);
    return () => { node.removeEventListener("keydown", keyboard); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  return <div className="tc-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={root} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`tc-dialog ${wide ? "tc-dialog-wide" : ""}`}>
      <div className="tc-dialog-title"><div><small>CLUBIQ LEDGER</small><h2>{title}</h2></div><button aria-label="Fenster schließen" disabled={busy} onClick={onClose}><IconX size={22}/></button></div>
      {children}
    </section>
  </div>;
}
