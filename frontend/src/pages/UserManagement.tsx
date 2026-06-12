import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Database, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import AdminStatsCards from "../components/AdminStatsCards";
import ToastNotification, { type ToastState } from "../components/ToastNotification";
import { api, type DbConfiguration, type User } from "../services/api";

interface AdminUser extends User { is_active?: boolean; last_login_at?: string; login_count?: number; created_at?: string }
interface Stats { total: number; new_last_7_days: number; active_today: number; recentActivity: AdminUser[] }

export default function UserManagement() {
  const navigate = useNavigate(); const [users, setUsers] = useState<AdminUser[]>([]); const [stats, setStats] = useState<Stats>();
  const [filters, setFilters] = useState({ search: "", role: "", active: "", last7Days: false }); const [toast, setToast] = useState<ToastState | null>(null);
  const [viewing, setViewing] = useState<{ user: AdminUser; configs: DbConfiguration[] } | null>(null);
  const notify = (type: "success" | "error", message: string) => { setToast({ type, message }); setTimeout(() => setToast(null), 4000); };
  const load = useCallback(async () => {
    const params = new URLSearchParams(); if (filters.search) params.set("search", filters.search); if (filters.role) params.set("role", filters.role); if (filters.active) params.set("active", filters.active); if (filters.last7Days) params.set("last7Days", "true");
    const [userResult, statsResult] = await Promise.all([api<{ users: AdminUser[] }>(`/admin/users?${params}`), api<Stats>("/admin/stats")]);
    setUsers(userResult.users); setStats(statsResult);
  }, [filters]);
  useEffect(() => { const timer = setTimeout(() => load().catch((e) => notify("error", e instanceof Error ? e.message : "Error")), 250); return () => clearTimeout(timer); }, [load]);
  const update = async (id: string, data: object) => { try { await api(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }); notify("success", "Usuario actualizado"); await load(); } catch (e) { notify("error", e instanceof Error ? e.message : "No se pudo actualizar"); } };
  const remove = async (user: AdminUser) => { if (!confirm(`¿Eliminar permanentemente a ${user.email}?`)) return; try { await api(`/admin/users/${user.id}`, { method: "DELETE" }); notify("success", "Usuario eliminado"); await load(); } catch (e) { notify("error", e instanceof Error ? e.message : "No se pudo eliminar"); } };
  const viewConfigs = async (user: AdminUser) => { try { const r = await api<{ configurations: DbConfiguration[] }>(`/admin/users/${user.id}/configurations`); setViewing({ user, configs: r.configurations }); } catch (e) { notify("error", e instanceof Error ? e.message : "No se pudieron cargar"); } };
  return <Layout>
    <button className="mb-6 flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-200" onClick={() => navigate("/dashboard")}><ArrowLeft size={16} />Volver al panel</button>
    <div className="mb-6"><h1 className="text-2xl font-semibold text-white">Administración</h1><p className="mt-1 text-sm text-zinc-500">Usuarios, actividad y permisos de la plataforma.</p></div>
    <AdminStatsCards stats={stats} />
    <section className="mt-6 card">
      <h2 className="mb-4 font-medium text-white">Actividad en los últimos 7 días</h2>
      <div className="flex flex-wrap gap-2">{stats?.recentActivity.length ? stats.recentActivity.map((u) => <span key={u.id} className="rounded-full border border-line bg-[#0D0D0D] px-3 py-1.5 text-xs text-zinc-400">{u.name} · {u.email}</span>) : <span className="text-sm text-zinc-600">Sin actividad reciente</span>}</div>
    </section>
    <section className="mt-6">
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_160px_160px_auto]"><div className="relative"><Search className="absolute left-3 top-3 text-zinc-600" size={16} /><input className="pl-10" placeholder="Buscar nombre o email" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></div>
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}><option value="">Todos los roles</option><option value="admin">Admin</option><option value="user">User</option></select>
        <select value={filters.active} onChange={(e) => setFilters({ ...filters, active: e.target.value })}><option value="">Todos los estados</option><option value="true">Activos</option><option value="false">Inactivos</option></select>
        <label className="flex items-center gap-2 rounded-button border border-line bg-panel px-3"><input className="h-4 w-4" type="checkbox" checked={filters.last7Days} onChange={(e) => setFilters({ ...filters, last7Days: e.target.checked })} />Últimos 7 días</label>
      </div>
      <div className="table-shell"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último login</th><th>Acciones</th></tr></thead><tbody>{users.map((user) => {
        const active = user.isActive ?? user.is_active ?? true; const lastLogin = user.lastLoginAt ?? user.last_login_at;
        return <tr key={user.id}><td><input className="mb-2 max-w-xs py-1.5" defaultValue={user.name} onBlur={(e) => e.target.value !== user.name && update(user.id, { name: e.target.value })} /><input className="max-w-xs py-1.5 text-xs" defaultValue={user.email} onBlur={(e) => e.target.value !== user.email && update(user.id, { email: e.target.value })} /></td>
          <td><select className="w-28 py-1.5" value={user.role} onChange={(e) => update(user.id, { role: e.target.value })}><option value="user">user</option><option value="admin">admin</option></select></td>
          <td><button onClick={() => update(user.id, { isActive: !active })} className={`rounded-full px-2.5 py-1 text-xs ${active ? "bg-emerald-950 text-emerald-300" : "bg-zinc-900 text-zinc-500"}`}>{active ? "Activo" : "Inactivo"}</button></td>
          <td className="text-zinc-500">{lastLogin ? new Date(lastLogin).toLocaleString() : "Nunca"}</td>
          <td><div className="flex gap-2"><button className="btn-secondary" title="Ver bases importadas" onClick={() => viewConfigs(user)}><Database size={15} /></button><button className="btn-danger" title="Eliminar" onClick={() => remove(user)}><Trash2 size={15} /></button></div></td></tr>;
      })}</tbody></table></div>
    </section>
    {viewing && <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4"><div className="w-full max-w-xl rounded-card border border-line bg-panel p-6"><h2 className="font-semibold text-white">Bases importadas de {viewing.user.name}</h2><p className="mt-1 text-xs text-zinc-500">Vista de solo lectura de los archivos del usuario.</p>
      <div className="mt-5 space-y-2">{viewing.configs.length ? viewing.configs.map((c) => <div key={c.id} className="flex items-center justify-between rounded-button border border-line bg-[#0D0D0D] p-3"><div><div className="text-sm text-zinc-300">{c.name}</div><div className="text-xs text-zinc-600">{String(c.options?.originalFileName ?? "Archivo importado")}</div></div><span className="text-xs uppercase text-blue-400">{c.engine}</span></div>) : <p className="text-sm text-zinc-600">Este usuario no tiene bases importadas.</p>}</div>
      <div className="mt-6 flex justify-end"><button className="btn-secondary" onClick={() => setViewing(null)}>Cerrar</button></div></div></div>}
    <ToastNotification toast={toast} onClose={() => setToast(null)} />
  </Layout>;
}
