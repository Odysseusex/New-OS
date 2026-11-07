import type {
  ClubInfoDto,
  ClubLoginStatusDto,
  ClubProfileDto,
  StartClubLoginDto,
  StartClubLoginRequestDto,
} from "@bakery-os/shared";

// The customer app's own client: its own token (never the staff one), its own
// storage keys. Every storage access is guarded — a private window may refuse.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
const TOKEN_KEY = "aa.club.token";
const PENDING_KEY = "aa.club.pending";

export class ClubApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the session simply lasts as long as the page.
  }
}

export const clubToken = {
  get: () => read(TOKEN_KEY),
  set: (token: string | null) => write(TOKEN_KEY, token),
};

export type PendingLogin = StartClubLoginDto & { phone: string };

export const pendingLogin = {
  get(): PendingLogin | null {
    const raw = read(PENDING_KEY);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as PendingLogin;
      return new Date(value.expiresAt).getTime() > Date.now() ? value : null;
    } catch {
      return null;
    }
  },
  set: (value: PendingLogin | null) => write(PENDING_KEY, value ? JSON.stringify(value) : null),
};

async function request<T>(path: string, init: RequestInit = {}, withToken = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = withToken ? clubToken.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    throw new ClubApiError("Нет связи. Проверьте интернет и попробуйте ещё раз.", 0);
  }
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message = (body as { message?: string | string[] } | null)?.message;
    throw new ClubApiError(Array.isArray(message) ? message[0] : message || "Что-то пошло не так. Попробуйте ещё раз.", res.status);
  }
  return body as T;
}

export const clubApi = {
  info: () => request<ClubInfoDto>("/club/info"),
  startLogin: (dto: StartClubLoginRequestDto) => request<StartClubLoginDto>("/club/login", { method: "POST", body: JSON.stringify(dto) }),
  loginStatus: (id: string, secret: string) =>
    request<ClubLoginStatusDto>(`/club/login/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ secret }) }),
  me: () => request<ClubProfileDto>("/club/me", {}, true),
  rename: (name: string) => request<{ name: string | null }>("/club/me", { method: "PATCH", body: JSON.stringify({ name }) }, true),
  logout: () => request<{ loggedOut: true }>("/club/logout", { method: "POST" }, true),
};
