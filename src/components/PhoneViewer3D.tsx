"use client";

import { useEffect, useRef, useState } from "react";
import Tilt3D from "./Tilt3D";

/**
 * Interactive 3D phone viewer.
 *
 * Official Binkies 3D model: replicates GSMArena's integration exactly.
 * The <script> tags + swatchClicked()/load3D() are rendered server-side on
 * the phone page; this component renders the exact container/swatch DOM and
 * calls load3D() when the user activates it.
 *
 * The CSS-3D drag phone always works as a fallback.
 */
export default function PhoneViewer3D({
  imageUrl,
  name,
  colors,
  model3d,
}: {
  imageUrl: string | null;
  name: string;
  colors: string[];
  model3d: Array<{ title: string; url: string }>;
}) {
  const [tint, setTint] = useState(0);
  const [activated, setActivated] = useState(false);
  const binkies = parseBinkies(model3d);

  // Soft-navigation safety net: if the SSR <script> tags didn't run during a
  // client-side route change, inject them here (same srcs, same attributes).
  useEffect(() => {
    if (!binkies) return;
    if (typeof (window as unknown as { swatchClicked?: unknown }).swatchClicked === "function") return;
    const base = "https://embed.binkies3d.com/integrations";
    const s1 = document.createElement("script");
    s1.src = `${base}/${binkies.integration}/yiy0yc1z/script.js`;
    const s2 = document.createElement("script");
    s2.type = "text/javascript";
    s2.src = `${base}/v2/${binkies.integration}/rkg0i20p/script.js`;
    s2.async = true;
    s2.referrerPolicy = "no-referrer-when-downgrade";
    document.body.append(s1, s2);
  }, [binkies]);

  if (!imageUrl) return null;

  const hue = colors.length > 0 ? (tint * 360) / Math.max(colors.length, 3) : 0;

  return (
    <section className="card p-5 mt-6 overflow-hidden relative">
      <div className="orb orb-a" aria-hidden="true" />
      <h2 className="font-semibold mb-4 relative">🧊 3D view</h2>

      {/* Top row: CSS-3D phone + colorway controls */}
      <div className="flex flex-col lg:flex-row items-center gap-8">
        <Phone3D imageUrl={imageUrl} name={name} hue={hue} />

        <div className="flex-1 w-full">
          {/* Custom colorway chips only before the official model takes over */}
          {colors.length > 0 && !activated && (
            <>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Colorways</div>
              <div className="flex flex-wrap gap-2 mb-5">
                {colors.map((c, i) => (
                  <button
                    key={c}
                    onClick={() => setTint(i)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 ${
                      i === tint
                        ? "border-sky-400 text-sky-300 bg-sky-400/10 scale-105 shadow-[0_0_18px_rgba(56,189,248,.25)]"
                        : "border-[var(--color-border)] text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}

          {binkies && !activated && (
            <button
              className="btn btn-primary w-full sm:w-auto"
              onClick={() => {
                setActivated(true);
                // GSMArena's load3D(): rename the container so the Binkies
                // loader (already watching the DOM) mounts the canvas.
                setTimeout(() => {
                  (window as unknown as { load3D?: () => void }).load3D?.();
                }, 80);
              }}
            >
              ⚡ Load official interactive 3D model
            </button>
          )}

          {!binkies && (
            <p className="text-sm text-slate-500 leading-relaxed">
              Drag the phone to rotate it. This device has no official interactive
              3D model — the render above is generated locally from the official
              product image.
            </p>
          )}

          <p className="mt-4 text-[11px] text-slate-600">
            Drag the phone to rotate · renders locally from the official product image
            {binkies ? " · official interactive 3D model available" : ""}
          </p>
        </div>
      </div>

      {/* Official Binkies 3D stage — full width below once activated */}
      {binkies && (
        <div
          id={activated ? "binkies-container" : "binkies-container-waiting-on-click"}
          className={
            activated
              ? "mt-6 w-full"
              : "absolute -left-[9999px] top-0 w-[640px] h-[420px] opacity-0 pointer-events-none overflow-hidden"
          }
        >
          <div id="binkies-content" />
          <div id="binkies-color-switcher">
            {binkies.swatches.map((sw, i) => (
              <div
                key={sw.id}
                className={`binkies-color-swatch${i === 0 ? " selected" : ""}`}
                data-binkies-content-id={sw.id}
                onClick={(e) => {
                  (window as unknown as { swatchClicked?: (t: HTMLElement) => void }).swatchClicked?.(
                    e.currentTarget
                  );
                }}
              >
                {sw.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {activated && (
        <p className="mt-3 text-[11px] text-slate-600">
          Official interactive 3D by Binkies 3D — drag the model to rotate, use the
          color swatches to switch finish. If no canvas appears, the model is
          restricted to GSMArena&apos;s domain — the phone on the left always works.
        </p>
      )}
    </section>
  );
}

function parseBinkies(entries: Array<{ title: string; url: string }>): { integration: string; swatches: Array<{ id: string; label: string }> } | null {
  if (entries.length === 0) return null;
  const m = entries[0].url.match(/^binkies:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return {
    integration: m[1],
    swatches: entries.map((e) => ({ id: e.url.replace(/^binkies:\/\/[^/]+\//, ""), label: e.title })),
  };
}

/** Pure CSS-3D phone: drag rotates (Y/X axes), idle float animation, glare. */
function Phone3D({ imageUrl, name, hue }: { imageUrl: string; name: string; hue: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ rotY: -18, rotX: 6, dragging: false, lastX: 0, lastY: 0, auto: true });
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const s = state.current;
      if (s.auto && !s.dragging) s.rotY += 0.25;
      if (ref.current) {
        ref.current.style.transform = `rotateX(${s.rotX}deg) rotateY(${s.rotY}deg)`;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    state.current.dragging = true;
    state.current.auto = false;
    state.current.lastX = e.clientX;
    state.current.lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const s = state.current;
    if (!s.dragging) return;
    s.rotY += (e.clientX - s.lastX) * 0.5;
    s.rotX = Math.max(-40, Math.min(40, s.rotX - (e.clientY - s.lastY) * 0.3));
    s.lastX = e.clientX;
    s.lastY = e.clientY;
  }
  function onPointerUp() {
    state.current.dragging = false;
    setTimeout(() => (state.current.auto = true), 2500);
  }

  return (
    <div className="scene select-none touch-none" style={{ perspective: "1100px" }}>
      <div
        ref={ref}
        className="phone3d cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label={`Interactive 3D view of ${name}`}
      >
        <div className="phone-frame">
          <img src={imageUrl} alt={name} className="phone-screen" draggable={false} />
          <div className="phone-glare" />
        </div>
        <div className="side-btn left-[-3px] top-[92px] h-10" />
        <div className="side-btn left-[-3px] top-[140px] h-14" />
        <div className="side-btn right-[-3px] top-[110px] h-16" />
      </div>
      <div className="phone-shadow" />
      <style jsx>{`
        .phone3d {
          width: 190px;
          height: 390px;
          transform-style: preserve-3d;
          position: relative;
          animation: floaty 5s ease-in-out infinite;
          filter: hue-rotate(${hue}deg) saturate(1.05);
          transition: filter .5s ease;
        }
        .phone-frame {
          position: absolute;
          inset: 0;
          border-radius: 34px;
          border: 3px solid rgba(148, 163, 184, 0.45);
          background: #0a0f1a;
          box-shadow:
            inset 0 0 22px rgba(0, 0, 0, 0.85),
            0 30px 60px -18px rgba(56, 189, 248, 0.28),
            0 12px 30px rgba(0, 0, 0, 0.6);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .phone-screen {
          width: 100%;
          height: 100%;
          object-fit: cover;
          user-select: none;
          pointer-events: none;
        }
        .phone-glare {
          position: absolute;
          inset: 0;
          background: linear-gradient(115deg, rgba(255,255,255,.22) 0%, transparent 28%, transparent 72%, rgba(255,255,255,.08) 100%);
          pointer-events: none;
        }
        .side-btn {
          position: absolute;
          width: 4px;
          border-radius: 3px;
          background: linear-gradient(180deg, #64748b, #334155);
          transform: translateZ(-4px);
        }
        .phone-shadow {
          width: 170px;
          height: 26px;
          margin: 18px auto 0;
          border-radius: 50%;
          background: radial-gradient(closest-side, rgba(56,189,248,.30), transparent);
          filter: blur(6px);
          animation: shadowPulse 5s ease-in-out infinite;
        }
        @keyframes floaty {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes shadowPulse {
          0%, 100% { transform: scaleX(1); opacity: .9; }
          50% { transform: scaleX(.82); opacity: .55; }
        }
        @media (prefers-reduced-motion: reduce) {
          .phone3d { animation: none; }
          .phone-shadow { animation: none; }
        }
      `}</style>
    </div>
  );
}
