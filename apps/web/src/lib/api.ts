import type { DashboardSummaryDto, LoginResponseDto } from "@bakery-os/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("bakery_token") : null;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `Ошибка запроса: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponseDto>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<LoginResponseDto["user"]>("/auth/me"),
  dashboardSummary: () => request<DashboardSummaryDto>("/dashboard/summary"),
};
