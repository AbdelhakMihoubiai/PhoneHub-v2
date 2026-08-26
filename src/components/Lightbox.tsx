"use client";

import { useCallback, useEffect } from "react";
import Image from "next/image";

/** Fullscreen image viewer with prev/next + keyboard navigation. */
export default function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: Array<{ url: string; title: string }>;
  index: number | null;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const open = index !== null && index >= 0 && index < images.length;

  const prev = useCallback(() => {
    if (index === null) return;
    onNavigate((index - 1 + images.length) % images.length);
  }, [index, images.length, onNavigate]);

  const next = useCallback(() => {
    if (index === null) return;
    onNavigate((index + 1) % images.length);
  }, [index, images.length, onNavigate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, prev, next]);

  if (!open || index === null) return null;
  const img = images[index];

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={img.title}
      onClick={onClose}
    >
      {/* close */}
      <button
        onClick={onClose}
        aria-label="Close viewer"
        className="absolute top-4 right-4 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white text-xl flex items-center justify-center transition-colors"
      >
        ✕
      </button>

      {/* counter */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 text-sm text-slate-300 bg-white/10 rounded-full px-4 py-1.5">
        {index + 1} / {images.length} · {img.title}
      </div>

      {/* prev / next */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="Previous image"
            className="absolute left-3 sm:left-6 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 text-white text-2xl flex items-center justify-center transition-all hover:scale-110"
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="Next image"
            className="absolute right-3 sm:right-6 z-10 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 text-white text-2xl flex items-center justify-center transition-all hover:scale-110"
          >
            ›
          </button>
        </>
      )}

      {/* image */}
      <div
        className="max-w-[92vw] max-h-[86vh] animate-[lbIn_.25s_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={img.url}
          alt={img.title}
          width={1600}
          height={1600}
          className="max-w-[92vw] max-h-[86vh] w-auto h-auto object-contain rounded-xl shadow-2xl"
          unoptimized
          priority
        />
      </div>

      {/* thumbnail strip */}
      {images.length > 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 max-w-[92vw] overflow-x-auto p-2 bg-white/5 rounded-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((t, i) => (
            <button
              key={i}
              onClick={() => onNavigate(i)}
              aria-label={`View image ${i + 1}`}
              className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                i === index ? "border-sky-400 scale-110" : "border-transparent opacity-50 hover:opacity-100"
              }`}
            >
              <Image src={t.url} alt="" width={48} height={48} className="w-full h-full object-cover" unoptimized loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <style jsx global>{`
        @keyframes lbIn {
          from { opacity: 0; transform: scale(.94); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
