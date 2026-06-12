import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { AuthShell } from "./Login";

export default function Register() {
  const { user, register } = useAuth(); const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await register(form.name, form.email, form.password); navigate("/dashboard"); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear la cuenta"); } finally { setBusy(false); }
  };
  return <AuthShell title="Crea tu cuenta" subtitle="Empieza a gestionar tus flujos de datos.">
    <form className="space-y-4" onSubmit={submit}>
      <div><label>Nombre</label><input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div><label>Email</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
      <div><label>Contraseña</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><p className="mt-1 text-xs text-zinc-600">Mínimo 6 caracteres</p></div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button disabled={busy} className="btn-primary w-full">{busy ? "Creando..." : "Crear cuenta"}</button>
      <p className="text-center text-sm text-zinc-500">¿Ya tienes cuenta? <Link className="text-blue-400" to="/login">Ingresa</Link></p>
    </form>
  </AuthShell>;
}
