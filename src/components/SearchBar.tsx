"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const EXAMPLES = [
  "iPhone 17 Pro Max",
  "Samsung Galaxy S25 Ultra",
  "Realme GT 8 Pro",
  "OnePlus 14",
  "Google Pixel",
];

const STAGES = [
  "Checking local cache…",
  "Querying specification providers…",
  "Capturing full spec sheet & media…",
  "Verifying against the web…",
];

interface Suggestion {
  name: string;
  brand: string;
  gsmSlug: string;
  image?: string;
}

export default function SearchBar() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [showSugs, setShowSugs] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [sugLoading, setSugLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem("ph-recent") ?? "[]"));
    } catch {}
  }, []);

  // Live AJAX suggestions (debounced)
  useEffect(() => {
    if (q.trim().length < 2 || loading) {
      setSugs([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSugLoading(true);
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          setSugs(data.suggestions ?? []);
          setActiveIdx(-1);
          setShowSugs(true);
        }
      } catch {
        /* aborted or offline */
      } finally {
        setSugLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, loading]);

  // close dropdown on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setShowSugs(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function remember(query: string) {
    const next = [query, ...recent.filter((r) => r !== query)].slice(0, 5);
    setRecent(next);
    try {
      localStorage.setItem("ph-recent", JSON.stringify(next));
    } catch {}
  }

  async function go(query: string, gsmSlug?: string) {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setShowSugs(false);
    setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1600);
    try {
      const params = new URLSearchParams({ q: query });
      if (gsmSlug) params.set("gsm", gsmSlug);
      const res = await fetch(`/api/phones/search?${params}`);
      const data = await res.json();
      if (res.ok && data.phone?.slug) {
        remember(query.trim());
        router.push(`/phone/${data.phone.slug}`);
      } else {
        setError(data.error ?? "No public data source could verify this phone. Try a different spelling.");
      }
    } catch {
      setError("Lookup failed — all providers are unreachable right now.");
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }

  async function goSuggestion(s: Suggestion) {
    setShowSugs(false);
    const label = `${s.brand} ${s.name}`.trim();
    setQ(label);
    await go(label, s.gsmSlug);
  }

  return (
    <div className="w-full max-w-2xl mx-auto" ref={boxRef}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void go(q);
        }}
        className="relative flex flex-col sm:flex-row gap-3"
      >
        <div className="relative flex-1">
          <input
            className="input pr-10"
            placeholder="Search any phone — e.g. Realme GT 8 Pro…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => sugs.length > 0 && setShowSugs(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowSugs(false);
              if (e.key === "ArrowDown" && sugs.length > 0) {
                e.preventDefault();
                setShowSugs(true);
                setActiveIdx((i) => (i + 1) % sugs.length);
              }
              if (e.key === "ArrowUp" && sugs.length > 0) {
                e.preventDefault();
                setActiveIdx((i) => (i <= 0 ? sugs.length - 1 : i - 1));
              }
              if (e.key === "Enter" && activeIdx >= 0 && showSugs && sugs[activeIdx]) {
                e.preventDefault();
                void goSuggestion(sugs[activeIdx]);
              }
            }}
            aria-label="Search for a phone"
            autoComplete="off"
            autoFocus
          />
          {sugLoading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-block w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          )}

          {/* Live suggestions dropdown */}
          {showSugs && sugs.length > 0 && (
            <div className="absolute z-50 left-0 right-0 mt-2" role="listbox" aria-label="Phone suggestions">
              <ul className="suggest-box max-h-[380px] overflow-y-auto overscroll-contain">
                {sugs.map((s, i) => (
                  <li key={s.gsmSlug} role="option" aria-selected={false}>
                    <button
                      type="button"
                    onClick={() => void goSuggestion(s)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`suggest-item w-full flex items-center gap-3 px-4 py-2.5 text-left min-h-[60px] ${i > 0 ? "border-t border-[var(--color-border)]/40" : ""} ${i === activeIdx ? "bg-sky-400/10" : ""}`}
                    >
                      {s.image ? (
                        <Image src={s.image} alt="" width={36} height={48} className="suggest-img w-9 h-12 object-contain shrink-0 p-0.5" unoptimized />
                      ) : (
                        <span className="suggest-img w-9 h-12 shrink-0" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-100 truncate">{s.name}</span>
                        <span className="block text-xs text-slate-500">{s.brand}</span>
                      </span>
                      <span className="text-sky-400 text-xs shrink-0" aria-hidden="true">View →</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="suggest-box !mt-px !rounded-t-none px-4 py-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>⚡ Live suggestions · GSMArena device index</span>
                <span className="text-slate-600">Esc to close</span>
              </div>
            </div>
          )}
        </div>

        <button className="btn btn-primary shrink-0" disabled={loading || !q.trim()}>
          {loading ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              Searching…
            </>
          ) : (
            "Search"
          )}
        </button>
      </form>

      {/* Loading stages */}
      {loading && (
        <div className="mt-4 card p-4 text-left" aria-live="polite">
          <ul className="space-y-2 text-sm">
            {STAGES.map((s, i) => (
              <li key={s} className={`flex items-center gap-2 ${i > stage ? "opacity-40" : ""}`}>
                {i < stage ? (
                  <span className="text-emerald-400">✓</span>
                ) : i === stage ? (
                  <span className="inline-block w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                ) : (
                  <span className="w-3 text-slate-600">○</span>
                )}
                <span className={i <= stage ? "text-slate-200" : "text-slate-500"}>{s}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-2">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
          </div>
        </div>
      )}

      {/* Recent + examples (hidden while suggestions are open) */}
      {!loading && !(showSugs && sugs.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 justify-center items-center">
          {recent.map((r) => (
            <button
              key={r}
              className="btn btn-ghost !min-h-0 !py-1.5 !px-3 text-xs !border-sky-900/60 !text-sky-300"
              onClick={() => {
                setQ(r);
                void go(r);
              }}
              disabled={loading}
            >
              ⏱ {r}
            </button>
          ))}
          {EXAMPLES.filter((e) => !recent.includes(e)).map((e) => (
            <button
              key={e}
              className="btn btn-ghost !min-h-0 !py-1.5 !px-3 text-xs"
              onClick={() => {
                setQ(e);
                void go(e);
              }}
              disabled={loading}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-5 text-sm text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded-xl px-4 py-3" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
