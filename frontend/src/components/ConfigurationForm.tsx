import { useEffect, useRef, useState, type FormEvent } from "react";
import { Database, Upload, X } from "lucide-react";
import type { DbConfiguration } from "../services/api";
import { detectDatabaseEngine, displayEngine, type DetectionResult } from "../utils/databaseFileDetector";

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
  sqlserver: { accept: ".sql,text/plain", label: "Script SQL de SQL Server (.sql)" },
  oracle: { accept: ".sql,text/plain", label: "Script SQL de Oracle (.sql)" },
  sqlite: { accept: ".db,.sqlite,.sqlite3,application/vnd.sqlite3", label: "Base SQLite (.db, .sqlite, .sqlite3)" },
  mongodb: { accept: ".json,.ndjson,application/json", label: "Exportación MongoDB (.json, .ndjson)" }
};

const empty: ConfigurationPayload = {
  name: "",
  engine: "postgresql",
  options: {}
};

const allSupportedFormats = ".sql,.db,.sqlite,.sqlite3,.json,.ndjson,text/plain,application/json,application/vnd.sqlite3";

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
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(editing ? {
      name: editing.name,
      engine: editing.engine,
      options: editing.options ?? {}
    } : empty);
  }, [editing]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(form);
    } finally {
      setBusy(false);
    }
  };

  const currentFormat = formats[form.engine]!;

  return <form className="card space-y-5" onSubmit={submit}>
    <div>
      <h2 className="font-semibold text-white">{editing ? "Editar base de datos" : "Agregar base de datos"}</h2>
      <p className="mt-1 text-sm text-zinc-500">La base se importa desde un archivo de tu computadora.</p>
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
          onChange={(event) => {
            setForm({ ...form, engine: event.target.value });
            setDetection(null);
          }}
        >
          <option value="postgresql">PostgreSQL</option>
          <option value="mysql">MySQL</option>
          <option value="mariadb">MariaDB</option>
          <option value="sqlserver">SQL Server</option>
          <option value="oracle">Oracle</option>
          <option value="sqlite">SQLite</option>
          <option value="mongodb">MongoDB</option>
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
            try {
              const detected = await detectDatabaseEngine(file);
              setDetection(detected);
              setForm({
                ...form,
                engine: detected.engine ?? form.engine,
                name: form.name || file.name.replace(/\.(sql|db|sqlite|sqlite3|json|ndjson)$/i, ""),
                databaseFile: file
              });
            } finally {
              setDetecting(false);
            }
          }
        }}
      />

      {form.databaseFile ? <div className="flex items-center justify-between rounded-button border border-blue-900 bg-blue-950/30 p-4">
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
        <span className="mt-2 text-xs text-zinc-500">{currentFormat.label} · Máximo 100 MB</span>
      </button>}

      {form.databaseFile && <button type="button" className="btn-secondary mt-3 flex items-center gap-2" onClick={() => fileInput.current?.click()}>
        <Upload size={16} />Elegir otro archivo
      </button>}
      {detecting && <p className="mt-3 text-xs text-blue-400">Detectando modelo de base de datos...</p>}
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
      <button disabled={busy} className="btn-primary">{busy ? "Importando..." : editing ? "Guardar cambios" : "Importar base de datos"}</button>
    </div>
  </form>;
}
