import { AlertTriangle, X } from "lucide-react";

export default function ReplicationConfirmModal({ sql, busy, onConfirm, onCancel }: { sql: string; busy: boolean; onConfirm(): void; onCancel(): void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
    <div className="w-full max-w-2xl rounded-card border border-line bg-panel p-6 shadow-2xl">
      <div className="flex items-start justify-between"><div className="flex gap-3"><div className="grid h-10 w-10 place-items-center rounded-button bg-amber-950 text-amber-400"><AlertTriangle size={20} /></div>
        <div><h2 className="font-semibold text-white">La tabla no existe</h2><p className="mt-1 text-sm text-zinc-400">¿Crearla automáticamente antes de replicar?</p></div></div>
        <button onClick={onCancel} className="text-zinc-500 hover:text-white"><X size={20} /></button>
      </div>
      <div className="mt-6"><label>Sentencia de creación generada</label><pre className="max-h-80 overflow-auto rounded-button border border-line bg-[#090909] p-4 text-xs leading-6 text-blue-300">{sql}</pre></div>
      <p className="mt-4 text-xs leading-5 text-zinc-500">Revisa el mapeo de tipos. Las claves foráneas se documentan, pero no se recrean para evitar dependencias externas incompletas.</p>
      <div className="mt-6 flex justify-end gap-3"><button className="btn-secondary" onClick={onCancel}>Cancelar</button><button disabled={busy} className="btn-primary" onClick={onConfirm}>{busy ? "Creando..." : "Crear y replicar"}</button></div>
    </div>
  </div>;
}
