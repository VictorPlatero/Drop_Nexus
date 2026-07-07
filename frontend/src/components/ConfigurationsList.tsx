import { useState } from "react";
import { CheckCircle2, Clock3, Database, Download, Edit3, Plus, Trash2, XCircle } from "lucide-react";
import { api, downloadFile, type DbConfiguration, uploadDatabase } from "../services/api";
import ConfigurationForm, { type ConfigurationPayload } from "./ConfigurationForm";

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
            Disponible por {remainingTime(config.expiresAt)}
          </div>
          {!isRemote && <div className="mt-4 rounded-button border border-line bg-[#0D0D0D] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500"><Download size={14} />Descargar base modificada</div>
            <div className="grid grid-cols-3 gap-2">
              <button className="btn-secondary px-2 py-2 text-xs" onClick={() => downloadModified(config, "xlsx")}>Excel</button>
              <button className="btn-secondary px-2 py-2 text-xs" onClick={() => downloadModified(config, "sqlite")}>SQLite</button>
              <button className="btn-secondary px-2 py-2 text-xs" onClick={() => downloadModified(config, "json")}>JSON</button>
            </div>
          </div>}
          <div className="mt-6 flex gap-2">
            <button className="btn-secondary flex-1" disabled={testing === config.id} onClick={() => test(config.id)}>
              {testing === config.id ? "Verificando..." : isRemote ? "Verificar conexion" : "Verificar archivo"}
            </button>
            <button className="btn-secondary" title="Editar" onClick={() => { setEditing(config); setFormOpen(true); }}><Edit3 size={16} /></button>
            <button className="btn-danger" title="Eliminar" onClick={() => remove(config)}><Trash2 size={16} /></button>
          </div>
        </article>;
      })}
    </div>}
  </div>;
}

function remainingTime(expiresAt: string): string {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.max(1, Math.ceil((remaining % 3_600_000) / 60_000));
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}
