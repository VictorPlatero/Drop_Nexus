import { Activity, ArrowRight, BookOpen, Database, Repeat2, ShieldCheck } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function Landing() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;
  const features = [
    { icon: Repeat2, title: "Replicación multi-motor", text: "Mueve datos entre PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite y MongoDB." },
    { icon: Activity, title: "Integridad inteligente", text: "Detecta corrupción, inconsistencias, claves duplicadas y ajustes recomendados." },
    { icon: BookOpen, title: "Datos documentados", text: "Explora esquemas y contenido real. Exporta en Excel, CSV o JSON." }
  ];
  return <main className="min-h-screen bg-canvas">
    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
      <div className="flex items-center gap-3 text-white"><div className="grid h-9 w-9 place-items-center rounded-button bg-accent"><Database size={18} /></div><span className="font-semibold">Database Nexus</span></div>
      <div className="flex gap-3"><Link className="btn-secondary" to="/login">Ingresar</Link><Link className="btn-primary" to="/register">Crear cuenta</Link></div>
    </header>
    <section className="mx-auto max-w-5xl px-6 pb-24 pt-24 text-center">
      <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-4 py-2 text-xs text-zinc-400"><ShieldCheck size={14} className="text-blue-400" />Inteligencia e integridad para tus bases de datos</div>
      <h1 className="text-4xl font-semibold tracking-tight text-white md:text-6xl">Replica, inspecciona y protege<br />tus datos desde un solo lugar.</h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-400">Importa bases desde tu computadora, valida su integridad y supervisa cada transferencia desde una consola centralizada.</p>
      <Link to="/register" className="btn-primary mt-9 inline-flex items-center gap-2">Comenzar ahora <ArrowRight size={17} /></Link>
    </section>
    <section className="mx-auto grid max-w-7xl gap-4 px-6 pb-20 md:grid-cols-3">
      {features.map(({ icon: Icon, title, text }) => <article className="card" key={title}><Icon className="mb-5 text-blue-400" size={24} /><h2 className="mb-2 font-semibold text-white">{title}</h2><p className="text-sm leading-6 text-zinc-500">{text}</p></article>)}
    </section>
  </main>;
}
