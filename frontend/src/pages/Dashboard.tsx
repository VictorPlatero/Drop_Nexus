import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout";
import type { DashboardSection } from "../components/Sidebar";
import ConfigurationsList from "../components/ConfigurationsList";
import ReplicationPanel from "../components/ReplicationPanel";
import HealthMonitor from "../components/HealthMonitor";
import SchemaDocumenter from "../components/SchemaDocumenter";
import ToastNotification, { type ToastState } from "../components/ToastNotification";
import { api, type DbConfiguration } from "../services/api";

export default function Dashboard() {
  const [section, setSection] = useState<DashboardSection>("replication");
  const [configurations, setConfigurations] = useState<DbConfiguration[]>([]);
  const [toast, setToast] = useState<ToastState | null>(null);
  const refresh = useCallback(async () => { const result = await api<{ configurations: DbConfiguration[] }>("/configurations"); setConfigurations(result.configurations); }, []);
  useEffect(() => { refresh().catch((e) => notify("error", e instanceof Error ? e.message : "No se cargaron las bases importadas")); }, [refresh]);
  const notify = (type: "success" | "error", message: string) => { setToast({ type, message }); window.setTimeout(() => setToast(null), 4000); };
  return <Layout section={section} onSection={setSection}>
    {section === "replication" && <ReplicationPanel configurations={configurations} refreshConfigurations={refresh} notify={notify} />}
    {section === "configurations" && <ConfigurationsList configurations={configurations} refresh={refresh} notify={notify} />}
    {section === "health" && <HealthMonitor />}
    {section === "schema" && <SchemaDocumenter configurations={configurations} notify={notify} />}
    <ToastNotification toast={toast} onClose={() => setToast(null)} />
  </Layout>;
}
