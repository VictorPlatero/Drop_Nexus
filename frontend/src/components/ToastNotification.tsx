import { CheckCircle2, XCircle, X } from "lucide-react";

export interface ToastState { type: "success" | "error"; message: string }
export default function ToastNotification({ toast, onClose }: { toast: ToastState | null; onClose(): void }) {
  if (!toast) return null;
  return <div className={`fixed right-5 top-5 z-50 flex max-w-sm items-center gap-3 rounded-button border px-4 py-3 shadow-xl ${toast.type === "success" ? "border-emerald-900 bg-emerald-950 text-emerald-200" : "border-red-900 bg-red-950 text-red-200"}`}>
    {toast.type === "success" ? <CheckCircle2 size={19} /> : <XCircle size={19} />}
    <span className="text-sm">{toast.message}</span>
    <button onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
  </div>;
}
