import { useEffect, useState } from "react";
import { Database, Play, Plus, RefreshCw, Square, X } from "lucide-react";
import { api, uploadDatabase, type DbConfiguration } from "../services/api";
import ConfigurationForm, { type ConfigurationPayload } from "./ConfigurationForm";
import ReplicationConfirmModal from "./ReplicationConfirmModal";

interface Replication {
  id: string;
  source_table: string;
  destination_table: string;
  status: string;
  records_copied: number;
  last_error?: string;
  created_at: string;
}

interface Selection {
  sourceConfigId: string;
  destinationConfigId: string;
  sourceTable: string;
  destinationTable: string;
}

interface Props {
  configurations: DbConfiguration[];
  refreshConfigurations(): Promise<void>;
  notify(type: "success" | "error", message: string): void;
}

const initial: Selection = {
  sourceConfigId: "",
  destinationConfigId: "",
  sourceTable: "",
  destinationTable: ""
};

export default function ReplicationPanel({ configurations, refreshConfigurations, notify }: Props) {
  const [selection, setSelection] = useState(initial);
  const [sourceTables, setSourceTables] = useState<string[]>([]);
  const [destinationTables, setDestinationTables] = useState<string[]>([]);
  const [replications, setReplications] = useState<Replication[]>([]);
  const [modalSql, setModalSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [addingFor, setAddingFor] = useState<"source" | "destination" | null>(null);
  const [loadingTables, setLoadingTables] = useState<"source" | "destination" | null>(null);
  const [newDestination, setNewDestination] = useState(false);

  const loadReplications = () => api<{ replications: Replication[] }>("/replications")
    .then((result) => setReplications(result.replications))
    .catch(() => undefined);

  useEffect(() => {
    void loadReplications();
    const timer = setInterval(loadReplications, 5000);
    return () => clearInterval(timer);
  }, []);

  const loadTables = async (kind: "source" | "destination", configId: string) => {
    setSelection((current) => ({
      ...current,
      [`${kind}ConfigId`]: configId,
      [`${kind}Table`]: ""
    }));
    if (!configId) {
      kind === "source" ? setSourceTables([]) : setDestinationTables([]);
      return;
    }
    setLoadingTables(kind);
    try {
      const result = await api<{ tables: string[] }>(`/configurations/${configId}/tables`);
      if (kind === "source") {
        setSourceTables(result.tables);
        setSelection((current) => ({ ...current, sourceTable: result.tables[0] ?? "" }));
      } else {
        setDestinationTables(result.tables);
        setNewDestination(result.tables.length === 0);
        setSelection((current) => ({ ...current, destinationTable: result.tables[0] ?? "" }));
      }
      if (!result.tables.length) {
        notify("error", `El archivo no contiene ${kind === "source" ? "tablas o colecciones" : "estructuras existentes"}`);
      }
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudieron cargar las tablas");
    } finally {
      setLoadingTables(null);
    }
  };

  const createConnection = async (payload: ConfigurationPayload) => {
    if (!addingFor) return;
    const kind = addingFor;
    try {
      const { databaseFile, ...configuration } = payload;
      if (!databaseFile) throw new Error("Selecciona un archivo de base de datos");
      const uploaded = await uploadDatabase(configuration.engine, databaseFile);
      configuration.database = uploaded.database;
      configuration.options = {
        ...configuration.options,
        storageMode: "fileCatalog",
        originalFileName: uploaded.originalName,
        uploadedFileSize: uploaded.size,
        tableCount: uploaded.tableCount
      };
      const created = await api<{ configuration: DbConfiguration }>("/configurations", {
        method: "POST",
        body: JSON.stringify(configuration)
      });
      await refreshConfigurations();
      await loadTables(kind, created.configuration.id);
      setAddingFor(null);
      notify("success", `${configuration.name} agregada y seleccionada`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo agregar la base de datos");
      throw error;
    }
  };

  const payload = (createDestination: boolean) => ({ ...selection, createDestination });

  const start = async (createDestination = false) => {
    if (!selection.sourceConfigId || !selection.destinationConfigId || !selection.sourceTable || !selection.destinationTable) {
      notify("error", "Completa origen y destino");
      return;
    }
    setBusy(true);
    try {
      if (!createDestination) {
        const preview = await api<{ requiresCreation: boolean; createStatement: string | null }>("/replications/preview", {
          method: "POST",
          body: JSON.stringify(payload(false))
        });
        if (preview.requiresCreation) {
          setModalSql(preview.createStatement ?? "");
          return;
        }
      }
      await api("/replications/start", {
        method: "POST",
        body: JSON.stringify(payload(createDestination))
      });
      setModalSql("");
      notify("success", "Replicación iniciada");
      await loadReplications();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo iniciar");
    } finally {
      setBusy(false);
    }
  };

  const stop = async (id: string) => {
    try {
      await api(`/replications/${id}/stop`, { method: "POST" });
      notify("success", "Replicación detenida");
      await loadReplications();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "No se pudo detener");
    }
  };

  const connectionControl = (kind: "source" | "destination") => {
    const configId = kind === "source" ? selection.sourceConfigId : selection.destinationConfigId;
    return <div>
      <label>Base importada</label>
      <select value={configId} onChange={(event) => loadTables(kind, event.target.value)}>
        <option value="">Seleccionar una base...</option>
        {configurations.map((configuration) => (
          <option key={configuration.id} value={configuration.id}>
            {configuration.name} · {configuration.engine}
          </option>
        ))}
      </select>
      <div className="my-3 flex items-center gap-3 text-xs text-zinc-600">
        <span className="h-px flex-1 bg-line" />
        <span>o agrega otra base</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        className="btn-secondary flex w-full items-center justify-center gap-2"
        disabled={configurations.length >= 10}
        onClick={() => setAddingFor(kind)}
      >
        <Plus size={16} />
        Agregar base de datos
      </button>
      <p className="mt-2 text-xs leading-5 text-zinc-600">
        PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB o archivo SQLite.
      </p>
      {configurations.length >= 10 && <p className="mt-2 text-xs text-amber-400">Alcanzaste el límite de 10 bases importadas.</p>}
    </div>;
  };

  return <div>
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-white">Replicador</h1>
      <p className="mt-1 text-sm text-zinc-500">Conecta bases relacionales y no relacionales como origen o destino.</p>
    </div>
    <div className="card">
      <div className="grid gap-5 lg:grid-cols-[1fr_auto_1fr]">
        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">Origen</h2>
          <div className="space-y-4">
            {connectionControl("source")}
            <div>
              <label>Tabla o colección</label>
              <select disabled={!selection.sourceConfigId || loadingTables === "source"} value={selection.sourceTable} onChange={(event) => setSelection({ ...selection, sourceTable: event.target.value })}>
                <option value="">{loadingTables === "source" ? "Cargando estructuras..." : "Seleccionar tabla o colección..."}</option>
                {sourceTables.map((table) => <option key={table}>{table}</option>)}
              </select>
              {selection.sourceConfigId && !loadingTables && <p className="mt-2 text-xs text-zinc-600">{sourceTables.length} estructura(s) encontradas en el archivo.</p>}
            </div>
          </div>
        </div>
        <div className="hidden items-center pt-8 text-zinc-700 lg:flex"><RefreshCw size={24} /></div>
        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-400">Destino</h2>
          <div className="space-y-4">
            {connectionControl("destination")}
            <div>
              <label>Tabla o colección destino</label>
              {!newDestination ? <select
                value={selection.destinationTable}
                disabled={!selection.destinationConfigId || loadingTables === "destination"}
                onChange={(event) => {
                  if (event.target.value === "__new__") {
                    setNewDestination(true);
                    setSelection({ ...selection, destinationTable: "" });
                  } else {
                    setSelection({ ...selection, destinationTable: event.target.value });
                  }
                }}
              >
                <option value="">{loadingTables === "destination" ? "Cargando estructuras..." : "Seleccionar tabla o colección..."}</option>
                {destinationTables.map((table) => <option key={table}>{table}</option>)}
                <option value="__new__">+ Crear nueva tabla o colección</option>
              </select> : <div className="flex gap-2">
                <input
                  value={selection.destinationTable}
                  disabled={!selection.destinationConfigId}
                  onChange={(event) => setSelection({ ...selection, destinationTable: event.target.value })}
                  placeholder="Nombre de la nueva tabla o colección"
                />
                {destinationTables.length > 0 && <button type="button" className="btn-secondary whitespace-nowrap" onClick={() => {
                  setNewDestination(false);
                  setSelection({ ...selection, destinationTable: destinationTables[0] ?? "" });
                }}>Usar existente</button>}
              </div>}
              {selection.destinationConfigId && !loadingTables && <p className="mt-2 text-xs text-zinc-600">{destinationTables.length} estructura(s) encontradas en el archivo destino.</p>}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <button
          disabled={busy || !selection.sourceConfigId || !selection.destinationConfigId || !selection.sourceTable || !selection.destinationTable}
          className="btn-primary flex items-center gap-2"
          onClick={() => start(false)}
        >
          <Play size={17} />{busy ? "Validando..." : "Iniciar replicación"}
        </button>
      </div>
    </div>

    <div className="mt-6">
      <h2 className="mb-3 font-medium text-white">Actividad reciente</h2>
      <div className="table-shell">
        <table>
          <thead><tr><th>Flujo</th><th>Estado</th><th>Registros</th><th>Inicio</th><th></th></tr></thead>
          <tbody>
            {replications.length ? replications.map((replication) => <tr key={replication.id}>
              <td>
                <span className="text-zinc-300">{replication.source_table}</span>
                <span className="mx-2 text-zinc-700">→</span>
                <span className="text-zinc-300">{replication.destination_table}</span>
                {replication.last_error && <div className="mt-1 max-w-md truncate text-xs text-red-400">{replication.last_error}</div>}
              </td>
              <td><Status status={replication.status} /></td>
              <td className="tabular-nums text-zinc-300">{Number(replication.records_copied).toLocaleString()}</td>
              <td className="text-zinc-500">{new Date(replication.created_at).toLocaleString()}</td>
              <td>{["running", "starting"].includes(replication.status) && <button className="btn-danger flex items-center gap-2" onClick={() => stop(replication.id)}><Square size={13} />Detener</button>}</td>
            </tr>) : <tr><td colSpan={5} className="py-10 text-center text-zinc-600">Sin replicaciones todavía</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    {modalSql && <ReplicationConfirmModal sql={modalSql} busy={busy} onCancel={() => setModalSql("")} onConfirm={() => start(true)} />}

    {addingFor && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-button bg-blue-950 text-blue-400"><Database size={20} /></div>
            <div>
              <h2 className="font-semibold text-white">Agregar base como {addingFor === "source" ? "origen" : "destino"}</h2>
              <p className="text-xs text-zinc-500">Elige el modelo y sube su archivo desde tu computadora.</p>
            </div>
          </div>
          <button className="text-zinc-500 hover:text-white" onClick={() => setAddingFor(null)} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <ConfigurationForm onSubmit={createConnection} onCancel={() => setAddingFor(null)} />
      </div>
    </div>}
  </div>;
}

function Status({ status }: { status: string }) {
  const style = status === "running"
    ? "bg-blue-950 text-blue-300"
    : status === "completed"
      ? "bg-emerald-950 text-emerald-300"
      : status === "failed"
        ? "bg-red-950 text-red-300"
        : "bg-zinc-900 text-zinc-400";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>{status}</span>;
}
