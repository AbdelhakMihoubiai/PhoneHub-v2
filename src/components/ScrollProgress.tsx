"use client";

import { useEffect } from "react";

/** Thin gradient progress bar tied to page scroll. */
export default function ScrollProgress() {
  useEffect(() => {
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0;
      document.getElementById("scroll-progress")?.style.setProperty("--progress", `${pct}%`);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return <div id="scroll-progress" aria-hidden="true" />;
}
