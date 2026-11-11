// What «Начать учёт с чистого листа» deletes and what it keeps — every table that
// carries an organizationId must be in exactly one of the two lists (a spec checks it),
// so a table added later cannot be silently wiped or silently left with old garbage.

const byOrg = (table: string) => `DELETE FROM "${table}" WHERE "organizationId" = $1`;
const byParent = (table: string, column: string, parent: string) =>
  `DELETE FROM "${table}" WHERE "${column}" IN (SELECT id FROM "${parent}" WHERE "organizationId" = $1)`;

// Children before parents. All in ONE transaction: everything goes, or nothing.
export const CLEAN_START_DELETES: string[] = [
  byParent("stock_void_lines", "voidId", "stock_voids"),
  byOrg("stock_voids"),
  byOrg("stock_movements"),
  byParent("stocktake_lines", "stocktakeId", "stocktakes"),
  byOrg("stocktakes"),
  byOrg("stock_levels"),
  byOrg("fiscal_receipts"),
  byOrg("loyalty_points_entries"),
  byOrg("customer_advance_applications"),
  byOrg("cash_movements"),
  byParent("bank_statement_lines", "statementId", "bank_statements"),
  byOrg("bank_statements"),
  byOrg("purchase_order_payments"),
  byParent("supplier_return_lines", "supplierReturnId", "supplier_returns"),
  byOrg("supplier_returns"),
  byParent("purchase_order_revision_lines", "revisionId", "purchase_order_revisions"),
  byOrg("purchase_order_revisions"),
  byParent("purchase_order_items", "purchaseOrderId", "purchase_orders"),
  byOrg("purchase_orders"),
  byParent("invoice_items", "invoiceId", "invoices"),
  byOrg("invoices"),
  byOrg("consignment_payments"),
  byOrg("sale_payments"),
  byParent("sale_return_items", "saleReturnId", "sale_returns"),
  byOrg("sale_returns"),
  byParent("sale_items", "saleId", "sales"),
  byOrg("sales"),
  byOrg("depreciation_entries"),
  byOrg("fixed_assets"),
  byOrg("expenses"),
  byParent("production_batch_costs", "batchId", "production_batches"),
  byOrg("production_batches"),
  byParent("material_requisition_lines", "requisitionId", "material_requisitions"),
  byOrg("material_requisitions"),
  byParent("daily_reconciliation_lines", "reconciliationId", "daily_reconciliations"),
  byOrg("daily_reconciliations"),
  byOrg("till_shifts"),
  `DELETE FROM "route_stop_items" WHERE "routeStopId" IN (SELECT s.id FROM "route_stops" s JOIN "delivery_routes" r ON r.id = s."routeId" WHERE r."organizationId" = $1)`,
  byParent("route_stops", "routeId", "delivery_routes"),
  byOrg("delivery_routes"),
  byOrg("shifts"),
  byOrg("time_entries"),
  byOrg("journal_lines"),
  byOrg("journal_entries"),
  byOrg("accounting_events"),
  byOrg("cost_corrections"),
  byOrg("period_snapshots"),
  byOrg("financial_periods"),
  byOrg("notification_dismissals"),
];

// Cached figures on what stays, put back to «nothing has happened yet».
export const CLEAN_START_RESETS: string[] = [
  `UPDATE "cash_accounts" SET "currentBalance" = 0 WHERE "organizationId" = $1`,
  // The moving average came from purchases that are gone; the card price stands in until the first priced receipt.
  `UPDATE "products" SET "averageUnitCost" = NULL WHERE "organizationId" = $1`,
  `UPDATE "organizations" SET "financeInitializedAt" = NULL, "openingInventoryValue" = NULL, "openingReceivablesValue" = NULL,
     "openingPayablesValue" = NULL, "ledgerStartsAt" = NULL, "journalEntrySequence" = 0, "saleSequence" = 0 WHERE "id" = $1`,
];

// Tables with an organizationId that are deleted (above) …
export const CLEAN_START_REMOVED_TABLES = [
  "stock_void_lines", "stock_voids", "stock_movements", "stocktakes", "bank_statement_lines", "stock_levels", "fiscal_receipts", "loyalty_points_entries",
  "customer_advance_applications", "cash_movements", "bank_statements", "purchase_order_payments", "supplier_returns",
  "purchase_order_revisions", "purchase_orders", "invoices", "consignment_payments", "sale_payments", "sale_returns", "sales",
  "depreciation_entries", "fixed_assets", "expenses", "production_batches", "material_requisitions", "daily_reconciliations",
  "till_shifts", "delivery_routes", "shifts", "time_entries", "journal_lines", "journal_entries", "accounting_events",
  "cost_corrections", "period_snapshots", "financial_periods", "notification_dismissals",
];

// … and those that stay: reference data, settings, people and the record of who did what.
export const CLEAN_START_KEPT_TABLES = [
  "accounting_policies", "audit_logs", "bank_import_profiles", "bank_rules", "cash_accounts", "categories",
  "classification_batches", "club_login_requests", "club_push_notices", "club_push_subscriptions", "crm_contacts", "crm_orders", "customers", "directions", "employee_compensations", "employees",
  "finance_categories", "financial_model_scenarios", "ledger_accounts", "locations", "loyalty_birthday_grants",
  "loyalty_consents", "loyalty_family_members", "loyalty_members", "loyalty_message_logs", "loyalty_settings",
  "loyalty_telegram_links", "management_plan_lines", "planned_fixed_costs", "product_location_prices", "product_photos",
  "products", "promotion_coupons", "promotions", "recipe_stage_types", "recipe_versions", "recipes", "regions", "standing_order_lines",
  "suppliers", "users", "vehicles",
];

// The groups the owner sees: label + the main table counted for it.
export const CLEAN_START_REMOVE_GROUPS: { label: string; table: string }[] = [
  { label: "Продажи и чеки", table: "sales" },
  { label: "Возвраты покупателей", table: "sale_returns" },
  { label: "Движения склада", table: "stock_movements" },
  { label: "Остатки товаров (обнулятся)", table: "stock_levels" },
  { label: "Инвентаризации", table: "stocktakes" },
  { label: "Производственные партии", table: "production_batches" },
  { label: "Требования и перемещения", table: "material_requisitions" },
  { label: "Заказы поставщикам", table: "purchase_orders" },
  { label: "Накладные поставщиков", table: "invoices" },
  { label: "Движения денег по счетам", table: "cash_movements" },
  { label: "Расходы", table: "expenses" },
  { label: "Банковские выписки", table: "bank_statements" },
  { label: "Кассовые смены", table: "till_shifts" },
  { label: "Сверки дня", table: "daily_reconciliations" },
  { label: "Основные средства", table: "fixed_assets" },
  { label: "Закрытые периоды", table: "financial_periods" },
  { label: "Проводки главной книги", table: "journal_entries" },
  { label: "Бонусные баллы (начисления и списания)", table: "loyalty_points_entries" },
  { label: "Рейсы логистики", table: "delivery_routes" },
  { label: "Смены и учёт времени сотрудников", table: "time_entries" },
];

export const CLEAN_START_KEEP_GROUPS: { label: string; table: string }[] = [
  { label: "Номенклатура", table: "products" },
  { label: "Техкарты", table: "recipes" },
  { label: "Категории", table: "categories" },
  { label: "Точки", table: "locations" },
  { label: "Сотрудники (пользователи)", table: "users" },
  { label: "Оптовые клиенты", table: "customers" },
  { label: "Поставщики", table: "suppliers" },
  { label: "Бонусные клиенты", table: "loyalty_members" },
  { label: "Статьи ДДС", table: "finance_categories" },
  { label: "Счета и кассы (остаток станет 0)", table: "cash_accounts" },
];
