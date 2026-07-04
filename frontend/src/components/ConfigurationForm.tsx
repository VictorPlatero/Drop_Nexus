import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Database, Upload, X } from "lucide-react";
import type { DbConfiguration } from "../services/api";
import {
  detectDatabaseEngine,
  displayEngine,
  maxDatabaseFileSizeMb,
  validateDatabaseFile,
  type DetectionResult
} from "../utils/databaseFileDetector";

export interface ConfigurationPayload {
  name: string;
  engine: string;
  database?: string;
  options?: Record<string, unknown>;
  databaseFile?: File;
}

const formats: Record<string, { accept: string; label: string }> = {
  postgresql: { accept: ".sql,text/plain", label: "Exportación SQL de PostgreSQL (.sql)" },
  mysql: { accept: ".sql,text/plain", label: "Exportación SQL de MySQL (.sql)" },
  mariadb: { accept: ".sql,text/plain", label: "Exportación SQL de MariaDB (.sql)" },
  sqlserver: { accept: ".sql,.bak,text/plain,application/octet-stream", label: "SQL Server (.sql o respaldo .bak)" },
  oracle: { accept: ".sql,text/plain", label: "Script SQL de Oracle (.sql)" },
  sqlite: { accept: ".db,.sqlite,.sqlite3,application/vnd.sqlite3", label: "Base SQLite (.db, .sqlite, .sqlite3)" },
  mongodb: { accept: ".json,.ndjson,application/json", label: "Exportación MongoDB (.json, .ndjson)" },
  excel: { accept: ".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Libro Excel o CSV (.xlsx, .xls, .csv)" }
};

const empty: ConfigurationPayload = {
  name: "",
  engine: "postgresql",
  options: {}
};

const allSupportedFormats = ".sql,.bak,.db,.sqlite,.sqlite3,.json,.ndjson,.xlsx,.xls,.csv,text/plain,text/csv,application/json,application/octet-stream,application/vnd.sqlite3,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

  useEffect(() => {
    setForm(editing ? {
      name: editing.name,
      engine: editing.engine,
      options: editing.options ?? {}
    } : empty);
    setDetection(null);
    setFileError(null);
    setFileWarning(null);
  }, [editing]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFileError(null);
    setFileWarning(null);
    if (detecting) return;
    if (form.databaseFile) {
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
      await onSubmit(form);
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
        <p className="mt-1 text-sm text-zinc-500">La base se importa desde un archivo de tu computadora.</p>
      </div>
      <div className="hidden rounded-button border border-blue-500/20 bg-blue-600/10 px-3 py-2 text-xs text-blue-300 sm:block">
        Origen o destino
      </div>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label>Nombre</label>
        <input
          required
          maxLength={100}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Ventas 2026"
        />
      </div>
      <div>
        <label>Modelo de base de datos</label>
        <select
          disabled={Boolean(editing)}
          value={form.engine}
          onChange={async (event) => {
            const engine = event.target.value;
            setForm({ ...form, engine });
            setDetection(null);
            if (form.databaseFile) {
              const validation = await validateDatabaseFile(form.databaseFile, engine);
              setFileError(validation.valid ? null : validation.message ?? "Archivo no valido");
              setFileWarning(validation.warning ?? null);
            }
          }}
        >
          <option value="postgresql">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mariadb">MariaDB</option>
          <option value="sqlserver">SQL Server</option>
          <option value="oracle">Oracle</option>
          <option value="sqlite">SQLite</option>
          <option value="mongodb">MongoDB</option>
          <option value="excel">Excel / CSV</option>
        </select>
      </div>
    </div>

    <div>
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
            <div className="mt-1 text-xs text-zinc-500">{(form.databaseFile.size / 1024 / 1024).toFixed(2)} MB · {currentFormat.label}</div>
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
        <span className="mt-2 text-xs text-zinc-500">{currentFormat.label} · Maximo {maxDatabaseFileSizeMb()} MB</span>
      </button>}

      {form.databaseFile && <button type="button" className="btn-secondary mt-3 flex items-center gap-2" onClick={() => fileInput.current?.click()}>
        <Upload size={16} />Elegir otro archivo
      </button>}
      {detecting && <p className="mt-3 text-xs text-blue-400">Detectando modelo de base de datos...</p>}
      {fileError && <p className="mt-3 flex items-start gap-2 text-xs text-red-400">
        <AlertTriangle className="mt-0.5 shrink-0" size={14} />{fileError}
      </p>}
      {!fileError && fileWarning && <p className="mt-3 flex items-start gap-2 text-xs text-amber-400">
        <AlertTriangle className="mt-0.5 shrink-0" size={14} />{fileWarning}
      </p>}
      {!detecting && detection && <p className={`mt-3 text-xs ${detection.engine ? "text-emerald-400" : "text-amber-400"}`}>
        {detection.engine ? `Detectado automáticamente: ${displayEngine(detection.engine)}. ` : "No se pudo detectar automáticamente. "}
        <span className="text-zinc-500">{detection.reason}.</span>
      </p>}
    </div>

    <div className="rounded-button border border-line bg-[#0D0D0D] p-4 text-xs leading-5 text-zinc-500">
      Los archivos se normalizan internamente para interoperar entre tablas relacionales y colecciones documentales.
    </div>

    <div className="flex justify-end gap-3">
      <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
      <button disabled={submitDisabled} className="btn-primary">{busy ? "Importando..." : editing ? "Guardar cambios" : "Importar base de datos"}</button>
    </div>
  </form>;
}
