import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Database, Download, Layers3, Pause, Play, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import { api, uploadDatabase, type DbConfiguration } from "../services/api";
import ConfigurationForm, { type ConfigurationPayload } from "./ConfigurationForm";
import ReplicationConfirmModal from "./ReplicationConfirmModal";

interface Column { name: string; dataType: string; nullable: boolean; primaryKey: boolean }
interface TableSchema { name: string; columns: Column[] }
interface TableChoice { sourceTable: string; destinationTable: string; selected: boolean }
interface ColumnMapping { source: string; destination: string; transform: "none" | "string" | "number" | "boolean" | "date" | "json" }
interface Replication {
  id: string; group_id: string; source_table: string; destination_table: string; status: string;
  records_copied: number; failed_records: number; total_records?: number; current_offset: number;
  current_batch: number; speed_rows_per_second: number; retry_count: number; progress_percent: number;
  last_error?: string; error_details?: Array<{ offset: number; count: number; message: string }>;
  failure_stage?: string; failure_code?: string; failure_cause?: string; recommendation?: string;
  created_at: string; next_run_at?: string;
}

interface Props {
  configurations: DbConfiguration[];
  refreshConfigurations(): Promise<void>;
  notify(type: "success" | "error", message: string): void;
}

const transforms = [
  ["none", "Sin conversión"], ["string", "Texto"], ["number", "Número"],
  ["boolean", "Booleano"], ["date", "Fecha"], ["json", "JSON"]
] as const;

export default function ReplicationPanel({ configurations, refreshConfigurations, notify }: Props) {
  const [step, setStep] = useState(1);
  const [sourceConfigId, setSourceConfigId] = useState("");
  const [destinationConfigId, setDestinationConfigId] = useState("");
  const [sourceSchemas, setSourceSchemas] = useState<TableSchema[]>([]);
  const [destinationSchemas, setDestinationSchemas] = useState<TableSchema[]>([]);
  const [tables, setTables] = useState<TableChoice[]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping[]>>({});
  const [writeMode, setWriteMode] = useState<"insert" | "upsert" | "replace" | "truncate">("insert");
  const [batchSize, setBatchSize] = useState(1000);
  const [maxRetries, setMaxRetries] = useState(3);
  const [scheduleMinutes, setScheduleMinutes] = useState(0);
  const [incremental, setIncremental] = useState(true);
  const [replications, setReplications] = useState<Replication[]>([]);
  const [preview, setPreview] = useState<{ totalRecords: number; warnings: string[]; createStatement?: string | null }>();
  const [busy, setBusy] = useState(false);
  const [addingFor, setAddingFor] = useState<"source" | "destination" | null>(null);
  const [modalSql, setModalSql] = useState("");

  const selectedTables = tables.filter((table) => table.selected);
  const sourceConfig = configurations.find((config) => config.id === sourceConfigId);
  const destinationConfig = configurations.find((config) => config.id === destinationConfigId);

  const loadReplications = () => api<{ replications: Replication[] }>("/replications")
    .then((result) => setReplications(result.replications)).catch(() => undefined);
  useEffect(() => {
    void loadReplications();
    const timer = setInterval(loadReplications, 3000);
    return () => clearInterval(timer);
  }, []);

  const loadSchemas = async (kind: "source" | "destination", id: string) => {
    kind === "source" ? setSourceConfigId(id) : setDestinationConfigId(id);
    if (!id) {
      kind === "source" ? setSourceSchemas([]) : setDestinationSchemas([]);
      return;
    }
    try {
      const result = await api<{ tables: TableSchema[] }>(`/schema/${id}`);
      if (kind === "source") {
        setSourceSchemas(result.tables);
        setTables(result.tables.map((table) => ({ sourceTable: table.name, destinationTable: table.name, selected: false })));
        setMappings(Object.fromEntries(result.tables.map((table) => [table.name, table.columns.map((column) => ({
          source: column.name, destination: column.name, transform: "none" as const
        }))])));
      } else setDestinationSchemas(result.tables);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo leer el esquema");
    }
  };

  const payload = (createDestination = true) => ({
    sourceConfigId,
    destinationConfigId,
    tables: selectedTables.map((table) => ({
      sourceTable: table.sourceTable,
      destinationTable: table.destinationTable,
      columnMappings: mappings[table.sourceTable] ?? []
    })),
    writeMode,
    batchSize,
    maxRetries,
    scheduleMinutes: scheduleMinutes || undefined,
    incremental,
    createDestination
  });

  const validate = async () => {
    if (!sourceConfigId || !destinationConfigId || !selectedTables.length) {
      notify("error", "Selecciona origen, destino y al menos una tabla");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ totalRecords: number; warnings: string[]; requiresCreation: boolean; createStatement?: string | null }>("/replications/preview", {
        method: "POST", body: JSON.stringify(payload(false))
      });
      setPreview(result);
      setStep(4);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo validar");
    } finally { setBusy(false); }
  };

  const start = async (createDestination = true) => {
    setBusy(true);
    try {
      if (!preview) {
        await validate();
        return;
      }
      if (preview.createStatement && !createDestination) {
        setModalSql(preview.createStatement);
        return;
      }
      await api("/replications/start", { method: "POST", body: JSON.stringify(payload(createDestination)) });
      setModalSql("");
      notify("success", scheduleMinutes ? "Replicación programada" : "Replicación iniciada");
      setStep(1);
      await loadReplications();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo iniciar");
    } finally { setBusy(false); }
  };

  const action = async (id: string, operation: "stop" | "resume" | "retry") => {
    try {
      await api(`/replications/${id}/${operation}`, { method: "POST" });
      notify("success", operation === "stop" ? "Replicación detenida" : "Replicación reiniciada");
      await loadReplications();
    } catch (error) { notify("error", error instanceof Error ? error.message : "No se pudo completar la acción"); }
  };

  const downloadReport = async (job: Replication) => {
    const report = await api<Record<string, unknown>>(`/replications/${job.id}/report`);
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `replicacion-${job.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const createConnection = async (configurationPayload: ConfigurationPayload) => {
    if (!addingFor) return;
    const kind = addingFor;
    const { databaseFile, ...configuration } = configurationPayload;
    if (!databaseFile) throw new Error("Selecciona un archivo de base de datos");
    const uploaded = await uploadDatabase(configuration.engine, databaseFile);
    configuration.database = uploaded.database;
    configuration.options = { ...configuration.options, storageMode: "fileCatalog", originalFileName: uploaded.originalName, uploadedFileSize: uploaded.size, tableCount: uploaded.tableCount };
    const created = await api<{ configuration: DbConfiguration }>("/configurations", { method: "POST", body: JSON.stringify(configuration) });
    await refreshConfigurations();
    await loadSchemas(kind, created.configuration.id);
    setAddingFor(null);
  };

  return <div>
    <div className="mb-6 grid gap-4 xl:grid-cols-[1fr_auto]">
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-600/10 px-3 py-1 text-xs text-blue-300">
          <Layers3 size={14} />Flujo origen-destino
        </div>
        <h1 className="text-2xl font-semibold text-white">Replicador</h1>
        <p className="mt-1 text-sm text-zinc-500">Configura, valida, ejecuta y reanuda transferencias entre motores.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <HeaderMetric label="Bases" value={configurations.length} />
        <HeaderMetric label="Activas" value={replications.filter((job) => ["starting", "running", "scheduled"].includes(job.status)).length} />
        <HeaderMetric label="Historial" value={replications.length} />
      </div>
    </div>

    <div className="mb-5 grid grid-cols-4 gap-2">
      {["Conexiones", "Tablas", "Mapeo", "Validación"].map((label, index) => <button key={label} onClick={() => index + 1 < step && setStep(index + 1)}
        className={`rounded-button border px-3 py-2 text-xs ${step === index + 1 ? "border-blue-500 bg-blue-600/15 text-blue-300" : index + 1 < step ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-line bg-panel/60 text-zinc-500"}`}>
        {index + 1}. {label}
      </button>)}
    </div>

    <div className="card">
      {step === 1 && <div>
        <h2 className="mb-5 font-medium text-white">Selecciona las bases</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <ConnectionPicker label="Origen" value={sourceConfigId} configurations={configurations} onChange={(id) => loadSchemas("source", id)} onAdd={() => setAddingFor("source")} />
          <ConnectionPicker label="Destino" value={destinationConfigId} configurations={configurations} onChange={(id) => loadSchemas("destination", id)} onAdd={() => setAddingFor("destination")} />
        </div>
      </div>}

      {step === 2 && <div>
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-medium text-white">Tablas a replicar</h2><p className="mt-1 text-xs text-zinc-600">Puedes incluir varias tablas en el mismo grupo.</p></div>
          <button className="btn-secondary text-xs" onClick={() => setTables(tables.map((table) => ({ ...table, selected: true })))}>Seleccionar todas</button></div>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {tables.map((table) => <div key={table.sourceTable} className="grid items-center gap-3 rounded-button border border-line bg-[#0D0D0D] p-3 md:grid-cols-[auto_1fr_1fr]">
            <input type="checkbox" checked={table.selected} onChange={(event) => setTables(tables.map((item) => item.sourceTable === table.sourceTable ? { ...item, selected: event.target.checked } : item))} />
            <span className="text-sm text-zinc-300">{table.sourceTable}</span>
            <input value={table.destinationTable} onChange={(event) => setTables(tables.map((item) => item.sourceTable === table.sourceTable ? { ...item, destinationTable: event.target.value } : item))} />
          </div>)}
        </div>
      </div>}

      {step === 3 && <MappingEditor tables={selectedTables} schemas={sourceSchemas} destinationSchemas={destinationSchemas} mappings={mappings} setMappings={setMappings} />}

      {step === 4 && <div>
        <h2 className="font-medium text-white">Estrategia y validación final</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <div><label>Modo de escritura</label><select value={writeMode} onChange={(event) => setWriteMode(event.target.value as typeof writeMode)}>
            <option value="insert">Solo insertar</option><option value="upsert">Actualizar o insertar</option>
            <option value="replace">Reemplazar contenido</option><option value="truncate">Vaciar y recargar</option>
          </select></div>
          <div><label>Tamaño de lote</label><input type="number" min={100} max={10000} value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} /></div>
          <div><label>Reintentos</label><input type="number" min={0} max={10} value={maxRetries} onChange={(event) => setMaxRetries(Number(event.target.value))} /></div>
          <div><label>Repetir cada</label><select value={scheduleMinutes} onChange={(event) => setScheduleMinutes(Number(event.target.value))}>
            <option value={0}>Solo una vez</option><option value={60}>Cada hora</option><option value={360}>Cada 6 horas</option><option value={1440}>Diariamente</option>
          </select></div>
        </div>
        {scheduleMinutes > 0 && <label className="mt-4 flex items-center gap-3 rounded-button border border-line bg-[#0D0D0D] p-3 text-sm text-zinc-300"><input type="checkbox" checked={incremental} onChange={(event) => setIncremental(event.target.checked)} />Continuar desde el último registro procesado en cada ejecución</label>}
        {preview && <div className="mt-5 rounded-button border border-line bg-[#0D0D0D] p-4">
          <div className="grid gap-3 sm:grid-cols-3"><Metric label="Tablas" value={selectedTables.length} /><Metric label="Registros estimados" value={preview.totalRecords} /><Metric label="Avisos" value={preview.warnings.length} /></div>
          {preview.warnings.length > 0 && <ul className="mt-4 space-y-1 text-xs text-amber-400">{preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}
        </div>}
      </div>}

      <div className="mt-6 flex justify-between border-t border-line pt-5">
        <button className="btn-secondary flex items-center gap-2" disabled={step === 1} onClick={() => setStep(step - 1)}><ChevronLeft size={16} />Anterior</button>
        {step < 3 ? <button className="btn-primary flex items-center gap-2" disabled={step === 1 ? !sourceConfigId || !destinationConfigId : !selectedTables.length} onClick={() => setStep(step + 1)}>Siguiente<ChevronRight size={16} /></button>
          : step === 3 ? <button className="btn-primary flex items-center gap-2" onClick={validate} disabled={busy}>{busy ? "Validando..." : "Validar flujo"}<RefreshCw size={16} /></button>
            : <button className="btn-primary flex items-center gap-2" onClick={() => start(!preview?.createStatement)} disabled={busy}><Play size={16} />{scheduleMinutes ? "Programar" : "Iniciar replicación"}</button>}
      </div>
    </div>

    <ActivityTable replications={replications} action={action} downloadReport={downloadReport} />

    {modalSql && <ReplicationConfirmModal sql={modalSql} busy={busy} onCancel={() => setModalSql("")} onConfirm={() => start(true)} />}
    {addingFor && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 px-4 py-8"><div className="mx-auto max-w-3xl">
      <div className="mb-3 flex justify-between"><h2 className="font-semibold text-white">Agregar base como {addingFor === "source" ? "origen" : "destino"}</h2><button onClick={() => setAddingFor(null)}><X /></button></div>
      <ConfigurationForm onSubmit={createConnection} onCancel={() => setAddingFor(null)} />
    </div></div>}
  </div>;
}

function HeaderMetric({ label, value }: { label: string; value: number }) {
  return <div className="min-w-24 rounded-button border border-line bg-panel px-4 py-3">
    <div className="text-xs text-zinc-500">{label}</div>
    <div className="mt-1 text-xl font-semibold text-white">{value.toLocaleString()}</div>
  </div>;
}

function ConnectionPicker({ label, value, configurations, onChange, onAdd }: { label: string; value: string; configurations: DbConfiguration[]; onChange(id: string): void; onAdd(): void }) {
  return <div><label>{label}</label><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Seleccionar...</option>{configurations.map((config) => <option key={config.id} value={config.id}>{config.name} · {config.engine}</option>)}</select>
    <button className="btn-secondary mt-3 flex w-full items-center justify-center gap-2" onClick={onAdd}><Plus size={15} />Agregar base</button></div>;
}

function MappingEditor({ tables, schemas, destinationSchemas, mappings, setMappings }: { tables: TableChoice[]; schemas: TableSchema[]; destinationSchemas: TableSchema[]; mappings: Record<string, ColumnMapping[]>; setMappings(value: Record<string, ColumnMapping[]>): void }) {
  const [active, setActive] = useState(tables[0]?.sourceTable ?? "");
  const rows = mappings[active] ?? [];
  const destination = destinationSchemas.find((table) => table.name === tables.find((table) => table.sourceTable === active)?.destinationTable);
  return <div><div className="mb-4 flex flex-wrap gap-2">{tables.map((table) => <button key={table.sourceTable} className={active === table.sourceTable ? "btn-primary" : "btn-secondary"} onClick={() => setActive(table.sourceTable)}>{table.sourceTable}</button>)}</div>
    <div className="table-shell"><table><thead><tr><th>Origen</th><th>Destino</th><th>Conversión</th><th>Compatibilidad</th></tr></thead><tbody>{rows.map((mapping, index) => {
      const source = schemas.find((schema) => schema.name === active)?.columns.find((column) => column.name === mapping.source);
      const destinationColumn = destination?.columns.find((column) => column.name === mapping.destination);
      return <tr key={mapping.source}><td>{mapping.source}<div className="text-xs text-zinc-600">{source?.dataType}</div></td><td><input value={mapping.destination} onChange={(event) => {
        const next = [...rows]; next[index] = { ...mapping, destination: event.target.value }; setMappings({ ...mappings, [active]: next });
      }} /></td><td><select value={mapping.transform} onChange={(event) => {
        const next = [...rows]; next[index] = { ...mapping, transform: event.target.value as ColumnMapping["transform"] }; setMappings({ ...mappings, [active]: next });
      }}>{transforms.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td className={destinationColumn || !destination ? "text-emerald-400" : "text-amber-400"}>{!destination ? "Se creará" : destinationColumn ? destinationColumn.dataType : "No existe"}</td></tr>;
    })}</tbody></table></div></div>;
}

function ActivityTable({ replications, action, downloadReport }: { replications: Replication[]; action(id: string, operation: "stop" | "resume" | "retry"): void; downloadReport(job: Replication): void }) {
  const [expanded, setExpanded] = useState<string>();
  return <div className="mt-6"><h2 className="mb-3 font-medium text-white">Actividad e historial</h2><div className="table-shell"><table><thead><tr><th>Flujo</th><th>Progreso</th><th>Rendimiento</th><th>Estado</th><th></th></tr></thead><tbody>
    {replications.length ? replications.flatMap((job) => [<tr key={job.id}><td><div className="text-zinc-300">{job.source_table} → {job.destination_table}</div><div className="mt-1 text-xs text-zinc-600">{new Date(job.created_at).toLocaleString()}</div>{job.last_error && <button className="mt-1 block max-w-sm truncate text-left text-xs text-red-400 hover:underline" onClick={() => setExpanded(expanded === job.id ? undefined : job.id)}>{job.last_error}</button>}{!job.last_error && job.failure_cause && <button className="mt-1 text-left text-xs text-amber-400 hover:underline" onClick={() => setExpanded(expanded === job.id ? undefined : job.id)}>{job.failure_cause}</button>}</td>
      <td>{(() => { const progress = job.status === "completed" ? 100 : Number(job.progress_percent ?? 0); return <><div className="mb-1 flex justify-between text-xs"><span>{progress}%</span><span>{Number(job.records_copied).toLocaleString()} / {Number(job.total_records ?? 0).toLocaleString()}</span></div><div className="h-1.5 w-48 overflow-hidden rounded bg-zinc-800"><div className={`h-full ${job.status === "completed" ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${progress}%` }} /></div>{Number(job.failed_records) > 0 && <div className="mt-1 text-xs text-red-400">{job.failed_records} rechazados</div>}</>; })()}</td>
      <td className="text-xs text-zinc-400">{Math.round(Number(job.speed_rows_per_second ?? 0)).toLocaleString()} filas/s<br />Lote {job.current_batch} · {job.retry_count} reintentos</td>
      <td><Status status={job.status} />{job.next_run_at && <div className="mt-1 text-[10px] text-zinc-600">{new Date(job.next_run_at).toLocaleString()}</div>}</td>
      <td><div className="flex gap-1">{["running", "starting", "scheduled"].includes(job.status) && <button className="btn-danger" title="Detener" onClick={() => action(job.id, "stop")}><Pause size={14} /></button>}
        {["stopped", "failed"].includes(job.status) && <button className="btn-secondary" title="Continuar" onClick={() => action(job.id, "resume")}><Play size={14} /></button>}
        {["completed", "stopped", "failed"].includes(job.status) && <button className="btn-secondary" title="Reiniciar desde cero" onClick={() => action(job.id, "retry")}><RotateCcw size={14} /></button>}
        <button className="btn-secondary" title="Descargar reporte" onClick={() => downloadReport(job)}><Download size={14} /></button></div></td></tr>,
      expanded === job.id && (job.last_error || job.failure_cause) ? <tr key={`${job.id}-diagnosis`}><td colSpan={5} className="bg-[#0B0B0B]"><div className="grid gap-3 p-3 md:grid-cols-3"><div><div className="text-[10px] uppercase text-zinc-600">Etapa</div><div className="mt-1 text-sm text-zinc-300">{job.failure_stage ?? "Resultado"}</div></div><div><div className="text-[10px] uppercase text-zinc-600">Causa probable</div><div className="mt-1 text-sm text-red-300">{job.failure_cause ?? job.last_error}</div></div><div><div className="text-[10px] uppercase text-zinc-600">Cómo resolverlo</div><div className="mt-1 text-sm text-emerald-300">{job.recommendation ?? "Descarga el reporte para revisar el detalle técnico."}</div></div></div></td></tr> : null].filter(Boolean)) : <tr><td colSpan={5} className="py-10 text-center text-zinc-600">Sin replicaciones todavía</td></tr>}
  </tbody></table></div></div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div><div className="text-xs text-zinc-600">{label}</div><div className="mt-1 text-xl font-semibold text-white">{value.toLocaleString()}</div></div>; }
function Status({ status }: { status: string }) {
  const style = status === "running" ? "bg-blue-950 text-blue-300" : status === "completed" ? "bg-emerald-950 text-emerald-300" : status === "failed" ? "bg-red-950 text-red-300" : status === "scheduled" ? "bg-violet-950 text-violet-300" : "bg-zinc-900 text-zinc-400";
  return <span className={`rounded-full px-2.5 py-1 text-xs ${style}`}>{status}</span>;
}
