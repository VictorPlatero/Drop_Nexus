import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Database, FileJson, FileSpreadsheet, FileText, KeyRound, Link2 } from "lucide-react";
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

  const selectedSchema = useMemo(
    () => tables.find((table) => table.name === selectedTable),
    [tables, selectedTable]
  );

  const loadData = async (table: string, offset = 0, databaseId = configId) => {
    if (!databaseId || !table) return;
    setDataBusy(true);
    try {
      setData(await api<TableData>(`/schema/${databaseId}/data/${encodeURIComponent(table)}?offset=${offset}&limit=${PAGE_SIZE}`));
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

  const columns = selectedSchema?.columns.map((column) => column.name)
    ?? (data?.rows[0] ? Object.keys(data.rows[0]) : []);

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
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-600">Excel y JSON incluyen toda la base. CSV descarga únicamente la tabla seleccionada.</p>
      </div>}
    </div>

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
    </section>}

    {selectedTable && <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium text-white">Datos de {selectedTable}</h2>
          <p className="mt-1 text-xs text-zinc-600">
            {data ? `Registros ${data.offset + 1} a ${data.offset + data.rows.length}` : "Cargando contenido..."}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" aria-label="Página anterior" disabled={dataBusy || !data || data.offset === 0} onClick={() => loadData(selectedTable, Math.max(0, (data?.offset ?? 0) - PAGE_SIZE))}><ChevronLeft size={16} /></button>
          <button className="btn-secondary" aria-label="Página siguiente" disabled={dataBusy || !data?.hasMore} onClick={() => loadData(selectedTable, (data?.offset ?? 0) + PAGE_SIZE)}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="table-shell overflow-x-auto">
        {dataBusy && !data ? <div className="py-12 text-center text-sm text-zinc-600">Cargando datos...</div>
          : data?.rows.length ? <table className="min-w-max">
            <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{data.rows.map((row, index) => <tr key={`${data.offset}-${index}`}>
              {columns.map((column) => <td key={column} className="max-w-xs truncate font-mono text-xs text-zinc-300" title={displayValue(row[column])}>{displayValue(row[column])}</td>)}
            </tr>)}</tbody>
          </table> : <div className="py-12 text-center text-sm text-zinc-600">La tabla no contiene registros.</div>}
      </div>
    </section>}
  </div>;
}
