"use client";

import { useState } from "react";
import Image from "next/image";
import Lightbox from "./Lightbox";
import Reveal from "./Reveal";

interface GalleryImage {
  url: string;
  title: string;
}

/** Gallery grid with official/hands-on grouping + fullscreen lightbox. */
export default function GalleryGrid({ images }: { images: GalleryImage[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null);

  const official = images.map((img, i) => ({ ...img, i })).filter((x) => x.url.includes("/vv/pics/"));
  const handsOn = images.map((img, i) => ({ ...img, i })).filter((x) => !x.url.includes("/vv/pics/"));

  if (images.length === 0) return null;

  const grid = (items: Array<GalleryImage & { i: number }>, label: string) => (
    <>
      {items.length > 0 && (
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2 mt-1">
          {label} <span className="text-slate-600">({items.length})</span>
        </h3>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
        {items.map((img) => (
          <button
            key={img.i}
            onClick={() => setLightbox(img.i)}
            className="block aspect-square rounded-xl overflow-hidden bg-black/25 card-hover border border-[var(--color-border)]/50 group"
            title={`${img.title} — click to open full size`}
            aria-label={`Open ${img.title}`}
          >
            <Image
              src={img.url}
              alt={img.title}
              width={220}
              height={220}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
              unoptimized
              loading="lazy"
            />
          </button>
        ))}
      </div>
    </>
  );

  return (
    <Reveal>
      <section className="card p-5 mt-6">
        <h2 className="font-semibold mb-3">
          🖼️ Photo gallery <span className="text-xs text-slate-500 font-normal">({images.length} — click any photo to open full size)</span>
        </h2>
        {grid(official, "Official images")}
        {grid(handsOn, "Hands-on photos")}
        <p className="mt-1 text-[11px] text-slate-600">
          Images © GSMArena — linked, not stored. Use ← → keys inside the viewer.
        </p>

        <Lightbox
          images={images}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox(i)}
        />
      </section>
    </Reveal>
  );
}
