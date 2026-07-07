import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Database, Download, Edit3, Eye, Plus, Table2, Trash2, X, XCircle } from "lucide-react";
import { api, downloadFile, type DbConfiguration, uploadDatabase } from "../services/api";
import ConfigurationForm, { type ConfigurationPayload } from "./ConfigurationForm";

interface ColumnSchema { name: string; dataType: string; nullable: boolean; primaryKey: boolean; foreignKey: boolean }
interface TableSchema { name: string; columns: ColumnSchema[] }
interface TableDataResponse { rows: Record<string, unknown>[]; hasMore: boolean; offset: number; limit: number }

export default function ConfigurationsList({
  configurations,
  refresh,
  notify
}: {
  configurations: DbConfiguration[];
  refresh(): Promise<void>;
  notify(type: "success" | "error", message: string): void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DbConfiguration | null>(null);
  const [testing, setTesting] = useState<string>();
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [viewing, setViewing] = useState<DbConfiguration | null>(null);

  const save = async (payload: ConfigurationPayload) => {
    try {
      const { databaseFile, ...configuration } = payload;
      const isRemote = configuration.options?.connectionMode === "remote";
      if (databaseFile) {
        const uploaded = await uploadDatabase(configuration.engine, databaseFile);
        configuration.database = uploaded.database;
        configuration.options = {
          ...configuration.options,
          storageMode: "fileCatalog",
          originalFileName: uploaded.originalName,
          uploadedFileSize: uploaded.size,
          tableCount: uploaded.tableCount
        };
      }
      if (!configuration.database && !editing?.hasDatabase && !isRemote) {
        throw new Error("Selecciona un archivo de base de datos antes de guardar");
      }
      configuration.options = {
        ...configuration.options,
        databaseLabel: configuration.database
      };
      await api(editing ? `/configurations/${editing.id}` : "/configurations", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(configuration)
      });
      notify("success", editing ? "Base de datos actualizada" : isRemote ? "Conexion remota guardada" : "Base de datos importada");
      setFormOpen(false);
      setEditing(null);
      await refresh();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo guardar");
    }
  };

  const remove = async (config: DbConfiguration) => {
    if (!confirm(`Eliminar la base de datos "${config.name}"?`)) return;
    try {
      await api(`/configurations/${config.id}`, { method: "DELETE" });
      notify("success", "Base de datos eliminada");
      await refresh();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo eliminar");
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    try {
      const result = await api<{ ok: boolean }>(`/configurations/${id}/test`, { method: "POST" });
      setResults({ ...results, [id]: result.ok });
      notify(result.ok ? "success" : "error", result.ok ? "Conexion verificada" : "No fue posible conectar");
    } catch (error) {
      setResults({ ...results, [id]: false });
      notify("error", error instanceof Error ? error.message : "Error al verificar la conexion");
    } finally {
      setTesting(undefined);
    }
  };

  const downloadModified = async (config: DbConfiguration, format: "xlsx" | "sqlite" | "json") => {
    try {
      await downloadFile(`/configurations/${config.id}/export/${format}`, `${config.name}-modificada.${format}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo descargar la base modificada");
    }
  };

  if (formOpen) {
    return <ConfigurationForm
      editing={editing}
      onSubmit={save}
      onCancel={() => { setFormOpen(false); setEditing(null); }}
    />;
  }

  if (viewing) {
    return <DatabaseContentViewer config={viewing} onClose={() => setViewing(null)} notify={notify} />;
  }

  return <div>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">Bases de datos</h1>
        <p className="mt-1 text-sm text-zinc-500">{configurations.length} de 10 bases disponibles para flujos origen-destino</p>
      </div>
      <button disabled={configurations.length >= 10} className="btn-primary flex items-center gap-2" onClick={() => setFormOpen(true)}>
        <Plus size={17} />Agregar base
      </button>
    </div>

    {!configurations.length ? <div className="card py-16 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-button border border-line bg-zinc-950">
        <Database className="text-blue-400" size={28} />
      </div>
      <p className="text-zinc-400">Aun no hay bases de datos registradas.</p>
    </div> : <div className="grid gap-4 lg:grid-cols-2">
      {configurations.map((config) => {
        const isRemote = config.options?.connectionMode === "remote" || config.options?.storageMode !== "fileCatalog";
        return <article key={config.id} className="card hover:border-blue-500/30">
          <div className="flex items-start justify-between">
            <div className="flex gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-button border border-blue-500/20 bg-blue-600/10">
                <Database size={18} className="text-blue-400" />
              </div>
              <div>
                <h2 className="font-medium text-white">{config.name}</h2>
                <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">{config.engine} - {isRemote ? "remota" : "archivo"}</p>
              </div>
            </div>
            {results[config.id] !== undefined && (results[config.id]
              ? <CheckCircle2 className="text-emerald-400" size={19} />
              : <XCircle className="text-red-400" size={19} />)}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-zinc-600">{isRemote ? "Servidor" : "Archivo"}</div>
              <div className="mt-1 truncate text-zinc-300">
                {isRemote ? `${config.host ?? "Cadena de conexion"}${config.port ? `:${config.port}` : ""}` : String(config.options?.originalFileName ?? "Archivo importado")}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-600">{isRemote ? "Base de datos" : "Tablas / colecciones"}</div>
              <div className="mt-1 truncate text-zinc-300">{isRemote ? String(config.options?.databaseLabel ?? "Conexion externa") : Number(config.options?.tableCount ?? 0)}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-button border border-line bg-[#0D0D0D] px-3 py-2 text-xs text-zinc-500">
            <Clock3 size={14} />
            {config.expiresAt ? `Disponible por ${remainingTime(config.expiresAt)}` : "Conexion persistente"}
          </div>
          {!isRemote && <div className="mt-4 rounded-button border border-line bg-[#0D0D0D] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500"><Download size={14} />Descargar base modificada</div>
            <div className="grid grid-cols-3 gap-2">
              <button className="btn-secondary px-2 py-2 text-xs" onClick={() => downloadModified(config, "xlsx")}>Excel</button>
              <button className="btn-secondary px-2 py-2 text-xs" onClick={() => downloadModified(config, "sqlite")}>SQLite</button>
              <button className="btn-secondary px-2 py-2 text-xs" onClick={() => downloadModified(config, "json")}>JSON</button>
            </div>
          </div>}
          <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <button className="btn-secondary" disabled={testing === config.id} onClick={() => test(config.id)}>
              {testing === config.id ? "Verificando..." : isRemote ? "Verificar conexion" : "Verificar archivo"}
            </button>
            <button className="btn-secondary flex items-center justify-center gap-2" onClick={() => setViewing(config)}><Eye size={16} />Ver contenido</button>
            <button className="btn-secondary" title="Editar" onClick={() => { setEditing(config); setFormOpen(true); }}><Edit3 size={16} /></button>
            <button className="btn-danger" title="Eliminar" onClick={() => remove(config)}><Trash2 size={16} /></button>
          </div>
        </article>;
      })}
    </div>}
  </div>;
}

function DatabaseContentViewer({
  config,
  onClose,
  notify
}: {
  config: DbConfiguration;
  onClose(): void;
  notify(type: "success" | "error", message: string): void;
}) {
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [activeTable, setActiveTable] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const notifyRef = useRef(notify);
  const limit = 50;

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  useEffect(() => {
    let alive = true;
    setLoadingSchema(true);
    setTables([]);
    setRows([]);
    setActiveTable("");
    setOffset(0);
    api<{ tables: TableSchema[] }>(`/schema/${config.id}`)
      .then((result) => {
        if (!alive) return;
        setTables(result.tables);
        setActiveTable(result.tables[0]?.name ?? "");
      })
      .catch((error) => notifyRef.current("error", error instanceof Error ? error.message : "No se pudo cargar el contenido"))
      .finally(() => alive && setLoadingSchema(false));
    return () => { alive = false; };
  }, [config.id]);

  useEffect(() => {
    if (!activeTable) {
      setRows([]);
      setHasMore(false);
      return;
    }
    let alive = true;
    setLoadingRows(true);
    api<TableDataResponse>(`/schema/${config.id}/data/${encodeURIComponent(activeTable)}?offset=${offset}&limit=${limit}`)
      .then((result) => {
        if (!alive) return;
        setRows(result.rows);
        setHasMore(result.hasMore);
      })
      .catch((error) => notifyRef.current("error", error instanceof Error ? error.message : "No se pudieron cargar las filas"))
      .finally(() => alive && setLoadingRows(false));
    return () => { alive = false; };
  }, [activeTable, config.id, offset]);

  const selected = tables.find((table) => table.name === activeTable);
  const columns = selected?.columns.length
    ? selected.columns.map((column) => column.name)
    : [...new Set(rows.flatMap((row) => Object.keys(row)))];

  const selectTable = (table: string) => {
    setActiveTable(table);
    setOffset(0);
  };

  return <div>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <button className="btn-secondary mb-4 inline-flex items-center gap-2" onClick={onClose}><ChevronLeft size={16} />Volver</button>
        <h1 className="text-2xl font-semibold text-white">{config.name}</h1>
        <p className="mt-1 text-sm text-zinc-500">{config.engine} - vista de tablas, columnas y primeras filas</p>
      </div>
      <button className="btn-secondary flex items-center gap-2" onClick={onClose}><X size={16} />Cerrar</button>
    </div>

    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <aside className="card self-start">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white"><Table2 size={16} />Tablas</div>
        {loadingSchema ? <p className="text-sm text-zinc-500">Cargando esquema...</p> : tables.length ? <div className="max-h-[560px] space-y-2 overflow-y-auto">
          {tables.map((table) => <button
            key={table.name}
            className={activeTable === table.name ? "btn-primary w-full text-left" : "btn-secondary w-full text-left"}
            onClick={() => selectTable(table.name)}
          >
            <span className="block truncate">{table.name}</span>
            <span className="mt-1 block text-xs opacity-70">{table.columns.length} columnas</span>
          </button>)}
        </div> : <p className="text-sm text-zinc-500">No se encontraron tablas.</p>}
      </aside>

      <section className="card min-w-0">
        {selected ? <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-white">{selected.name}</h2>
              <p className="mt-1 text-xs text-zinc-500">Mostrando {rows.length} filas desde {offset.toLocaleString()}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex items-center gap-2" disabled={offset === 0 || loadingRows} onClick={() => setOffset(Math.max(0, offset - limit))}><ChevronLeft size={15} />Anterior</button>
              <button className="btn-secondary flex items-center gap-2" disabled={!hasMore || loadingRows} onClick={() => setOffset(offset + limit)}>Siguiente<ChevronRight size={15} /></button>
            </div>
          </div>

          <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {selected.columns.map((column) => <div key={column.name} className="rounded-button border border-line bg-[#0D0D0D] p-3">
              <div className="truncate text-sm text-zinc-200">{column.name}</div>
              <div className="mt-1 text-xs text-zinc-500">{column.dataType}{column.primaryKey ? " - PK" : ""}{column.foreignKey ? " - FK" : ""}{column.nullable ? " - null" : ""}</div>
            </div>)}
          </div>

          <div className="table-shell">
            <table>
              <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {loadingRows ? <tr><td colSpan={Math.max(1, columns.length)} className="py-10 text-center text-zinc-500">Cargando filas...</td></tr>
                  : rows.length ? rows.map((row, index) => <tr key={`${offset}-${index}`}>
                    {columns.map((column) => <td key={column} className="max-w-64 truncate text-zinc-300" title={formatCell(row[column])}>{formatCell(row[column])}</td>)}
                  </tr>)
                    : <tr><td colSpan={Math.max(1, columns.length)} className="py-10 text-center text-zinc-500">Sin filas para mostrar</td></tr>}
              </tbody>
            </table>
          </div>
        </> : <div className="py-16 text-center text-zinc-500">
          <Database className="mx-auto mb-3 text-blue-400" size={30} />
          Selecciona una tabla para ver su contenido.
        </div>}
      </section>
    </div>
  </div>;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function remainingTime(expiresAt: string): string {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.max(1, Math.ceil((remaining % 3_600_000) / 60_000));
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}
