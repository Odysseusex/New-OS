import type {
  AddEmployeeCompensationRequestDto,
  AdjustStockRequestDto,
  AiExecutiveSummaryDto,
  AiInsightsResponseDto,
  AiLocationDeviationResponseDto,
  BreakEvenDto,
  CancelProductionBatchRequestDto,
  CashAccountDto,
  CashAdjustmentRequestDto,
  CashDepositRequestDto,
  CashMovementDto,
  CashTransferRequestDto,
  CashWithdrawalRequestDto,
  CategoryDto,
  ClockInForRequestDto,
  ClockInRequestDto,
  CompleteProductionBatchRequestDto,
  CostBehavior,
  CreateCashAccountRequestDto,
  CreateCategoryRequestDto,
  CreateCustomerRequestDto,
  CreateDeliveryRouteRequestDto,
  CreateEmployeeRequestDto,
  CreateExpenseRequestDto,
  CreateFinanceCategoryRequestDto,
  CreateInvoiceRequestDto,
  CreatePlannedFixedCostRequestDto,
  CreateProductionBatchRequestDto,
  CreateProductRequestDto,
  CreatePurchaseOrderRequestDto,
  CreateRecipeRequestDto,
  CreateRecipeStageTypeRequestDto,
  CreateSaleRequestDto,
  CreateShiftRequestDto,
  CreateStockMovementRequestDto,
  CreateSupplierRequestDto,
  CreateUserAccountRequestDto,
  CreateVehicleRequestDto,
  CreateLocationRequestDto,
  CustomerDetailDto,
  CustomerDto,
  DashboardSummaryDto,
  DeliveryRouteDto,
  DismissAiInsightResponseDto,
  DriverDto,
  EmployeeCompensationDto,
  EmployeeDto,
  ExpenseDto,
  FinanceCategoryDto,
  FinanceCategoryKind,
  FinanceDashboardDto,
  FinanceSetupStatusDto,
  InventoryValuationDto,
  HrKpiResponseDto,
  InvoiceDto,
  LocationComparisonDto,
  LocationDto,
  LocationOverviewDto,
  LoginResponseDto,
  NotificationDto,
  PlannedBreakEvenDto,
  PlannedFixedCostDto,
  ProductDto,
  ProductionBatchDto,
  ProfitAndLossDto,
  PurchaseOrderDto,
  QualitySummaryDto,
  RecipeDto,
  RecipeStageTypeDto,
  ReconcileInvoicesRequestDto,
  RecordExpensePaymentRequestDto,
  RecordPaymentRequestDto,
  RecordSupplierPaymentRequestDto,
  RegionDto,
  SaleDetailDto,
  SaleDto,
  SalesCustomerTrendDto,
  SalesDemandAnalysisDto,
  SalesReportDto,
  SalesSummaryDto,
  ShiftDto,
  StockLevelDto,
  StockMovementDto,
  SupplierDto,
  TelegramLinkTokenDto,
  TelegramStatusDto,
  TimeEntryDto,
  UpdateCashAccountRequestDto,
  UpdateCategoryRequestDto,
  UpdateCustomerRequestDto,
  UpdateEmployeeRequestDto,
  UpdateFinanceCategoryRequestDto,
  UpdateLocationRequestDto,
  UpdateProductionBatchRequestDto,
  UpdateProductRequestDto,
  UpdateRecipeRequestDto,
  UpdateSupplierRequestDto,
  UpdateUserAccountRequestDto,
  UpdateVehicleRequestDto,
  UserAccountDto,
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
    list: (includeArchived?: boolean) =>
      request<LocationDto[]>(withQuery("/locations", { includeArchived: includeArchived ? "true" : undefined })),
    overview: () => request<LocationOverviewDto[]>("/locations/overview"),
    regions: () => request<RegionDto[]>("/locations/regions"),
    comparison: (from: string, to: string) =>
      request<LocationComparisonDto[]>(withQuery("/locations/comparison", { from, to })),
    create: (dto: CreateLocationRequestDto) =>
      request<LocationDto>("/locations", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateLocationRequestDto) =>
      request<LocationDto>(`/locations/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<LocationDto>(`/locations/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<LocationDto>(`/locations/${id}/restore`, { method: "POST" }),
    remove: (id: string) => request<{ deleted: true }>(`/locations/${id}`, { method: "DELETE" }),
  },

  products: {
    list: (includeArchived?: boolean) =>
      request<ProductDto[]>(withQuery("/products", { includeArchived: includeArchived ? "true" : undefined })),
    create: (dto: CreateProductRequestDto) =>
      request<ProductDto>("/products", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateProductRequestDto) =>
      request<ProductDto>(`/products/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<ProductDto>(`/products/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<ProductDto>(`/products/${id}/restore`, { method: "POST" }),
    remove: (id: string) => request<{ deleted: true }>(`/products/${id}`, { method: "DELETE" }),
    forceRemove: (id: string) => request<{ deleted: true }>(`/products/${id}/force`, { method: "DELETE" }),
  },

  categories: {
    list: (includeArchived?: boolean) =>
      request<CategoryDto[]>(withQuery("/categories", { includeArchived: includeArchived ? "true" : undefined })),
    create: (dto: CreateCategoryRequestDto) =>
      request<CategoryDto>("/categories", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateCategoryRequestDto) =>
      request<CategoryDto>(`/categories/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<CategoryDto>(`/categories/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<CategoryDto>(`/categories/${id}/restore`, { method: "POST" }),
    remove: (id: string) => request<{ deleted: true }>(`/categories/${id}`, { method: "DELETE" }),
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
    adjust: (dto: AdjustStockRequestDto) =>
      request<StockMovementDto>("/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
  },

  quality: {
    writeOffs: (locationId?: string, from?: string, to?: string) =>
      request<StockMovementDto[]>(withQuery("/quality/write-offs", { locationId, from, to })),
    summary: (from: string, to: string, locationId?: string) =>
      request<QualitySummaryDto>(withQuery("/quality/summary", { from, to, locationId })),
  },

  notifications: {
    list: () => request<NotificationDto[]>("/notifications"),
    dismiss: (key: string) =>
      request<{ dismissed: true }>(`/notifications/${encodeURIComponent(key)}/dismiss`, { method: "POST" }),
    dismissAll: () => request<{ dismissed: true }>("/notifications/dismiss-all", { method: "POST" }),
  },

  sales: {
    list: (locationId?: string, limit?: number, offset?: number) =>
      request<SaleDto[]>(
        withQuery("/sales", {
          locationId,
          limit: limit ? String(limit) : undefined,
          offset: offset ? String(offset) : undefined,
        }),
      ),
    summary: (locationId?: string) =>
      request<SalesSummaryDto>(withQuery("/sales/summary", { locationId })),
    report: (from: string, to: string, locationId?: string) =>
      request<SalesReportDto>(withQuery("/sales/report", { from, to, locationId })),
    demand: (
      from: string,
      to: string,
      opts?: { locationId?: string; customerId?: string; categoryId?: string; productId?: string },
    ) =>
      request<SalesDemandAnalysisDto>(
        withQuery("/sales/demand", {
          from,
          to,
          locationId: opts?.locationId,
          customerId: opts?.customerId,
          categoryId: opts?.categoryId,
          productId: opts?.productId,
        }),
      ),
    customerTrend: (customerId: string, from: string, to: string, locationId?: string) =>
      request<SalesCustomerTrendDto>(
        withQuery("/sales/customer-trend", { customerId, from, to, locationId }),
      ),
    findOne: (id: string) => request<SaleDetailDto>(`/sales/${id}`),
    create: (dto: CreateSaleRequestDto) =>
      request<SaleDetailDto>("/sales", { method: "POST", body: JSON.stringify(dto) }),
    recordPayment: (id: string, dto: RecordPaymentRequestDto) =>
      request<SaleDetailDto>(`/sales/${id}/record-payment`, {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    payments: (id: string) => request<CashMovementDto[]>(`/sales/${id}/payments`),
  },

  customers: {
    list: (includeArchived?: boolean) =>
      request<CustomerDto[]>(withQuery("/customers", { includeArchived: includeArchived ? "true" : undefined })),
    findOne: (id: string) => request<CustomerDetailDto>(`/customers/${id}`),
    create: (dto: CreateCustomerRequestDto) =>
      request<CustomerDto>("/customers", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateCustomerRequestDto) =>
      request<CustomerDto>(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<CustomerDto>(`/customers/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<CustomerDto>(`/customers/${id}/restore`, { method: "POST" }),
    remove: (id: string) => request<{ deleted: true }>(`/customers/${id}`, { method: "DELETE" }),
  },

  recipes: {
    list: (includeArchived?: boolean) =>
      request<RecipeDto[]>(withQuery("/recipes", { includeArchived: includeArchived ? "true" : undefined })),
    create: (dto: CreateRecipeRequestDto) =>
      request<RecipeDto>("/recipes", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateRecipeRequestDto) =>
      request<RecipeDto>(`/recipes/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<RecipeDto>(`/recipes/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<RecipeDto>(`/recipes/${id}/restore`, { method: "POST" }),
    remove: (id: string) => request<{ deleted: true }>(`/recipes/${id}`, { method: "DELETE" }),
  },

  recipeStageTypes: {
    list: () => request<RecipeStageTypeDto[]>("/recipe-stage-types"),
    create: (dto: CreateRecipeStageTypeRequestDto) =>
      request<RecipeStageTypeDto>("/recipe-stage-types", { method: "POST", body: JSON.stringify(dto) }),
  },

  production: {
    batches: (locationId?: string) =>
      request<ProductionBatchDto[]>(withQuery("/production/batches", { locationId })),
    createBatch: (dto: CreateProductionBatchRequestDto) =>
      request<ProductionBatchDto>("/production/batches", {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    updateBatch: (id: string, dto: UpdateProductionBatchRequestDto) =>
      request<ProductionBatchDto>(`/production/batches/${id}`, {
        method: "PATCH",
        body: JSON.stringify(dto),
      }),
    deleteBatch: (id: string) =>
      request<{ deleted: true }>(`/production/batches/${id}`, { method: "DELETE" }),
    startBatch: (id: string) =>
      request<ProductionBatchDto>(`/production/batches/${id}/start`, { method: "POST" }),
    completeBatch: (id: string, dto: CompleteProductionBatchRequestDto) =>
      request<ProductionBatchDto>(`/production/batches/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(dto),
      }),
    cancelBatch: (id: string, dto: CancelProductionBatchRequestDto = {}) =>
      request<ProductionBatchDto>(`/production/batches/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify(dto),
      }),
  },

  suppliers: {
    list: (includeArchived?: boolean) =>
      request<SupplierDto[]>(withQuery("/suppliers", { includeArchived: includeArchived ? "true" : undefined })),
    create: (dto: CreateSupplierRequestDto) =>
      request<SupplierDto>("/suppliers", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateSupplierRequestDto) =>
      request<SupplierDto>(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<SupplierDto>(`/suppliers/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<SupplierDto>(`/suppliers/${id}/restore`, { method: "POST" }),
    remove: (id: string) => request<{ deleted: true }>(`/suppliers/${id}`, { method: "DELETE" }),
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

  invoices: {
    list: (locationId?: string) => request<InvoiceDto[]>(withQuery("/invoices", { locationId })),
    create: (dto: CreateInvoiceRequestDto) =>
      request<InvoiceDto>("/invoices", { method: "POST", body: JSON.stringify(dto) }),
    confirm: (id: string) => request<InvoiceDto>(`/invoices/${id}/confirm`, { method: "POST" }),
    cancel: (id: string) => request<InvoiceDto>(`/invoices/${id}/cancel`, { method: "POST" }),
    recordPayment: (id: string, dto: RecordSupplierPaymentRequestDto) =>
      request<InvoiceDto>(`/invoices/${id}/payments`, { method: "POST", body: JSON.stringify(dto) }),
  },

  vehicles: {
    list: (includeArchived?: boolean) =>
      request<VehicleDto[]>(withQuery("/vehicles", { includeArchived: includeArchived ? "true" : undefined })),
    create: (dto: CreateVehicleRequestDto) =>
      request<VehicleDto>("/vehicles", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateVehicleRequestDto) =>
      request<VehicleDto>(`/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<VehicleDto>(`/vehicles/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<VehicleDto>(`/vehicles/${id}/restore`, { method: "POST" }),
    remove: (id: string) => request<{ deleted: true }>(`/vehicles/${id}`, { method: "DELETE" }),
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

  users: {
    list: (includeArchived?: boolean) =>
      request<UserAccountDto[]>(withQuery("/users", { includeArchived: includeArchived ? "true" : undefined })),
    create: (dto: CreateUserAccountRequestDto) =>
      request<UserAccountDto>("/users", { method: "POST", body: JSON.stringify(dto) }),
    update: (id: string, dto: UpdateUserAccountRequestDto) =>
      request<UserAccountDto>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
    archive: (id: string) => request<UserAccountDto>(`/users/${id}/archive`, { method: "POST" }),
    restore: (id: string) => request<UserAccountDto>(`/users/${id}/restore`, { method: "POST" }),
  },

  finance: {
    dashboard: (from?: string, to?: string) =>
      request<FinanceDashboardDto>(withQuery("/finance/dashboard", { from, to })),
    inventoryValuation: () => request<InventoryValuationDto>("/finance/inventory-valuation"),
    pnl: (from: string, to: string, locationId?: string) =>
      request<ProfitAndLossDto>(withQuery("/finance/pnl", { from, to, locationId })),
    breakEven: (from: string, to: string, locationId?: string) =>
      request<BreakEvenDto>(withQuery("/finance/break-even", { from, to, locationId })),
    plannedBreakEven: (from: string, to: string, locationId?: string) =>
      request<PlannedBreakEvenDto>(withQuery("/finance/break-even/planned", { from, to, locationId })),
    plannedFixedCosts: {
      list: (includeHistory?: boolean) =>
        request<PlannedFixedCostDto[]>(
          withQuery("/finance/planned-fixed-costs", { includeHistory: includeHistory ? "true" : undefined }),
        ),
      create: (dto: CreatePlannedFixedCostRequestDto) =>
        request<PlannedFixedCostDto>("/finance/planned-fixed-costs", {
          method: "POST",
          body: JSON.stringify(dto),
        }),
      close: (id: string) =>
        request<PlannedFixedCostDto>(`/finance/planned-fixed-costs/${id}/close`, { method: "POST" }),
    },
    expenses: (locationId?: string) =>
      request<ExpenseDto[]>(withQuery("/finance/expenses", { locationId })),
    createExpense: (dto: CreateExpenseRequestDto) =>
      request<ExpenseDto>("/finance/expenses", { method: "POST", body: JSON.stringify(dto) }),
    confirmExpense: (id: string) => request<ExpenseDto>(`/finance/expenses/${id}/confirm`, { method: "POST" }),
    cancelExpense: (id: string) => request<ExpenseDto>(`/finance/expenses/${id}/cancel`, { method: "POST" }),
    recordExpensePayment: (id: string, dto: RecordExpensePaymentRequestDto) =>
      request<ExpenseDto>(`/finance/expenses/${id}/payments`, { method: "POST", body: JSON.stringify(dto) }),
    accounts: {
      list: (includeArchived?: boolean) =>
        request<CashAccountDto[]>(withQuery("/finance/accounts", { includeArchived: includeArchived ? "true" : undefined })),
      create: (dto: CreateCashAccountRequestDto) =>
        request<CashAccountDto>("/finance/accounts", { method: "POST", body: JSON.stringify(dto) }),
      update: (id: string, dto: UpdateCashAccountRequestDto) =>
        request<CashAccountDto>(`/finance/accounts/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
      setDefault: (id: string) => request<CashAccountDto>(`/finance/accounts/${id}/set-default`, { method: "POST" }),
      archive: (id: string) => request<CashAccountDto>(`/finance/accounts/${id}/archive`, { method: "POST" }),
      restore: (id: string) => request<CashAccountDto>(`/finance/accounts/${id}/restore`, { method: "POST" }),
    },
    categories: {
      list: (kind?: FinanceCategoryKind, includeArchived?: boolean) =>
        request<FinanceCategoryDto[]>(
          withQuery("/finance/categories", { kind, includeArchived: includeArchived ? "true" : undefined }),
        ),
      create: (dto: CreateFinanceCategoryRequestDto) =>
        request<FinanceCategoryDto>("/finance/categories", { method: "POST", body: JSON.stringify(dto) }),
      update: (id: string, dto: UpdateFinanceCategoryRequestDto) =>
        request<FinanceCategoryDto>(`/finance/categories/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
      archive: (id: string) => request<FinanceCategoryDto>(`/finance/categories/${id}/archive`, { method: "POST" }),
      restore: (id: string) => request<FinanceCategoryDto>(`/finance/categories/${id}/restore`, { method: "POST" }),
      remove: (id: string) => request<{ deleted: true }>(`/finance/categories/${id}`, { method: "DELETE" }),
      setCostBehavior: (id: string, costBehavior: CostBehavior) =>
        request<FinanceCategoryDto>(`/finance/categories/${id}/cost-behavior`, {
          method: "PATCH",
          body: JSON.stringify({ costBehavior }),
        }),
    },
    movements: {
      list: (accountId?: string, limit?: number, offset?: number) =>
        request<CashMovementDto[]>(
          withQuery("/finance/movements", {
            accountId,
            limit: limit ? String(limit) : undefined,
            offset: offset ? String(offset) : undefined,
          }),
        ),
      deposit: (dto: CashDepositRequestDto) =>
        request<CashMovementDto>("/finance/movements/deposit", { method: "POST", body: JSON.stringify(dto) }),
      withdraw: (dto: CashWithdrawalRequestDto) =>
        request<CashMovementDto>("/finance/movements/withdraw", { method: "POST", body: JSON.stringify(dto) }),
      transfer: (dto: CashTransferRequestDto) =>
        request<CashMovementDto>("/finance/movements/transfer", { method: "POST", body: JSON.stringify(dto) }),
      adjust: (dto: CashAdjustmentRequestDto) =>
        request<CashMovementDto>("/finance/movements/adjust", { method: "POST", body: JSON.stringify(dto) }),
    },
    setup: {
      status: () => request<FinanceSetupStatusDto>("/finance/setup/status"),
      reconcileInvoices: (dto: ReconcileInvoicesRequestDto) =>
        request<{ updated: number }>("/finance/setup/reconcile-invoices", {
          method: "POST",
          body: JSON.stringify(dto),
        }),
      complete: () => request<FinanceSetupStatusDto>("/finance/setup/complete", { method: "POST" }),
    },
  },

  hr: {
    employees: {
      list: (locationId?: string, includeArchived?: boolean) =>
        request<EmployeeDto[]>(
          withQuery("/hr/employees", { locationId, includeArchived: includeArchived ? "true" : undefined }),
        ),
      create: (dto: CreateEmployeeRequestDto) =>
        request<EmployeeDto>("/hr/employees", { method: "POST", body: JSON.stringify(dto) }),
      update: (id: string, dto: UpdateEmployeeRequestDto) =>
        request<EmployeeDto>(`/hr/employees/${id}`, { method: "PATCH", body: JSON.stringify(dto) }),
      archive: (id: string) => request<EmployeeDto>(`/hr/employees/${id}/archive`, { method: "POST" }),
      restore: (id: string) => request<EmployeeDto>(`/hr/employees/${id}/restore`, { method: "POST" }),
      remove: (id: string) => request<{ deleted: true }>(`/hr/employees/${id}`, { method: "DELETE" }),
      compensations: (id: string) => request<EmployeeCompensationDto[]>(`/hr/employees/${id}/compensations`),
      addCompensation: (id: string, dto: AddEmployeeCompensationRequestDto) =>
        request<EmployeeCompensationDto>(`/hr/employees/${id}/compensations`, {
          method: "POST",
          body: JSON.stringify(dto),
        }),
      clockIn: (id: string, dto: ClockInForRequestDto) =>
        request<TimeEntryDto>(`/hr/employees/${id}/clock-in`, { method: "POST", body: JSON.stringify(dto) }),
      clockOut: (id: string) => request<TimeEntryDto>(`/hr/employees/${id}/clock-out`, { method: "POST" }),
    },
    shifts: (locationId?: string) => request<ShiftDto[]>(withQuery("/hr/shifts", { locationId })),
    myShifts: () => request<ShiftDto[]>("/hr/shifts/me"),
    createShift: (dto: CreateShiftRequestDto) =>
      request<ShiftDto>("/hr/shifts", { method: "POST", body: JSON.stringify(dto) }),
    cancelShift: (id: string) => request<ShiftDto>(`/hr/shifts/${id}/cancel`, { method: "POST" }),
    timeEntries: (locationId?: string) =>
      request<TimeEntryDto[]>(withQuery("/hr/time-entries", { locationId })),
    myTimeEntries: () => request<TimeEntryDto[]>("/hr/time-entries/me"),
    clockIn: (dto: ClockInRequestDto) =>
      request<TimeEntryDto>("/hr/time-entries/clock-in", { method: "POST", body: JSON.stringify(dto) }),
    clockOut: () => request<TimeEntryDto>("/hr/time-entries/clock-out", { method: "POST" }),
    kpi: (from: string, to: string, locationId?: string) =>
      request<HrKpiResponseDto>(withQuery("/hr/kpi", { from, to, locationId })),
  },

  ai: {
    summary: (days?: number) => request<AiExecutiveSummaryDto>(withQuery("/ai/summary", { days: days ? String(days) : undefined })),
    locations: (days?: number) =>
      request<AiLocationDeviationResponseDto>(withQuery("/ai/locations", { days: days ? String(days) : undefined })),
    insights: () => request<AiInsightsResponseDto>("/ai/insights"),
    dismiss: (key: string) =>
      request<DismissAiInsightResponseDto>(`/ai/insights/${encodeURIComponent(key)}/dismiss`, { method: "POST" }),
    dismissAll: () => request<DismissAiInsightResponseDto>("/ai/insights/dismiss-all", { method: "POST" }),
  },

  telegram: {
    status: () => request<TelegramStatusDto>("/telegram/status"),
    linkToken: () => request<TelegramLinkTokenDto>("/telegram/link-token", { method: "POST" }),
    unlink: () => request<{ unlinked: true }>("/telegram/unlink", { method: "POST" }),
  },
};
