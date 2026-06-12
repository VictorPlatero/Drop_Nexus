import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Database } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

export default function Login() {
  const { user, login } = useAuth(); const navigate = useNavigate();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/dashboard" replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await login(email, password); navigate("/dashboard"); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo iniciar sesión"); } finally { setBusy(false); }
  };
  return <AuthShell title="Bienvenido de nuevo" subtitle="Ingresa tus credenciales para continuar.">
    <form className="space-y-4" onSubmit={submit}>
      <div><label>Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
      <div><label>Contraseña</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button disabled={busy} className="btn-primary w-full">{busy ? "Ingresando..." : "Ingresar"}</button>
      <p className="text-center text-sm text-zinc-500">¿No tienes cuenta? <Link className="text-blue-400 hover:text-blue-300" to="/register">Regístrate</Link></p>
    </form>
  </AuthShell>;
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center px-5"><div className="w-full max-w-md">
    <Link to="/" className="mb-8 flex items-center justify-center gap-3 text-white"><div className="grid h-10 w-10 place-items-center rounded-button bg-accent"><Database size={19} /></div><span className="font-semibold">Database Nexus</span></Link>
    <div className="card"><h1 className="text-2xl font-semibold text-white">{title}</h1><p className="mb-7 mt-2 text-sm text-zinc-500">{subtitle}</p>{children}</div>
  </div></main>;
}
