import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Database, FileJson, FileSpreadsheet, FileText, GitCompareArrows, KeyRound, Link2, Search } from "lucide-react";
import { api, downloadFile, type DbConfiguration } from "../services/api";

interface Column {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
}

interface Table {
  name: string;
  columns: Column[];
}

interface TableData {
  rows: Record<string, unknown>[];
  hasMore: boolean;
  offset: number;
  limit: number;
}
interface Statistics {
  totalRows: number; sampleRows: number;
  columns: Array<{ name: string; dataType: string; nulls: number; unique: number; min: unknown; max: unknown }>;
}
interface Comparison {
  table: string; status: "present" | "missing"; missingColumns: string[]; extraColumns: string[];
  typeDifferences: Array<{ column: string; sourceType: string; destinationType: string }>;
}

const PAGE_SIZE = 50;

function displayValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default function SchemaDocumenter({
  configurations,
  notify
}: {
  configurations: DbConfiguration[];
  notify(type: "success" | "error", message: string): void;
}) {
  const [configId, setConfigId] = useState("");
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [data, setData] = useState<TableData>();
  const [busy, setBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statistics, setStatistics] = useState<Statistics>();
  const [compareId, setCompareId] = useState("");
  const [comparison, setComparison] = useState<Comparison[]>([]);
  const [maskSensitive, setMaskSensitive] = useState(true);

  const selectedSchema = useMemo(
    () => tables.find((table) => table.name === selectedTable),
    [tables, selectedTable]
  );

  const loadData = async (table: string, offset = 0, databaseId = configId) => {
    if (!databaseId || !table) return;
    setDataBusy(true);
    try {
      const [rows, stats] = await Promise.all([
        api<TableData>(`/schema/${databaseId}/data/${encodeURIComponent(table)}?offset=${offset}&limit=${PAGE_SIZE}`),
        offset === 0 ? api<Statistics>(`/schema/${databaseId}/statistics/${encodeURIComponent(table)}`) : Promise.resolve(undefined)
      ]);
      setData(rows);
      if (stats) setStatistics(stats);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudieron cargar los datos");
    } finally {
      setDataBusy(false);
    }
  };

  const generate = async () => {
    if (!configId) return;
    setBusy(true);
    try {
      const result = await api<{ tables: Table[] }>(`/schema/${configId}`);
      setTables(result.tables);
      const firstTable = result.tables[0]?.name ?? "";
      setSelectedTable(firstTable);
      setData(undefined);
      if (firstTable) await loadData(firstTable, 0, configId);
      notify("success", "Esquema y datos cargados");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo explorar la base");
    } finally {
      setBusy(false);
    }
  };

  const download = async (format: "excel" | "json" | "csv") => {
    try {
      if (format === "csv") {
        if (!selectedTable) throw new Error("Selecciona una tabla o colección");
        await downloadFile(`/schema/${configId}/export/csv/${encodeURIComponent(selectedTable)}`, `${selectedTable}.csv`);
      } else {
        await downloadFile(`/schema/${configId}/export/${format}`, format === "excel" ? "database.xls" : "database.json");
      }
      notify("success", `Descarga ${format.toUpperCase()} preparada`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo descargar");
    }
  };

  const compare = async () => {
    if (!configId || !compareId) return;
    try {
      const result = await api<{ comparison: Comparison[] }>(`/schema/${configId}/compare/${compareId}`);
      setComparison(result.comparison);
      notify("success", "Comparación de esquemas preparada");
    } catch (error) { notify("error", error instanceof Error ? error.message : "No se pudieron comparar los esquemas"); }
  };

  const columns = selectedSchema?.columns.map((column) => column.name)
    ?? (data?.rows[0] ? Object.keys(data.rows[0]) : []);
  const visibleRows = data?.rows.filter((row) => !search || Object.values(row).some((value) => displayValue(value).toLowerCase().includes(search.toLowerCase()))) ?? [];
  const visibleValue = (column: string, value: unknown) => maskSensitive && /password|secret|token|credential|contrase|ssn|card/i.test(column) && value !== null && value !== undefined ? "••••••••" : displayValue(value);

  return <div>
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-white">Documentador y explorador</h1>
      <p className="mt-1 text-sm text-zinc-500">Consulta el esquema y el contenido real de cada tabla o colección importada.</p>
    </div>

    <div className="card">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-1">
          <label>Base de datos</label>
          <select value={configId} onChange={(event) => {
            setConfigId(event.target.value);
            setTables([]);
            setSelectedTable("");
            setData(undefined);
          }}>
            <option value="">Seleccionar base importada...</option>
            {configurations.map((configuration) => (
              <option key={configuration.id} value={configuration.id}>{configuration.name} · {configuration.engine}</option>
            ))}
          </select>
        </div>
        <button disabled={!configId || busy} className="btn-primary flex items-center justify-center gap-2" onClick={generate}>
          <Database size={17} />{busy ? "Cargando..." : "Explorar base de datos"}
        </button>
      </div>

      {tables.length > 0 && <div className="mt-5 border-t border-line pt-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <label>Tabla o colección</label>
            <select value={selectedTable} onChange={(event) => {
              setSelectedTable(event.target.value);
              setData(undefined);
              void loadData(event.target.value);
            }}>
              {tables.map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary flex items-center gap-2" onClick={() => download("excel")}><FileSpreadsheet size={16} />Excel</button>
            <button className="btn-secondary flex items-center gap-2" onClick={() => download("csv")}><FileText size={16} />CSV de esta tabla</button>
            <button className="btn-secondary flex items-center gap-2" onClick={() => download("json")}><FileJson size={16} />JSON</button>
            <button className="btn-secondary flex items-center gap-2" onClick={() => downloadFile(`/schema/${configId}/export/documentation/html`, "documentacion.html")}><FileText size={16} />HTML/PDF</button>
            <button className="btn-secondary flex items-center gap-2" onClick={() => downloadFile(`/schema/${configId}/export/documentation/markdown`, "documentacion.md")}><FileText size={16} />Markdown</button>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-600">Excel y JSON incluyen toda la base. CSV descarga únicamente la tabla seleccionada.</p>
      </div>}
    </div>

    {tables.length > 0 && <section className="mt-6 card">
      <h2 className="flex items-center gap-2 font-medium text-white"><GitCompareArrows size={18} className="text-blue-400" />Comparar esquemas</h2>
      <div className="mt-4 flex flex-col gap-3 md:flex-row"><select value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">Seleccionar base destino...</option>{configurations.filter((config) => config.id !== configId).map((config) => <option key={config.id} value={config.id}>{config.name} · {config.engine}</option>)}</select><button className="btn-secondary" disabled={!compareId} onClick={compare}>Comparar</button></div>
      {comparison.length > 0 && <div className="mt-4 grid gap-2 md:grid-cols-2">{comparison.map((item) => <div key={item.table} className="rounded-button border border-line bg-[#0D0D0D] p-3"><div className="flex justify-between"><span className="text-sm text-zinc-300">{item.table}</span><span className={item.status === "present" && !item.missingColumns.length && !item.typeDifferences.length ? "text-emerald-400" : "text-amber-400"}>{item.status === "missing" ? "No existe" : "Comparada"}</span></div><p className="mt-2 text-xs text-zinc-600">Faltantes: {item.missingColumns.join(", ") || "ninguna"} · Tipos diferentes: {item.typeDifferences.length}</p></div>)}</div>}
    </section>}

    {selectedSchema && <section className="mt-6">
      <h2 className="mb-3 flex items-center gap-2 font-medium text-white">
        Esquema de {selectedSchema.name}
        <span className="text-xs font-normal text-zinc-600">{selectedSchema.columns.length} columnas</span>
      </h2>
      <div className="table-shell">
        <table>
          <thead><tr><th>Columna</th><th>Tipo</th><th>Nullable</th><th>Claves</th></tr></thead>
          <tbody>{selectedSchema.columns.map((column) => <tr key={column.name}>
            <td className="font-mono text-sm text-zinc-300">{column.name}</td>
            <td className="text-blue-300">{column.dataType}</td>
            <td className="text-zinc-500">{column.nullable ? "Sí" : "No"}</td>
            <td><div className="flex gap-2">
              {column.primaryKey && <span title="Primary Key" className="text-amber-400"><KeyRound size={17} /></span>}
              {column.foreignKey && <span title="Foreign Key" className="text-blue-400"><Link2 size={17} /></span>}
              {!column.primaryKey && !column.foreignKey && <span className="text-zinc-700">—</span>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="mt-4 rounded-button border border-line bg-[#0D0D0D] p-4"><h3 className="text-sm font-medium text-zinc-300">Relaciones detectadas</h3><div className="mt-2 flex flex-wrap gap-2">{selectedSchema.columns.filter((column) => column.foreignKey).map((column) => <span key={column.name} className="rounded-full bg-blue-950 px-3 py-1 text-xs text-blue-300">{selectedSchema.name}.{column.name} → referencia externa</span>)}{!selectedSchema.columns.some((column) => column.foreignKey) && <span className="text-xs text-zinc-600">No se detectaron claves foráneas.</span>}</div></div>
    </section>}

    {statistics && <section className="mt-6"><h2 className="mb-3 font-medium text-white">Perfil de datos · {statistics.totalRows.toLocaleString()} registros</h2><div className="table-shell"><table><thead><tr><th>Columna</th><th>Nulos</th><th>Únicos</th><th>Mínimo</th><th>Máximo</th></tr></thead><tbody>{statistics.columns.map((column) => <tr key={column.name}><td>{column.name}<div className="text-xs text-zinc-600">{column.dataType}</div></td><td>{column.nulls}</td><td>{column.unique}</td><td className="max-w-40 truncate">{displayValue(column.min)}</td><td className="max-w-40 truncate">{displayValue(column.max)}</td></tr>)}</tbody></table></div></section>}

    {selectedTable && <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium text-white">Datos de {selectedTable}</h2>
          <p className="mt-1 text-xs text-zinc-600">
            {data ? `Registros ${data.offset + 1} a ${data.offset + data.rows.length}` : "Cargando contenido..."}
          </p>
        </div>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 rounded-button border border-line px-3 text-xs text-zinc-400"><input type="checkbox" checked={maskSensitive} onChange={(event) => setMaskSensitive(event.target.checked)} />Ocultar sensibles</label>
          <div className="relative"><Search className="absolute left-3 top-3 text-zinc-600" size={15} /><input className="w-52 pl-9" placeholder="Filtrar página..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <button className="btn-secondary" aria-label="Página anterior" disabled={dataBusy || !data || data.offset === 0} onClick={() => loadData(selectedTable, Math.max(0, (data?.offset ?? 0) - PAGE_SIZE))}><ChevronLeft size={16} /></button>
          <button className="btn-secondary" aria-label="Página siguiente" disabled={dataBusy || !data?.hasMore} onClick={() => loadData(selectedTable, (data?.offset ?? 0) + PAGE_SIZE)}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="table-shell overflow-x-auto">
        {dataBusy && !data ? <div className="py-12 text-center text-sm text-zinc-600">Cargando datos...</div>
          : visibleRows.length ? <table className="min-w-max">
            <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{visibleRows.map((row, index) => <tr key={`${data?.offset}-${index}`}>
              {columns.map((column) => <td key={column} className="max-w-xs truncate font-mono text-xs text-zinc-300" title={visibleValue(column, row[column])}>{visibleValue(column, row[column])}</td>)}
            </tr>)}</tbody>
          </table> : <div className="py-12 text-center text-sm text-zinc-600">La tabla no contiene registros.</div>}
      </div>
    </section>}
  </div>;
}
