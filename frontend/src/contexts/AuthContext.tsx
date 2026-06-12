import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "../services/api";

interface AuthContextValue {
  user: User | null; loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): void;
}
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!localStorage.getItem("token")) { setLoading(false); return; }
    api<{ user: User }>("/auth/me").then((result) => setUser(result.user)).catch(() => localStorage.removeItem("token")).finally(() => setLoading(false));
  }, []);
  const authenticate = async (path: string, body: object) => {
    const result = await api<{ user: User; token: string }>(path, { method: "POST", body: JSON.stringify(body) });
    localStorage.setItem("token", result.token); setUser(result.user);
  };
  return <AuthContext.Provider value={{
    user, loading,
    login: (email, password) => authenticate("/auth/login", { email, password }),
    register: (name, email, password) => authenticate("/auth/register", { name, email, password }),
    logout: () => { localStorage.removeItem("token"); setUser(null); }
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
