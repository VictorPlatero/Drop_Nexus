import { Database, LogOut, Repeat2, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export type DashboardSection = "replication" | "configurations";
export default function Sidebar({ active, onNavigate }: { active: DashboardSection; onNavigate(section: DashboardSection): void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = [
    { id: "replication" as const, label: "Replicador", icon: Repeat2 },
    { id: "configurations" as const, label: "Bases de datos", icon: Database }
  ];
  return <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-panel/95 md:flex">
    <div className="border-b border-line px-6 py-6">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-button border border-blue-400/30 bg-blue-600/15 text-blue-300"><Repeat2 size={19} /></div>
        <div><div className="font-semibold text-white">Database Nexus</div><div className="text-xs text-zinc-500">Data Replicator</div></div>
      </div>
    </div>
    <nav className="flex-1 space-y-1 p-3">
      {items.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { onNavigate(id); navigate("/dashboard"); }}
        className={`flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-left text-sm ${active === id ? "border border-blue-500/20 bg-blue-600/15 text-blue-300" : "border border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}>
        <Icon size={18} />{label}
      </button>)}
      {user?.role === "admin" && <button onClick={() => navigate("/admin/users")} className="flex w-full items-center gap-3 rounded-button px-3 py-2.5 text-left text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"><Users size={18} />Administración</button>}
    </nav>
    <div className="border-t border-line p-4">
      <div className="mb-3 min-w-0"><div className="truncate text-sm font-medium text-zinc-200">{user?.name}</div><div className="truncate text-xs text-zinc-500">{user?.email}</div></div>
      <button onClick={() => { logout(); navigate("/"); }} className="flex w-full items-center gap-2 text-sm text-zinc-500 hover:text-zinc-200"><LogOut size={16} />Cerrar sesión</button>
    </div>
  </aside>;
}
