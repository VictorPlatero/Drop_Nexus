import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function PrivateRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center text-zinc-400">Cargando sesión...</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (location.pathname.startsWith("/admin") && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
