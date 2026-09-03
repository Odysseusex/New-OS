"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Role, type CurrentUserDto } from "@bakery-os/shared";
import { api, ApiError } from "./api";

interface AuthContextValue {
  user: CurrentUserDto | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("bakery_token");
    if (!token) {
      setIsLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("bakery_token");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.login(email, password);
      localStorage.setItem("bakery_token", response.accessToken);
      setUser(response.user);
      // Cashier logins land straight on the till — see (app)/layout.tsx,
      // which also enforces this on every later navigation, not just here.
      router.push(response.user.role === Role.CASHIER ? "/pos" : "/dashboard");
    },
    [router],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("bakery_token");
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
