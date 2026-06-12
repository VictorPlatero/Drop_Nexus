import type { ReactNode } from "react";
import Sidebar, { type DashboardSection } from "./Sidebar";

export default function Layout({ children, section = "replication", onSection = () => undefined }: { children: ReactNode; section?: DashboardSection; onSection?(section: DashboardSection): void }) {
  return <div className="min-h-screen bg-canvas">
    <Sidebar active={section} onNavigate={onSection} />
    <main className="min-h-screen md:ml-64">
      <div className="mx-auto max-w-[1500px] px-5 py-6 md:px-8 md:py-8">{children}</div>
    </main>
  </div>;
}
