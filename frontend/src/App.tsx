import { Navigate, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import UserManagement from "./pages/UserManagement";
import PrivateRoute from "./components/PrivateRoute";

export default function App() {
  return <Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route element={<PrivateRoute />}>
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/admin/users" element={<UserManagement />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
