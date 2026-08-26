"use client";

import { useCallback, useEffect, useState } from "react";

interface ProviderRow {
  key: string; label: string; enabled: boolean; priority: number;
  rate_limit_per_min: number; api_key_env: string | null;
  live_configured: boolean; last_error: string | null; fail_count: number;
}
type ProviderPatch = Partial<Pick<ProviderRow, "enabled" | "priority" | "rate_limit_per_min">> & { api_key_env?: string | null };
interface LogRow { provider_key: string; query: string; ok: number; error: string | null; at: string }
interface ConflictRow {
  id: number; phone: string; entity: string; key: string;
  value_a: string | null; source_a: string | null;
  value_b: string | null; source_b: string | null; created_at: string;
}

export default function AdminPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/providers");
    const data = await res.json();
    setProviders(
      ((data.providers ?? []) as Array<ProviderRow & { enabled: number | boolean }>).map(
        (p) => ({ ...p, enabled: !!p.enabled })
      )
    );
    setLogs(data.logs ?? []);
    setConflicts(data.conflicts ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateProvider(p: ProviderRow, patch: ProviderPatch) {
    await fetch("/api/admin/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: p.key, ...patch }),
    });
    void load();
  }

  async function refreshAll() {
    setMsg("Refreshing all phones — querying providers…");
    const res = await fetch("/api/phones/refresh", { method: "POST" });
    const data = await res.json();
    setMsg(
      data.ok
        ? `Refreshed ${data.refreshed.length} phone(s)${data.failed?.length ? `, ${data.failed.length} failed` : ""}.`
        : `Refresh failed: ${data.error}`
    );
    void load();
  }

  async function importFile(form: HTMLFormElement) {
    setMsg("Importing dataset…");
    const fd = new FormData(form);
    const res = await fetch("/api/import", { method: "POST", body: fd });
    const data = await res.json();
    setMsg(res.ok ? `Imported ${data.records} records as "${data.file}".` : `Import failed: ${data.error}`);
    form.reset();
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Admin · Source Management</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure providers, review failures and conflicts. API keys are read from
            environment variables only — never stored or exposed here.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => void refreshAll()}>⟳ Refresh all phones</button>
      </div>

      {msg && (
        <p className="text-sm text-sky-300 bg-sky-950/30 border border-sky-900/50 rounded-xl px-4 py-3">{msg}</p>
      )}

      {/* Providers */}
      <section className="card p-5">
        <h2 className="font-semibold mb-4">Data providers</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-slate-500 border-b border-[var(--color-border)]/50">
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">Enabled</th>
                <th className="py-2 pr-4 font-medium">Priority</th>
                <th className="py-2 pr-4 font-medium">Rate/min</th>
                <th className="py-2 pr-4 font-medium">Key env var</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <ProviderRowEditor key={p.key} p={p} onSave={(patch) => void updateProvider(p, patch)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Import */}
      <section className="card p-5">
        <h2 className="font-semibold mb-1">Open dataset import</h2>
        <p className="text-xs text-slate-500 mb-4">
          JSON / CSV / XML. Map external fields to the internal schema, e.g.
          <code className="mx-1 text-[var(--color-accent)]">{`{"external_name":"general.model","battery_capacity":"battery.capacity"}`}</code>
        </p>
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void importFile(e.currentTarget);
          }}
        >
          <label className="sm:col-span-2">
            <span className="block text-slate-400 mb-1">Dataset file</span>
            <input name="file" type="file" accept=".json,.csv,.xml" required className="input !py-2 file:mr-3 file:rounded-md file:border-0 file:bg-sky-500/20 file:text-sky-300 file:px-3 file:py-1" />
          </label>
          <label><span className="block text-slate-400 mb-1">Name</span><input name="name" required placeholder="MyPhoneDB 2026" className="input !py-2" /></label>
          <label><span className="block text-slate-400 mb-1">Format</span>
            <select name="format" className="input !py-2 bg-[#0b0f17]"><option value="">Auto</option><option value="json">JSON</option><option value="csv">CSV</option><option value="xml">XML</option></select>
          </label>
          <label><span className="block text-slate-400 mb-1">Record path (optional)</span><input name="recordPath" placeholder="data.devices" className="input !py-2" /></label>
          <label><span className="block text-slate-400 mb-1">Field mapping (JSON)</span><input name="mapping" placeholder='{"external_name":"general.model"}' className="input !py-2" /></label>
          <label><span className="block text-slate-400 mb-1">Model field</span><input name="nameField" defaultValue="model" className="input !py-2" /></label>
          <label><span className="block text-slate-400 mb-1">Brand field</span><input name="brandField" defaultValue="brand" className="input !py-2" /></label>
          <div className="sm:col-span-2"><button className="btn btn-primary w-full justify-center">Import dataset</button></div>
        </form>
      </section>

      {/* Conflicts */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3">Source conflicts</h2>
        {conflicts.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No conflicting values recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {conflicts.map((c) => (
              <li key={c.id} className="border border-[var(--color-border)]/40 rounded-lg p-3">
                <div className="font-medium">{c.phone} · {c.key}</div>
                <div className="text-xs text-slate-400 mt-1">
                  A: <code>{c.value_a}</code> ({c.source_a}) vs B: <code>{c.value_b}</code> ({c.source_b})
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Logs */}
      <section className="card p-5">
        <h2 className="font-semibold mb-3">Recent provider requests</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No requests yet.</p>
        ) : (
          <ul className="space-y-1.5 text-xs font-mono text-slate-400 max-h-72 overflow-auto">
            {logs.map((l, i) => (
              <li key={i}>
                <span className={l.ok ? "text-emerald-400" : "text-red-400"}>{l.ok ? "OK " : "ERR"}</span>{" "}
                [{l.provider_key}] {l.query} {l.error ? `— ${l.error}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProviderRowEditor({
  p,
  onSave,
}: {
  p: ProviderRow;
  onSave: (patch: Partial<ProviderRow>) => Promise<void> | void;
}) {
  const [priority, setPriority] = useState(String(p.priority));
  const [rate, setRate] = useState(String(p.rate_limit_per_min));
  const [env, setEnv] = useState(p.api_key_env ?? "");

  return (
    <tr className="border-b border-[var(--color-border)]/30 last:border-0 align-middle">
      <td className="py-2.5 pr-4">
        <div className="font-medium">{p.label}</div>
        <code className="text-[11px] text-slate-600">{p.key}</code>
      </td>
      <td className="py-2.5 pr-4">
        <button
          onClick={() => void onSave({ enabled: !p.enabled })}
          className={`badge ${p.enabled ? "badge-official" : "badge-unavailable"}`}
        >
          {p.enabled ? "Enabled" : "Disabled"}
        </button>
      </td>
      <td className="py-2.5 pr-4"><input className="input !py-1 !w-16 text-center" value={priority} onChange={(e) => setPriority(e.target.value)} onBlur={() => void onSave({ priority: Number(priority) })} /></td>
      <td className="py-2.5 pr-4"><input className="input !py-1 !w-16 text-center" value={rate} onChange={(e) => setRate(e.target.value)} onBlur={() => void onSave({ rate_limit_per_min: Number(rate) })} /></td>
      <td className="py-2.5 pr-4"><input className="input !py-1 !w-36 font-mono text-xs" placeholder="GSMARENA_API_BASE" value={env} onChange={(e) => setEnv(e.target.value)} onBlur={() => void onSave({ api_key_env: env || null })} /></td>
      <td className="py-2.5">
        <span className={`badge ${p.live_configured ? "badge-verified" : "badge-unavailable"}`}>
          {p.live_configured ? "Active" : "Not configured"}
        </span>
        {p.fail_count > 0 && <div className="text-[11px] text-red-400 mt-1">{p.fail_count} failures</div>}
      </td>
    </tr>
  );
}
