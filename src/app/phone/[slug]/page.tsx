import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import db from "@/lib/db";
import { getPhoneByIdOrSlug } from "@/lib/aggregator";
import { FieldRow, ConfidenceBadge, SourcePanel, labelize } from "@/components/source-ui";
import RefreshButton from "@/components/RefreshButton";
import Reveal from "@/components/Reveal";
import Tilt3D from "@/components/Tilt3D";
import PhoneViewer3D from "@/components/PhoneViewer3D";
import GalleryGrid from "@/components/GalleryGrid";

export const dynamic = "force-dynamic";

interface PriceRow {
  id: number; variant: string | null; price: number | null; currency: string | null;
  country: string | null; retailer: string | null; url: string | null;
  status: string; retrieved_at: string;
}
interface MediaRow {
  id: number; kind: "news" | "review" | "gallery" | "model3d";
  title: string; url: string | null; image_url: string | null;
}
interface BenchCard {
  name: string;
  version?: string;
  score?: number | null;
  detail?: string;
  source?: string;
  sourceUrl?: string;
}

const NS_ICONS: Record<string, string> = {
  general: "📱", display: "🖥️", performance: "⚡", memory: "💾",
  battery: "🔋", camera: "📷", body: "📐", software: "🧩",
  release: "📅", connectivity: "📡", network: "📶", features: "🧠",
};

const TEST_ICONS: Record<string, string> = {
  Energy: "⚡", Battery: "🔋", "Free fall": "📱", Repairability: "🔧",
};

export default async function PhonePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const phone = getPhoneByIdOrSlug(decodeURIComponent(slug));
  if (!phone) notFound();

  const pid = phone.id;
  const F = (p: string) => phone.fields[p]?.value;
  const prices = db.prepare("SELECT * FROM prices WHERE phone_id = ?").all(pid) as PriceRow[];
  const media = db.prepare("SELECT id, kind, title, url, image_url FROM media WHERE phone_id = ?").all(pid) as MediaRow[];
  const history = db.prepare(
    "SELECT entity, key, old_value, new_value, source, retrieved_at FROM update_history WHERE phone_id = ? ORDER BY id DESC LIMIT 25"
  ).all(pid) as Array<{ entity: string; key: string; old_value: string | null; new_value: string | null; source: string | null; retrieved_at: string }>;

  // Group fields by top-level namespace (gsma.* excluded — rendered in the
  // full specification sheet below, not as curated cards)
  const groups = new Map<string, string[]>();
  for (const path of Object.keys(phone.fields)) {
    if (path.startsWith("gsma.")) continue;
    const ns = path.split(".")[0];
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns)!.push(path);
  }
  const NS_LABELS: Record<string, string> = {
    general: "Overview", display: "Display", performance: "Performance",
    memory: "Memory & Storage", battery: "Battery", camera: "Cameras",
    body: "Body & Design", software: "Software", release: "Release", connectivity: "Connectivity",
    network: "Network", features: "Features",
  };
  const order = ["general", "display", "performance", "memory", "battery", "camera", "body", "software", "release", "connectivity", "network", "features"];

  // Hero highlight chips
  const highlights: Array<[string, string | undefined, string | undefined]> = [
    ["Display", fmtShort(F("display.sizeInches"), "in") ?? F("display.resolution"), F("display.sizeInches") ? `${F("display.sizeInches")} in` : undefined],
    ["Camera", F("camera.main") != null ? `${F("camera.main")} MP` : undefined, F("camera.video") ? String(F("camera.video")).slice(0, 24) : undefined],
    ["RAM", F("memory.ram") != null ? `${F("memory.ram")} GB` : undefined, F("memory.internal") ? String(F("memory.internal")).slice(0, 28) : undefined],
    ["Battery", F("battery.capacity") != null ? `${F("battery.capacity")} mAh` : undefined, F("battery.charging") ? String(F("battery.charging")).slice(0, 24) : undefined],
    ["Chipset", F("performance.chipset") ? String(F("performance.chipset")) : undefined, F("performance.gpu")],
    ["OS", F("software.os") ? String(F("software.os")) : undefined, F("release.date") ? `Released ${F("release.date")}` : undefined],
  ].filter((h): h is [string, string | undefined, string | undefined] => Boolean(h[1]));

  // Collect unique sources for the source panel (requirement #16)
  const sourceMap = new Map<string, { label: string; kind: string; url?: string; updatedAt?: string }>();
  for (const f of Object.values(phone.fields)) {
    if (f.source && !sourceMap.has(f.source))
      sourceMap.set(f.source, { label: f.source, kind: "Specifications", url: f.sourceUrl ?? undefined, updatedAt: f.retrievedAt });
  }
  for (const p of prices)
    if (p.retailer && !sourceMap.has(p.retailer))
      sourceMap.set(p.retailer, { label: p.retailer, kind: "Price", url: p.url ?? undefined, updatedAt: p.retrieved_at });

  const colors = phone.variants.flatMap((v) => v.colors ?? []);
  const memCombos = phone.variants
    .filter((v) => v.ramGb || v.storageGb)
    .map((v) => `${v.ramGb ?? "?"}GB RAM / ${v.storageGb ?? "?"}GB`)
    .slice(0, 8);
  const news = media.filter((m) => m.kind === "news").slice(0, 6);
  const reviews = media.filter((m) => m.kind === "review").slice(0, 6);
  const gallery = media.filter((m) => m.kind === "gallery").slice(0, 24);
  const model3d = media.filter((m) => m.kind === "model3d");

  // Full GSMArena spec sheet rows grouped by section
  const gsmaEntries = Object.keys(phone.fields).filter((p) => p.startsWith("gsma."));
  const gsmaSections = new Map<string, Array<{ label: string; path: string }>>();
  for (const path of gsmaEntries) {
    const [, section, label] = path.split(".");
    if (!gsmaSections.has(section)) gsmaSections.set(section, []);
    gsmaSections.get(section)!.push({ label: label.replace(/_/g, " "), path });
  }

  // Real test data (GSMArena EU label): battery endurance, energy class,
  // free-fall, repairability.
  const tests = (gsmaSections.get("EU_LABEL") ?? []).map(({ label, path }) => ({
    label,
    value: String(phone.fields[path]?.value ?? ""),
    source: phone.fields[path]?.source,
    sourceUrl: phone.fields[path]?.sourceUrl,
  }));

  // 🏁 Benchmarks — parsed from GSMArena's "Our Tests" section (real
  // measurements: AnTuTu, GeekBench, GFXBench, display brightness,
  // loudspeaker, battery endurance). One entry per card, never estimated.
  const ourTests = gsmaSections.get("Our_Tests") ?? [];
  const sourceUrl = ourTests[0] ? phone.fields[ourTests[0].path]?.sourceUrl ?? undefined : undefined;
  const benchmarks = parseOurTests(ourTests, phone.fields, sourceUrl);

  return (
    <div>
      <Link href="/" className="text-sm text-slate-400 hover:text-white inline-flex items-center gap-1 min-h-[44px]">← Search</Link>

      {/* Hero */}
      <Reveal>
        <section className="card mt-4 p-5 sm:p-7 hero-glow relative overflow-hidden">
          <div className="orb orb-a" aria-hidden="true" />
          <div className="orb orb-b" aria-hidden="true" />
          <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start relative">
            <Tilt3D className="w-40 shrink-0 rounded-2xl">
              <div className="card w-40 h-40 flex items-center justify-center overflow-hidden bg-black/25 !rounded-2xl">
                {phone.imageUrl ? (
                  <Image src={phone.imageUrl} alt={phone.model} width={160} height={160} className="object-contain" unoptimized priority />
                ) : (
                  <span className="text-6xl opacity-25" aria-hidden="true">📱</span>
                )}
              </div>
            </Tilt3D>
            <div className="flex-1 text-center sm:text-left min-w-0">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight break-words">
                {phone.brand} {phone.model}
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {Object.keys(phone.fields).length} sourced fields · last updated{" "}
                {new Date(phone.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
              {colors.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 justify-center sm:justify-start">
                  {colors.slice(0, 8).map((c) => (
                    <span key={c} className="badge badge-user_submitted !normal-case">{c}</span>
                  ))}
                </div>
              )}
              {memCombos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 justify-center sm:justify-start">
                  {memCombos.map((c) => (
                    <span key={c} className="badge badge-multiple_sources !normal-case">{c}</span>
                  ))}
                </div>
              )}
              <div className="mt-4 flex gap-2 justify-center sm:justify-start flex-wrap">
                <RefreshButton id={String(phone.id)} />
                <a href={`/api/phones/${phone.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                  JSON ↗
                </a>
              </div>
            </div>
          </div>

          {/* Highlight chips */}
          {highlights.length > 0 && (
            <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 relative">
              {highlights.map(([label, main, sub], i) => (
                <Tilt3D key={label} max={10} className="chip-tilt">
                  <div className="chip" style={{ transitionDelay: `${i * 40}ms` }}>
                    <span>{label}</span>
                    <b title={main}>{main}</b>
                    {sub && <span title={sub}>{sub}</span>}
                  </div>
                </Tilt3D>
              ))}
            </div>
          )}
        </section>
      </Reveal>

      {/* Interactive 3D viewer */}
      <Reveal>
        <PhoneViewer3D
          imageUrl={phone.imageUrl}
          name={`${phone.brand} ${phone.model}`}
          colors={colors}
          model3d={model3d.map((m3) => ({ title: m3.title, url: m3.url ?? "" }))}
        />
      </Reveal>

      {/* Binkies 3D embed — exact GSMArena integration (scripts + helpers) */}
      {model3d.length > 0 && (() => {
        const integration = model3d[0].url?.match(/^binkies:\/\/([^/]+)\//)?.[1];
        if (!integration) return null;
        const base = "https://embed.binkies3d.com/integrations";
        return (
          <>
            <script src={`${base}/${integration}/yiy0yc1z/script.js`} />
            <script
              type="text/javascript"
              src={`${base}/v2/${integration}/rkg0i20p/script.js`}
              async
              referrerPolicy="no-referrer-when-downgrade"
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `
function swatchClicked(target){
  var selected = document.querySelector(".binkies-color-swatch.selected");
  if (selected !== null) selected.classList.remove("selected");
  target.classList.add("selected");
}
function load3D(){
  var selected = document.querySelector("#binkies-container-waiting-on-click");
  if (selected !== null) selected.id = "binkies-container";
}`,
              }}
            />
          </>
        );
      })()}

      {/* Spec sections */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[...groups.entries()]
          .sort((a, b) => (order.indexOf(a[0]) ?? 99) - (order.indexOf(b[0]) ?? 99))
          .map(([ns, items], gi) => (
            <Reveal key={ns} delay={Math.min(gi * 60, 240)}>
              <section className="card p-5 h-full">
                <h2 className="font-semibold mb-3 flex items-center gap-2">
                  <span aria-hidden="true">{NS_ICONS[ns] ?? "•"}</span> {NS_LABELS[ns] ?? labelize(ns)}
                </h2>
                {items.map((path) => (
                  <FieldRow key={path} field={{ ...phone.fields[path], field: path }} />
                ))}
              </section>
            </Reveal>
          ))}
      </div>

      {/* 🏁 Benchmarks — rendered exactly ONCE */}
      <BenchmarksSection benchmarks={benchmarks} />

      {/* Full specification sheet (every captured row) */}
      {gsmaSections.size > 0 && (
        <Reveal>
          <details className="card p-5 mt-6">
            <summary className="font-semibold cursor-pointer min-h-[44px] leading-[2.2rem]">
              📋 Full specification sheet <span className="text-xs text-slate-500 font-normal">({gsmaEntries.length} rows · GSMArena)</span>
            </summary>
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
              {[...gsmaSections.entries()].map(([section, rows]) => (
                <section key={section} className="card p-4 h-full">
                  <h3 className="font-semibold text-sm mb-2 text-sky-300">{section.replace(/_/g, " ")}</h3>
                  {rows.map(({ label, path }) => {
                    const fld = phone.fields[path];
                    return (
                      <div key={path} className="flex items-baseline justify-between gap-4 py-1.5 border-b border-[var(--color-border)]/30 last:border-0">
                        <span className="text-xs text-slate-400 shrink-0">{label}</span>
                        <span className="text-xs text-right leading-relaxed">{String(fld.value ?? "")}</span>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-600">
              Source: <a href={phone.fields[gsmaEntries[0]]?.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-sky-400">GSMArena specification page ↗</a> · all rows captured live, none omitted.
            </p>
          </details>
        </Reveal>
      )}

      <TestsSection tests={tests} />
      <PricesSection rows={prices} />
      <GalleryGrid images={gallery.map((g) => ({ url: g.image_url ?? "", title: g.title }))} />
      <MediaSection title="📰 In the news" rows={news} emptyText="No related news captured yet." />
      <MediaSection title="📝 Reviews" rows={reviews} emptyText="No editorial reviews captured yet." />

      <Reveal>
        <SourcePanel sources={[...sourceMap.values()]} />
      </Reveal>

      {history.length > 0 && (
        <details className="card p-5 mt-6">
          <summary className="font-semibold cursor-pointer min-h-[44px] leading-[2.2rem]">
            Update history ({history.length})
          </summary>
          <ul className="mt-3 space-y-1.5 text-xs text-slate-400">
            {history.map((h, i) => (
              <li key={i}>
                <span className="text-slate-300">{h.key}</span> → {truncate(h.new_value)}{" "}
                <span className="text-slate-600">· {h.source ?? "unknown"} · {new Date(h.retrieved_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Parse GSMArena's "Our Tests" rows into benchmark cards.
 * Performance value example:
 *   "AnTuTu: 298328 (v8) | GeekBench: 6779 (v4.4), 1690 (v5.1) | GFXBench: 18fps (ES 3.1 onscreen)"
 * Other rows (Display / Loudspeaker / Battery) are measured results like
 *   "657 nits max brightness (measured)" / "-28.6 LUFS (Average)".
 */
function parseOurTests(
  rows: Array<{ label: string; path: string }>,
  fields: Record<string, { value: unknown; source?: string; sourceUrl?: string }>,
  fallbackSourceUrl?: string
): BenchCard[] {
  const cards: BenchCard[] = [];

  for (const { label, path } of rows) {
    const fld = fields[path];
    if (!fld) continue;
    const value = String(fld.value ?? "").trim();
    if (!value || /photo\s*\/\s*video/i.test(value)) continue; // camera link row — no numbers

    if (label === "Performance") {
      for (const part of value.split("|")) {
        const seg = part.trim();
        const colon = seg.indexOf(":");
        if (colon < 0) continue;
        const benchName = seg.slice(0, colon).trim();
        const rest = seg.slice(colon + 1).trim();
        // rest may contain multiple scores: "6779 (v4.4), 1690 (v5.1)"
        for (const sub of rest.split(/,(?![^(]*\))/)) {
          const s = sub.trim();
          if (!s) continue;
          const num = s.match(/-?\d[\d.,]*/);
          if (!num) continue;
          const ver = s.match(/\((v[^)]+)\)/i)?.[1];
          const detail = s.replace(/\((v[^)]+)\)/i, "").replace(num[0], "").replace(/^[\s.fps]+/, "").trim();
          cards.push({
            name: benchName,
            version: ver,
            score: Number(num[0].replace(/,/g, "")),
            detail: detail || undefined,
            source: "GSMArena",
            sourceUrl: fallbackSourceUrl,
          });
        }
      }
    } else {
      // Measured single-value rows → one card each
      const pretty =
        label === "Battery" || label === "Battery old"
          ? "Battery endurance"
          : label === "Display"
            ? "Display brightness"
            : label;
      const num = value.match(/-?\d[\d.,]*/);
      cards.push({
        name: pretty,
        score: num ? Number(num[0].replace(/,/g, "")) : null,
        detail: value,
        source: "GSMArena",
        sourceUrl: fallbackSourceUrl,
      });
    }
  }

  // dedupe (name+version+score)
  const seen = new Set<string>();
  return cards.filter((c) => {
    const k = `${c.name}|${c.version ?? ""}|${c.score ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fmtShort(v: unknown, unit: string): string | undefined {
  if (v == null) return undefined;
  return `${v} ${unit}`;
}

function truncate(s: string | null): string {
  if (!s) return "—";
  try {
    return String(JSON.parse(s));
  } catch {
    return s.slice(0, 60);
  }
}

function BenchmarksSection({ benchmarks }: { benchmarks: BenchCard[] }) {
  // Requirement #12: render only real sourced measurements — no placeholders,
  // and the section appears exactly once.
  if (benchmarks.length === 0) return null;
  return (
    <Reveal>
      <section className="card p-5 mt-6">
        <h2 className="font-semibold mb-1">🏁 Benchmarks</h2>
        <p className="text-xs text-slate-500 mb-4">
          Real measured scores from GSMArena&apos;s &quot;Our Tests&quot; — verified data, never estimated.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {benchmarks.map((b, i) => (
            <Tilt3D key={`${b.name}-${b.version ?? ""}-${i}`} max={8}>
              <div className="chip !items-start h-full">
                <span className="flex items-center justify-between w-full gap-2">
                  <span className="font-semibold text-sky-300">{b.name}</span>
                  {b.version && <span className="text-[10px] text-slate-500">{b.version}</span>}
                </span>
                {b.score != null && <b className="!whitespace-normal text-lg tabular-nums">{b.score.toLocaleString()}</b>}
                {b.detail && <span className="!whitespace-normal text-[10px] leading-snug">{b.detail}</span>}
                <span className="text-[10px] text-slate-600">
                  {b.sourceUrl ? (
                    <a href={b.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-sky-400">
                      {b.source} ↗
                    </a>
                  ) : (b.source ?? "")}
                </span>
              </div>
            </Tilt3D>
          ))}
        </div>
      </section>
    </Reveal>
  );
}

function MediaSection({ title, rows, emptyText }: { title: string; rows: MediaRow[]; emptyText: string }) {
  return (
    <Reveal>
      <section className="card p-5 mt-6">
        <h2 className="font-semibold mb-3">{title}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 italic">{emptyText}</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rows.map((mItem) => (
              <li key={mItem.id}>
                <a
                  href={mItem.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 items-start p-2.5 rounded-xl hover:bg-white/5 transition-colors min-h-[72px]"
                >
                  {mItem.image_url ? (
                    <Image src={mItem.image_url} alt="" width={96} height={64} className="rounded-lg object-cover w-24 h-16 shrink-0 bg-black/25" unoptimized loading="lazy" />
                  ) : (
                    <span className="w-24 h-16 shrink-0 rounded-lg bg-black/25 flex items-center justify-center text-xl opacity-40" aria-hidden="true">📄</span>
                  )}
                  <span className="text-sm leading-snug self-center">{mItem.title}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Reveal>
  );
}

function TestsSection({
  tests,
}: {
  tests: Array<{ label: string; value: string; source?: string; sourceUrl?: string }>;
}) {
  if (tests.length === 0) return null;
  return (
    <Reveal>
      <section className="card p-5 mt-6">
        <h2 className="font-semibold mb-1">🧪 Tests &amp; endurance ratings</h2>
        <p className="text-xs text-slate-500 mb-4">
          Measured results from the EU energy label and GSMArena&apos;s test data — real
          measurements, not estimates.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {tests.map((t) => (
            <div key={t.label} className="chip !items-start">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true">{TEST_ICONS[t.label] ?? "🧪"}</span> {t.label}
              </span>
              <b className="!whitespace-normal leading-snug">{t.value}</b>
            </div>
          ))}
        </div>
        {tests[0]?.sourceUrl && (
          <p className="mt-3 text-[11px] text-slate-600">
            Source:{" "}
            <a href={tests[0].sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-sky-400">
              GSMArena test data ↗
            </a>
          </p>
        )}
      </section>
    </Reveal>
  );
}

function PricesSection({ rows }: { rows: PriceRow[] }) {
  return (
    <Reveal>
      <section className="card p-5 mt-6">
        <h2 className="font-semibold mb-3">💰 Prices</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 italic">Price unavailable.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-4 flex-wrap text-sm border-b border-[var(--color-border)]/30 pb-3 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <span className="font-medium">{p.variant ?? "Standard"}</span>
                  <span className="text-slate-500 ml-2">{p.retailer}{p.country ? ` (${p.country})` : ""}</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-emerald-300">
                    {p.price != null ? `${p.currency ?? ""}${p.price.toLocaleString()}` : "Price unavailable"}
                  </span>
                  <span className="text-xs text-slate-600">Updated {new Date(p.retrieved_at).toLocaleDateString()}</span>
                  <ConfidenceBadge status={p.status as never} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Reveal>
  );
}
