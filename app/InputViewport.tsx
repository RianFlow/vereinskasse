"use client";

import { useEffect } from "react";

// Use the area above the on-screen keyboard, including browsers which only
// resize the visual viewport. These measurements never change focus or input.
export function InputViewport() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = viewport?.height ?? window.innerHeight;
        const active = document.activeElement;
        const typing = active instanceof HTMLElement && active.matches("input:not([type=checkbox]):not([type=radio]),textarea,[contenteditable=true]");
        root.style.setProperty("--input-viewport-height", `${height}px`);
        root.style.setProperty("--input-viewport-top", `${viewport?.offsetTop ?? 0}px`);
        root.toggleAttribute("data-input-compact", height <= 500);
        // Keep the search layout stable while a result is being tapped. A
        // button receives focus before its click and must not move underneath it.
        if (height > 500) root.removeAttribute("data-input-catalog");
        else if (typing) root.toggleAttribute("data-input-catalog", !!active.closest(".tc5-catalog-heading"));
      });
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      root.removeAttribute("data-input-compact");
      root.removeAttribute("data-input-catalog");
      root.style.removeProperty("--input-viewport-height");
      root.style.removeProperty("--input-viewport-top");
    };
  }, []);
  return null;
}
