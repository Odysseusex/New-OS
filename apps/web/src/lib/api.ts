import type {
  CreateProductRequestDto,
  CreateSaleRequestDto,
  CreateStockMovementRequestDto,
  DashboardSummaryDto,
  LocationDto,
  LoginResponseDto,
  ProductDto,
  SaleDetailDto,
  SaleDto,
  SalesSummaryDto,
  StockLevelDto,
  StockMovementDto,
} from "@bakery-os/shared";

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

function withQuery(path: string, params: Record<string, string | undefined>) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponseDto>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<LoginResponseDto["user"]>("/auth/me"),
  dashboardSummary: () => request<DashboardSummaryDto>("/dashboard/summary"),
  locations: {
    list: () => request<LocationDto[]>("/locations"),
  },

  products: {
    list: () => request<ProductDto[]>("/products"),
    create: (dto: CreateProductRequestDto) =>
      request<ProductDto>("/products", { method: "POST", body: JSON.stringify(dto) }),
  },

  inventory: {
    stockLevels: (locationId?: string) =>
      request<StockLevelDto[]>(withQuery("/inventory/stock-levels", { locationId })),
    movements: (locationId?: string) =>
      request<StockMovementDto[]>(withQuery("/inventory/movements", { locationId })),
    receive: (dto: CreateStockMovementRequestDto) =>
      request<StockMovementDto>("/inventory/receipts", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    writeOff: (dto: CreateStockMovementRequestDto) =>
      request<StockMovementDto>("/inventory/write-offs", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
  },

  sales: {
    list: (locationId?: string) => request<SaleDto[]>(withQuery("/sales", { locationId })),
    summary: (locationId?: string) =>
      request<SalesSummaryDto>(withQuery("/sales/summary", { locationId })),
    create: (dto: CreateSaleRequestDto) =>
      request<SaleDetailDto>("/sales", { method: "POST", body: JSON.stringify(dto) }),
  },
};
