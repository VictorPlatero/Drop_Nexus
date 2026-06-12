import { CalendarPlus, LogIn, Users } from "lucide-react";

export default function AdminStatsCards({ stats }: { stats?: { total: number; new_last_7_days: number; active_today: number } }) {
  const cards = [
    { label: "Total usuarios", value: stats?.total ?? 0, icon: Users },
    { label: "Nuevos últimos 7 días", value: stats?.new_last_7_days ?? 0, icon: CalendarPlus },
    { label: "Activos hoy", value: stats?.active_today ?? 0, icon: LogIn }
  ];
  return <div className="grid gap-4 md:grid-cols-3">{cards.map(({ label, value, icon: Icon }) => <article className="card" key={label}><div className="flex items-start justify-between"><div><p className="text-sm text-zinc-500">{label}</p><p className="mt-3 text-3xl font-semibold tabular-nums text-white">{value}</p></div><div className="grid h-10 w-10 place-items-center rounded-button bg-blue-950 text-blue-400"><Icon size={19} /></div></div></article>)}</div>;
}
