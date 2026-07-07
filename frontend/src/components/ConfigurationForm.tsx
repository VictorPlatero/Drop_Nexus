import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { AlertTriangle, Database, FileUp, PlugZap, Upload, X } from "lucide-react";
import type { DbConfiguration } from "../services/api";
import {
  detectDatabaseEngine,
  displayEngine,
  maxDatabaseFileSizeMb,
  validateDatabaseFile,
  type DetectableEngine,
  type DetectionResult
} from "../utils/databaseFileDetector";

type ConnectionMode = "file" | "remote";

export interface ConfigurationPayload {
  name: string;
  engine: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  options?: Record<string, unknown>;
  databaseFile?: File;
}

const formats: Record<string, { accept: string; label: string }> = {
  postgresql: { accept: ".sql,text/plain", label: "Exportacion SQL de PostgreSQL (.sql)" },
  mysql: { accept: ".sql,text/plain", label: "Exportacion SQL de MySQL (.sql)" },
  mariadb: { accept: ".sql,text/plain", label: "Exportacion SQL de MariaDB (.sql)" },
  sqlserver: { accept: ".sql,.bak,text/plain,application/octet-stream", label: "SQL Server (.sql o respaldo .bak)" },
  oracle: { accept: ".sql,text/plain", label: "Script SQL de Oracle (.sql)" },
  sqlite: { accept: ".db,.sqlite,.sqlite3,application/vnd.sqlite3", label: "Base SQLite (.db, .sqlite, .sqlite3)" },
  mongodb: { accept: ".json,.ndjson,application/json", label: "Exportacion MongoDB (.json, .ndjson)" },
  excel: { accept: ".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Libro Excel o CSV (.xlsx, .xls, .csv)" }
};

const allSupportedFormats = ".sql,.bak,.db,.sqlite,.sqlite3,.json,.ndjson,.xlsx,.xls,.csv,text/plain,text/csv,application/json,application/octet-stream,application/vnd.sqlite3,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const remoteEngines = ["postgresql", "mysql", "mariadb", "sqlserver", "mongodb"] as const;
const defaultPorts: Record<string, number> = { postgresql: 5432, mysql: 3306, mariadb: 3306, sqlserver: 1433, mongodb: 27017 };

const empty: ConfigurationPayload = {
  name: "",
  engine: "postgresql",
  port: 5432,
  options: { connectionMode: "file" }
};

export default function ConfigurationForm({
  editing,
  onSubmit,
  onCancel
}: {
  editing?: DbConfiguration | null;
  onSubmit(payload: ConfigurationPayload): Promise<void>;
  onCancel(): void;
}) {
  const [form, setForm] = useState<ConfigurationPayload>(empty);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const mode = (form.options?.connectionMode as ConnectionMode | undefined) ?? "file";
  const isRemote = mode === "remote";

  useEffect(() => {
    if (editing) {
      const editingMode: ConnectionMode = editing.options?.storageMode === "fileCatalog" ? "file" : "remote";
      setForm({
        name: editing.name,
        engine: editing.engine,
        host: editing.host,
        port: editing.port ?? defaultPorts[editing.engine],
        database: editing.database,
        username: editing.username,
        options: {
          ...(editing.options ?? {}),
          connectionMode: editingMode,
          authMode: editing.options?.authMode ?? "password"
        }
      });
    } else {
      setForm(empty);
    }
    setDetection(null);
    setFileError(null);
    setFileWarning(null);
  }, [editing]);

  const setOption = (key: string, value: unknown) => {
    setForm((current) => ({ ...current, options: { ...(current.options ?? {}), [key]: value } }));
  };

  const setMode = (nextMode: ConnectionMode) => {
    setDetection(null);
    setFileError(null);
    setFileWarning(null);
    setForm((current) => {
      const nextEngine = nextMode === "remote" && !remoteEngines.includes(current.engine as typeof remoteEngines[number])
        ? "postgresql"
        : current.engine;
      return {
        ...current,
        engine: nextEngine,
        port: nextMode === "remote" ? current.port ?? defaultPorts[nextEngine] : undefined,
        databaseFile: undefined,
        options: {
          ...(current.options ?? {}),
          connectionMode: nextMode,
          authMode: current.options?.authMode ?? "password",
          ssl: current.options?.ssl ?? nextMode === "remote",
          encrypt: current.options?.encrypt ?? nextMode === "remote",
          trustServerCertificate: current.options?.trustServerCertificate ?? true
        }
      };
    });
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFileError(null);
    setFileWarning(null);
    if (detecting) return;
    if (isRemote) {
      if (!form.database?.trim()) {
        setFileError("Indica el nombre de la base de datos remota");
        return;
      }
      if (!form.host?.trim() && !String(form.options?.connectionString ?? "").trim()) {
        setFileError("Indica el servidor remoto o una cadena de conexion");
        return;
      }
    } else if (form.databaseFile) {
      const validation = await validateDatabaseFile(form.databaseFile, form.engine);
      setFileError(validation.valid ? null : validation.message ?? "Archivo no valido");
      setFileWarning(validation.warning ?? null);
      if (!validation.valid) return;
    } else if (!editing?.hasDatabase) {
      setFileError("Selecciona un archivo de base de datos antes de guardar");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        ...form,
        options: {
          ...(form.options ?? {}),
          connectionMode: mode,
          ...(isRemote ? {} : { storageMode: "fileCatalog" })
        }
      });
    } finally {
      setBusy(false);
    }
  };

  const currentFormat = formats[form.engine] ?? formats.postgresql;
  const submitDisabled = busy || detecting || Boolean(fileError);

  return <form className="card space-y-5" onSubmit={submit}>
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="font-semibold text-white">{editing ? "Editar base de datos" : "Agregar base de datos"}</h2>
        <p className="mt-1 text-sm text-zinc-500">Importa un archivo local o registra una conexion remota.</p>
      </div>
      <div className="hidden rounded-button border border-blue-500/20 bg-blue-600/10 px-3 py-2 text-xs text-blue-300 sm:block">
        Origen o destino
      </div>
    </div>

    <div className="grid gap-2 rounded-button border border-line bg-[#0D0D0D] p-1 sm:grid-cols-2">
      <button type="button" className={mode === "file" ? "btn-primary flex items-center justify-center gap-2" : "btn-secondary flex items-center justify-center gap-2"} onClick={() => setMode("file")}>
        <FileUp size={16} />Archivo local
      </button>
      <button type="button" className={mode === "remote" ? "btn-primary flex items-center justify-center gap-2" : "btn-secondary flex items-center justify-center gap-2"} onClick={() => setMode("remote")}>
        <PlugZap size={16} />Conexion remota
      </button>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label>Nombre</label>
        <input
          required
          maxLength={100}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder={isRemote ? "Produccion SQL Server" : "Ventas 2026"}
        />
      </div>
      <div>
        <label>Modelo de base de datos</label>
        <select
          disabled={Boolean(editing)}
          value={form.engine}
          onChange={async (event) => {
            const engine = event.target.value;
            setForm({ ...form, engine, port: isRemote ? defaultPorts[engine] : undefined });
            setDetection(null);
            if (form.databaseFile) {
              const validation = await validateDatabaseFile(form.databaseFile, engine);
              setFileError(validation.valid ? null : validation.message ?? "Archivo no valido");
              setFileWarning(validation.warning ?? null);
            }
          }}
        >
          {(isRemote ? remoteEngines : Object.keys(formats)).map((engine) => (
            <option key={engine} value={engine}>{displayEngine(engine as DetectableEngine)}</option>
          ))}
        </select>
      </div>
    </div>

    {isRemote ? <RemoteConnectionFields form={form} setForm={setForm} setOption={setOption} /> : <FileConnectionFields
      form={form}
      setForm={setForm}
      editing={editing}
      detecting={detecting}
      setDetecting={setDetecting}
      detection={detection}
      setDetection={setDetection}
      fileError={fileError}
      setFileError={setFileError}
      fileWarning={fileWarning}
      setFileWarning={setFileWarning}
      currentFormat={currentFormat}
      fileInput={fileInput}
    />}

    {fileError && <p className="flex items-start gap-2 text-xs text-red-400">
      <AlertTriangle className="mt-0.5 shrink-0" size={14} />{fileError}
    </p>}

    <div className="rounded-button border border-line bg-[#0D0D0D] p-4 text-xs leading-5 text-zinc-500">
      Las configuraciones se guardan como metadatos cifrados. Los datos solo se leen cuando verificas o ejecutas una replica.
    </div>

    <div className="flex justify-end gap-3">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
      <button disabled={submitDisabled} className="btn-primary">{busy ? "Guardando..." : editing ? "Guardar cambios" : isRemote ? "Guardar conexion" : "Importar base de datos"}</button>
    </div>
  </form>;
}

function RemoteConnectionFields({
  form,
  setForm,
  setOption
}: {
  form: ConfigurationPayload;
  setForm(value: ConfigurationPayload): void;
  setOption(key: string, value: unknown): void;
}) {
  const authMode = String(form.options?.authMode ?? "password");
  const useConnectionString = Boolean(form.options?.useConnectionString);
  const encrypted = form.engine === "sqlserver" ? Boolean(form.options?.encrypt) : Boolean(form.options?.ssl);
  return <div className="space-y-5 rounded-button border border-line bg-[#0D0D0D] p-4">
    <div>
      <h3 className="text-sm font-semibold text-white">Conexion remota</h3>
      <p className="mt-1 text-xs text-zinc-500">Usala como origen o destino del flujo de replica. El destino se elige en el paso Conexiones.</p>
    </div>

    <label className="flex items-center gap-3 rounded-button border border-line bg-[#111318] p-3 text-sm text-zinc-300">
      <input type="checkbox" checked={useConnectionString} onChange={(event) => setOption("useConnectionString", event.target.checked)} />
      Usar cadena de conexion
    </label>

    {useConnectionString && <div>
      <label>Cadena de conexion</label>
      <textarea
        rows={3}
        value={String(form.options?.connectionString ?? "")}
        onChange={(event) => setOption("connectionString", event.target.value)}
        placeholder={form.engine === "mongodb" ? "mongodb+srv://usuario:clave@cluster/base" : "postgresql://usuario:clave@host:5432/base"}
      />
    </div>}

    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label>Nombre del servidor</label>
        <input
          value={form.host ?? ""}
          onChange={(event) => setForm({ ...form, host: event.target.value })}
          placeholder={form.engine === "sqlserver" ? "192.168.1.20 o servidor.empresa.com" : "host.empresa.com"}
        />
      </div>
      <div>
        <label>Puerto</label>
        <input
          type="number"
          min={1}
          max={65535}
          value={form.port ?? defaultPorts[form.engine] ?? ""}
          onChange={(event) => setForm({ ...form, port: event.target.value ? Number(event.target.value) : undefined })}
        />
      </div>
      <div>
        <label>Autenticacion</label>
        <select value={authMode} onChange={(event) => setOption("authMode", event.target.value)}>
          <option value="password">Usuario y contrasena</option>
          {form.engine === "sqlserver" && <option value="windows">Windows / integrada</option>}
        </select>
      </div>
      <div>
        <label>Nombre de usuario</label>
        <input
          disabled={authMode === "windows"}
          value={form.username ?? ""}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          placeholder={authMode === "windows" ? "Credenciales integradas" : "usuario"}
        />
      </div>
      <div>
        <label>Contrasena</label>
        <input
          disabled={authMode === "windows"}
          type="password"
          value={form.password ?? ""}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          placeholder="No se muestra despues de guardar"
        />
      </div>
      <div>
        <label>Nombre de la base de datos</label>
        <input
          required
          value={form.database ?? ""}
          onChange={(event) => setForm({ ...form, database: event.target.value })}
          placeholder={form.engine === "sqlserver" ? "master o ventas" : "postgres"}
        />
      </div>
      <div>
        <label>Cifrar</label>
        <select
          value={encrypted ? "required" : "disabled"}
          onChange={(event) => {
            const enabled = event.target.value === "required";
            setOption(form.engine === "sqlserver" ? "encrypt" : "ssl", enabled);
          }}
        >
          <option value="required">Obligatorio</option>
          <option value="disabled">Desactivado</option>
        </select>
      </div>
      <label className="mt-7 flex items-center gap-3 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={Boolean(form.options?.trustServerCertificate)}
          onChange={(event) => setOption("trustServerCertificate", event.target.checked)}
        />
        Certificado de servidor de confianza
      </label>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label>Tiempo de conexion (ms)</label>
        <input
          type="number"
          min={1000}
          value={Number(form.options?.connectionTimeoutMs ?? 5000)}
          onChange={(event) => setOption("connectionTimeoutMs", Number(event.target.value))}
        />
      </div>
      <div>
        <label>Tiempo de consulta (ms)</label>
        <input
          type="number"
          min={1000}
          value={Number(form.options?.requestTimeoutMs ?? 15000)}
          onChange={(event) => setOption("requestTimeoutMs", Number(event.target.value))}
        />
      </div>
    </div>
  </div>;
}

function FileConnectionFields({
  form,
  setForm,
  editing,
  detecting,
  setDetecting,
  detection,
  setDetection,
  fileError,
  setFileError,
  fileWarning,
  setFileWarning,
  currentFormat,
  fileInput
}: {
  form: ConfigurationPayload;
  setForm(value: ConfigurationPayload): void;
  editing?: DbConfiguration | null;
  detecting: boolean;
  setDetecting(value: boolean): void;
  detection: DetectionResult | null;
  setDetection(value: DetectionResult | null): void;
  fileError: string | null;
  setFileError(value: string | null): void;
  fileWarning: string | null;
  setFileWarning(value: string | null): void;
  currentFormat: { accept: string; label: string };
  fileInput: RefObject<HTMLInputElement | null>;
}) {
  return <div>
    <label>Archivo de base de datos</label>
    <input
      ref={fileInput}
      className="hidden"
      type="file"
      accept={allSupportedFormats}
      onChange={async (event) => {
        const file = event.target.files?.[0];
        if (file) {
          setDetecting(true);
          setFileError(null);
          setFileWarning(null);
          try {
            const detected = await detectDatabaseEngine(file);
            const nextEngine = detected.engine ?? form.engine;
            const validation = await validateDatabaseFile(file, nextEngine);
            setDetection(detected);
            setFileError(validation.valid ? null : validation.message ?? "Archivo no valido");
            setFileWarning(validation.warning ?? null);
            setForm({
              ...form,
              engine: nextEngine,
              name: form.name || file.name.replace(/\.(sql|bak|db|sqlite|sqlite3|json|ndjson|xlsx|xls|csv)$/i, ""),
              databaseFile: file
            });
          } catch (error) {
            setDetection(null);
            setFileError(error instanceof Error ? error.message : "No se pudo leer el archivo seleccionado");
          } finally {
            setDetecting(false);
          }
        }
      }}
    />

    {form.databaseFile ? <div className="flex items-center justify-between rounded-button border border-blue-500/30 bg-blue-600/10 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <Database className="shrink-0 text-blue-400" size={22} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-200">{form.databaseFile.name}</div>
          <div className="mt-1 text-xs text-zinc-500">{(form.databaseFile.size / 1024 / 1024).toFixed(2)} MB - {currentFormat.label}</div>
        </div>
      </div>
      <button
        type="button"
        className="text-zinc-500 hover:text-white"
        aria-label="Quitar archivo"
        onClick={() => {
          setForm({ ...form, databaseFile: undefined });
          setDetection(null);
          setFileError(null);
          setFileWarning(null);
          if (fileInput.current) fileInput.current.value = "";
        }}
      >
        <X size={18} />
      </button>
    </div> : editing?.hasDatabase ? <div className="flex items-center justify-between rounded-button border border-line bg-[#0D0D0D] p-4">
      <div className="flex items-center gap-3">
        <Database className="text-emerald-400" size={22} />
        <div>
          <div className="text-sm text-zinc-200">{String(editing.options?.originalFileName ?? "Archivo importado")}</div>
          <div className="mt-1 text-xs text-zinc-500">Puedes conservarlo o reemplazarlo.</div>
        </div>
      </div>
      <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => fileInput.current?.click()}>
        <Upload size={16} />Reemplazar
      </button>
    </div> : <button
      type="button"
      className="flex w-full flex-col items-center justify-center rounded-card border border-dashed border-zinc-700 bg-[#0D0D0D] px-6 py-10 text-center hover:border-blue-500 hover:bg-blue-950/10"
      onClick={() => fileInput.current?.click()}
    >
      <Upload className="mb-3 text-blue-400" size={26} />
      <span className="text-sm font-medium text-zinc-200">Seleccionar archivo desde la PC</span>
      <span className="mt-2 text-xs text-zinc-500">{currentFormat.label} - Maximo {maxDatabaseFileSizeMb()} MB</span>
    </button>}

    {form.databaseFile && <button type="button" className="btn-secondary mt-3 flex items-center gap-2" onClick={() => fileInput.current?.click()}>
      <Upload size={16} />Elegir otro archivo
    </button>}
    {detecting && <p className="mt-3 text-xs text-blue-400">Detectando modelo de base de datos...</p>}
    {!fileError && fileWarning && <p className="mt-3 flex items-start gap-2 text-xs text-amber-400">
      <AlertTriangle className="mt-0.5 shrink-0" size={14} />{fileWarning}
    </p>}
    {!detecting && detection && <p className={`mt-3 text-xs ${detection.engine ? "text-emerald-400" : "text-amber-400"}`}>
      {detection.engine ? `Detectado automaticamente: ${displayEngine(detection.engine)}. ` : "No se pudo detectar automaticamente. "}
      <span className="text-zinc-500">{detection.reason}.</span>
    </p>}
  </div>;
}
