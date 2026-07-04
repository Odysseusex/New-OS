import type {
  CompleteProductionBatchRequestDto,
  CreateDeliveryRouteRequestDto,
  CreateProductionBatchRequestDto,
  CreateProductRequestDto,
  CreatePurchaseOrderRequestDto,
  CreateRecipeRequestDto,
  CreateSaleRequestDto,
  CreateStockMovementRequestDto,
  CreateSupplierRequestDto,
  CreateVehicleRequestDto,
  DashboardSummaryDto,
  DeliveryRouteDto,
  DriverDto,
  LocationDto,
  LocationOverviewDto,
  LoginResponseDto,
  ProductDto,
  ProductionBatchDto,
  PurchaseOrderDto,
  RecipeDto,
  SaleDetailDto,
  SaleDto,
  SalesSummaryDto,
  StockLevelDto,
  StockMovementDto,
  SupplierDto,
  VehicleDto,
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
    overview: () => request<LocationOverviewDto[]>("/locations/overview"),
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

  recipes: {
    list: () => request<RecipeDto[]>("/recipes"),
    create: (dto: CreateRecipeRequestDto) =>
      request<RecipeDto>("/recipes", { method: "POST", body: JSON.stringify(dto) }),
  },

  production: {
    batches: (locationId?: string) =>
      request<ProductionBatchDto[]>(withQuery("/production/batches", { locationId })),
    createBatch: (dto: CreateProductionBatchRequestDto) =>
      request<ProductionBatchDto>("/production/batches", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    completeBatch: (id: string, dto: CompleteProductionBatchRequestDto) =>
      request<ProductionBatchDto>(`/production/batches/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    cancelBatch: (id: string) =>
      request<ProductionBatchDto>(`/production/batches/${id}/cancel`, { method: "POST" }),
  },

  suppliers: {
    list: () => request<SupplierDto[]>("/suppliers"),
    create: (dto: CreateSupplierRequestDto) =>
      request<SupplierDto>("/suppliers", { method: "POST", body: JSON.stringify(dto) }),
  },

  procurement: {
    orders: (locationId?: string) =>
      request<PurchaseOrderDto[]>(withQuery("/procurement/orders", { locationId })),
    createOrder: (dto: CreatePurchaseOrderRequestDto) =>
      request<PurchaseOrderDto>("/procurement/orders", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    receiveOrder: (id: string) =>
      request<PurchaseOrderDto>(`/procurement/orders/${id}/receive`, { method: "POST" }),
    cancelOrder: (id: string) =>
      request<PurchaseOrderDto>(`/procurement/orders/${id}/cancel`, { method: "POST" }),
  },

  vehicles: {
    list: () => request<VehicleDto[]>("/vehicles"),
    create: (dto: CreateVehicleRequestDto) =>
      request<VehicleDto>("/vehicles", { method: "POST", body: JSON.stringify(dto) }),
  },

  logistics: {
    routes: () => request<DeliveryRouteDto[]>("/logistics/routes"),
    drivers: () => request<DriverDto[]>("/logistics/drivers"),
    createRoute: (dto: CreateDeliveryRouteRequestDto) =>
      request<DeliveryRouteDto>("/logistics/routes", { method: "POST", body: JSON.stringify(dto) }),
    deliverStop: (routeId: string, stopId: string) =>
      request<DeliveryRouteDto>(`/logistics/routes/${routeId}/stops/${stopId}/deliver`, {
        method: "POST",
      }),
    cancelRoute: (routeId: string) =>
      request<DeliveryRouteDto>(`/logistics/routes/${routeId}/cancel`, { method: "POST" }),
  },
};
