import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock3, RefreshCw, ScanSearch, ShieldAlert, Wrench, WifiOff } from "lucide-react";
import { api } from "../services/api";

interface HealthItem {
  configId: string; name: string; engine: string; status: "connected" | "disconnected";
  latencyMs: number; lastCheck: string; error?: string;
  replication: null | { recordsCopied: number; lagSeconds: number; status: string };
}
interface Health { overall: "ESTABLE" | "DEGRADADO" | "DESCONECTADO"; checkedAt: string; items: HealthItem[] }
interface DiagnosticIssue {
  severity: "critical" | "warning" | "info"; code: string; table?: string;
  message: string; recommendation: string;
}
interface Diagnostic {
  configId: string; status: "SALUDABLE" | "REQUIERE_AJUSTES" | "CORRUPTA";
  checkedAt: string; durationMs: number;
  summary: { tables: number; rows: number; critical: number; warnings: number; informational: number };
  issues: DiagnosticIssue[];
}

export default function HealthMonitor() {
  const [health, setHealth] = useState<Health>();
  const [loading, setLoading] = useState(true);
  const [diagnosing, setDiagnosing] = useState<string>();
  const [diagnostics, setDiagnostics] = useState<Record<string, Diagnostic>>({});
  const [expanded, setExpanded] = useState<string>();

  const refresh = useCallback(async () => {
    try { setHealth(await api<Health>("/health")); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const diagnose = async (configId: string) => {
    setDiagnosing(configId);
    try {
      const result = await api<Diagnostic>(`/health/${configId}/diagnose`, { method: "POST" });
      setDiagnostics((current) => ({ ...current, [configId]: result }));
      setExpanded(configId);
    } finally {
      setDiagnosing(undefined);
    }
  };

  const badge = health?.overall === "ESTABLE"
    ? "border-emerald-900 bg-emerald-950 text-emerald-300"
    : health?.overall === "DEGRADADO"
      ? "border-amber-900 bg-amber-950 text-amber-300"
      : "border-red-900 bg-red-950 text-red-300";

  return <div>
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div><h1 className="text-2xl font-semibold text-white">Health Monitor</h1><p className="mt-1 text-sm text-zinc-500">Disponibilidad cada 5 segundos y diagnóstico profundo bajo demanda.</p></div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${badge}`}>{health?.overall ?? "COMPROBANDO"}</span>
        <button type="button" className="btn-secondary" aria-label="Actualizar estado" title="Actualizar estado" onClick={refresh}><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
      </div>
    </div>

    <div className="mb-6 grid gap-4 md:grid-cols-3">
      <SummaryCard icon={Activity} label="Bases supervisadas" value={health?.items.length ?? 0} />
      <SummaryCard icon={ShieldAlert} label="Con incidencias" value={Object.values(diagnostics).filter((item) => item.status !== "SALUDABLE").length} />
      <SummaryCard icon={Wrench} label="Ajustes sugeridos" value={Object.values(diagnostics).reduce((total, item) => total + item.summary.warnings, 0)} />
    </div>

    {!health?.items.length ? <div className="card py-16 text-center"><WifiOff className="mx-auto mb-4 text-zinc-700" /><p className="text-zinc-500">No hay bases importadas que supervisar.</p></div> :
      <div className="grid gap-4 xl:grid-cols-2">{health.items.map((item) => {
        const diagnostic = diagnostics[item.configId];
        const isExpanded = expanded === item.configId;
        return <article key={item.configId} className="card">
          <div className="flex items-start justify-between">
            <div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${item.status === "connected" ? "bg-emerald-400" : "bg-red-500"}`} /><h2 className="font-medium text-white">{item.name}</h2></div><p className="mt-1 pl-[18px] text-xs uppercase text-zinc-600">{item.engine}</p></div>
            <div className="flex items-center gap-2 text-sm text-zinc-400"><Activity size={15} className="text-blue-400" /><span className="tabular-nums">{item.latencyMs} ms</span></div>
          </div>
          <div className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-xs text-zinc-600"><Clock3 size={14} />Última comprobación: {new Date(item.lastCheck).toLocaleTimeString()}</div>
          {item.error && <p className="mt-3 truncate text-xs text-red-400">{item.error}</p>}
          {item.replication && <div className="mt-4 grid grid-cols-2 rounded-button border border-line bg-[#0D0D0D] p-4">
            <div><div className="text-xs text-zinc-600">Registros copiados</div><div className="mt-1 font-medium tabular-nums text-zinc-200">{item.replication.recordsCopied.toLocaleString()}</div></div>
            <div><div className="text-xs text-zinc-600">Lag</div><div className="mt-1 font-medium tabular-nums text-zinc-200">{item.replication.lagSeconds}s</div></div>
          </div>}
          <div className="mt-4 flex gap-2">
            <button disabled={diagnosing === item.configId} className="btn-secondary flex flex-1 items-center justify-center gap-2" onClick={() => diagnose(item.configId)}>
              <ScanSearch size={16} />{diagnosing === item.configId ? "Analizando..." : diagnostic ? "Repetir diagnóstico" : "Diagnóstico profundo"}
            </button>
            {diagnostic && <button className="btn-secondary" aria-label="Mostrar diagnóstico" onClick={() => setExpanded(isExpanded ? undefined : item.configId)}>{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}
          </div>
          {diagnostic && isExpanded && <DiagnosticPanel diagnostic={diagnostic} />}
        </article>;
      })}</div>}
  </div>;
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: number }) {
  return <article className="card flex items-center gap-4"><div className="grid h-10 w-10 place-items-center rounded-button bg-blue-950 text-blue-400"><Icon size={19} /></div><div><p className="text-xs text-zinc-600">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-white">{value}</p></div></article>;
}

function DiagnosticPanel({ diagnostic }: { diagnostic: Diagnostic }) {
  const style = diagnostic.status === "SALUDABLE" ? "border-emerald-900 bg-emerald-950/40 text-emerald-300" : diagnostic.status === "REQUIERE_AJUSTES" ? "border-amber-900 bg-amber-950/40 text-amber-300" : "border-red-900 bg-red-950/40 text-red-300";
  const Icon = diagnostic.status === "SALUDABLE" ? CheckCircle2 : AlertTriangle;
  return <div className="mt-4 border-t border-line pt-4">
    <div className={`flex items-center justify-between rounded-button border p-3 ${style}`}><div className="flex items-center gap-2 text-sm font-medium"><Icon size={17} />{diagnostic.status.replace("_", " ")}</div><span className="text-xs">{diagnostic.durationMs} ms</span></div>
    <div className="mt-3 grid grid-cols-4 gap-2 text-center">
      <Metric label="Tablas" value={diagnostic.summary.tables} /><Metric label="Registros" value={diagnostic.summary.rows} /><Metric label="Críticos" value={diagnostic.summary.critical} danger /><Metric label="Avisos" value={diagnostic.summary.warnings} />
    </div>
    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
      {diagnostic.issues.length ? diagnostic.issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="rounded-button border border-line bg-[#0D0D0D] p-3">
        <div className="flex items-start gap-2"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${issue.severity === "critical" ? "bg-red-500" : issue.severity === "warning" ? "bg-amber-400" : "bg-blue-400"}`} /><div><p className="text-sm text-zinc-300">{issue.table && <span className="mr-2 font-mono text-blue-300">{issue.table}</span>}{issue.message}</p><p className="mt-1 text-xs leading-5 text-zinc-600">{issue.recommendation}</p></div></div>
      </div>) : <p className="py-4 text-center text-sm text-emerald-400">No se encontraron problemas de integridad.</p>}
    </div>
  </div>;
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className="rounded-button border border-line bg-[#0D0D0D] p-2"><div className={`font-medium tabular-nums ${danger && value ? "text-red-400" : "text-zinc-200"}`}>{value.toLocaleString()}</div><div className="mt-1 text-[10px] uppercase text-zinc-600">{label}</div></div>;
}
