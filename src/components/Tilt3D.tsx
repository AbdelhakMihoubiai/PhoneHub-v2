"use client";

import { useRef, type ReactNode } from "react";

/** 3D tilt-on-hover wrapper (pointer + touch), springs back on leave. */
export default function Tilt3D({
  children,
  max = 14,
  className = "",
}: {
  children: ReactNode;
  max?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);

  function onMove(e: React.PointerEvent) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.transition = "transform 60ms linear";
      el.style.transform = `perspective(900px) rotateY(${px * max}deg) rotateX(${-py * max}deg) translateZ(6px)`;
      const glare = el.querySelector<HTMLElement>("[data-glare]");
      if (glare) {
        glare.style.opacity = "0.5";
        glare.style.background = `radial-gradient(420px circle at ${((px + 0.5) * 100).toFixed(1)}% ${((py + 0.5) * 100).toFixed(1)}%, rgba(255,255,255,.28), transparent 55%)`;
      }
    });
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "transform .55s cubic-bezier(.2,.65,.3,1.2)";
    el.style.transform = "perspective(900px) rotateY(0) rotateX(0)";
    const glare = el.querySelector<HTMLElement>("[data-glare]");
    if (glare) glare.style.opacity = "0";
  }

  return (
    <div
      ref={ref}
      className={`relative will-change-transform ${className}`}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{ transformStyle: "preserve-3d" }}
    >
      {children}
      <div
        data-glare
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300"
      />
    </div>
  );
}
