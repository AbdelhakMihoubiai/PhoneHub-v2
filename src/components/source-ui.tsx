import type { Confidence, FieldValue } from "@/lib/types";

export function ConfidenceBadge({ status }: { status: Confidence }) {
  const label: Record<Confidence, string> = {
    official: "Official",
    verified: "Verified",
    multiple_sources: "Multiple sources",
    estimated: "Estimated",
    user_submitted: "User submitted",
    unavailable: "Not available",
  };
  return <span className={`badge badge-${status}`}>{label[status]}</span>;
}

function fmt(v: unknown): string {
  if (v == null) return "Not available";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export function FieldRow({ field }: { field: FieldValue }) {
  const missing =
    field.value == null || field.status === "unavailable";
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-[var(--color-border)]/40 last:border-0">
      <div className="text-sm text-slate-400">{labelize(field.field)}</div>
      <div className="text-right">
        {missing ? (
          <span className="text-sm text-slate-500 italic">Not available</span>
        ) : (
          <span className="text-sm font-medium">
            {fmt(field.value)}
            {field.unit ? <span className="text-slate-400 ml-1">{field.unit}</span> : null}
          </span>
        )}
        {!missing && (
          <div className="mt-1 flex items-center justify-end gap-2 flex-wrap">
            <ConfidenceBadge status={field.status} />
            {field.source && (
              <a
                href={field.sourceUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-500 hover:text-[var(--color-accent)] underline decoration-dotted"
                title={field.note}
              >
                {field.source} ↗
              </a>
            )}
            {field.retrievedAt && (
              <span className="text-[11px] text-slate-600">
                {new Date(field.retrievedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  "display.sizeInches": "Display size",
  "display.resolution": "Resolution",
  "display.technology": "Display technology",
  "display.refreshRate": "Refresh rate",
  "performance.chipset": "Chipset",
  "performance.cpu": "CPU",
  "performance.gpu": "GPU",
  "memory.ram": "RAM",
  "memory.storage": "Storage",
  "memory.internal": "Internal options",
  "battery.capacity": "Battery capacity",
  "battery.charging": "Charging",
  "battery.description": "Battery type",
  "camera.main": "Main camera",
  "camera.front": "Front camera",
  "camera.features": "Camera features",
  "camera.video": "Video recording",
  "body.weight": "Weight",
  "body.dimensions": "Dimensions",
  "software.os": "Operating system",
  "general.brand": "Brand",
  "general.model": "Model",
  "general.description": "Description",
  "release.date": "Release date",
  "release.status": "Availability",
  "network.technology": "Network",
  "connectivity.sim": "SIM",
  "connectivity.wifi": "Wi-Fi",
  "connectivity.bluetooth": "Bluetooth",
  "connectivity.gps": "Positioning",
  "connectivity.nfc": "NFC",
  "connectivity.usb": "USB",
  "features.sensors": "Sensors",
};

export function labelize(path: string): string {
  if (LABELS[path]) return LABELS[path];
  return path
    .split(".")
    .slice(-1)[0]
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bId\b/, "ID");
}

/** Requirement #16: per-phone data source panel. */
export function SourcePanel({
  sources,
}: {
  sources: Array<{ label: string; kind: string; url?: string | null; updatedAt?: string | null }>;
}) {
  return (
    <section className="card p-5 mt-8">
      <h3 className="font-semibold mb-3">Data Sources</h3>
      <ul className="space-y-2.5 text-sm">
        {sources.length === 0 && (
          <li className="text-slate-500">No live sources used yet.</li>
        )}
        {sources.map((s) => (
          <li key={s.kind + s.label} className="flex items-center gap-3 flex-wrap">
            <span className="w-28 text-slate-400">{s.kind}</span>
            <span className="text-emerald-400">✓</span>
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--color-accent)] underline decoration-dotted">
                {s.label}
              </a>
            ) : (
              <span>{s.label}</span>
            )}
            {s.updatedAt && (
              <span className="ml-auto text-xs text-slate-600">
                Updated {new Date(s.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
