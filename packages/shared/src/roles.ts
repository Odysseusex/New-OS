export enum Role {
  OWNER = "OWNER",
  REGIONAL_MANAGER = "REGIONAL_MANAGER",
  STORE_MANAGER = "STORE_MANAGER",
  PRODUCTION_MANAGER = "PRODUCTION_MANAGER",
  PRODUCTION_STAFF = "PRODUCTION_STAFF",
  WAREHOUSE_STAFF = "WAREHOUSE_STAFF",
  DRIVER = "DRIVER",
  CASHIER = "CASHIER",
  ACCOUNTANT = "ACCOUNTANT",
  HR_MANAGER = "HR_MANAGER",
  ADMIN = "ADMIN",
  // A single employee who handles documents (invoices, purchase orders)
  // without access to inventory corrections, recipes, users, or settings —
  // for small operations where one person covers several duties that don't
  // otherwise map to one existing role. Location-scoped, like WAREHOUSE_STAFF.
  OPERATOR = "OPERATOR",
}

export const ROLE_LABELS_RU: Record<Role, string> = {
  [Role.OWNER]: "Разработчик",
  [Role.REGIONAL_MANAGER]: "Региональный директор",
  [Role.STORE_MANAGER]: "Управляющий точкой",
  [Role.PRODUCTION_MANAGER]: "Технолог",
  [Role.PRODUCTION_STAFF]: "Пекарь",
  [Role.WAREHOUSE_STAFF]: "Кладовщик",
  [Role.DRIVER]: "Водитель",
  [Role.CASHIER]: "Кассир",
  [Role.ACCOUNTANT]: "Бухгалтер",
  [Role.HR_MANAGER]: "HR-менеджер",
  [Role.ADMIN]: "Администратор",
  [Role.OPERATOR]: "Оператор",
};

// Roles that see data across the whole organization instead of being pinned
// to a single location. Everyone else is scoped to their assigned location.
// HR_MANAGER is here because a bakery network typically has one company-wide
// HR function rather than a separate HR person per store.
export const ORG_WIDE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.REGIONAL_MANAGER,
  Role.ACCOUNTANT,
  Role.HR_MANAGER,
];

export const SALE_CREATE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.STORE_MANAGER,
  Role.CASHIER,
  Role.OPERATOR,
];

// Refunds are money leaving the till against goods coming back, which is the
// classic till-fraud shape — so this is deliberately NARROWER than
// SALE_CREATE_ROLES: a cashier can sell but not refund. Widen it only if the
// owner decides a lone cashier on shift needs to handle returns unsupervised.
export const SALE_RETURN_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.STORE_MANAGER];

export const INVENTORY_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.STORE_MANAGER,
  Role.WAREHOUSE_STAFF,
  Role.PRODUCTION_MANAGER,
];

export const PRODUCT_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.PRODUCTION_MANAGER];

export const RECIPE_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.PRODUCTION_MANAGER];

export const PRODUCTION_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.PRODUCTION_MANAGER,
  Role.PRODUCTION_STAFF,
];

export const SUPPLIER_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.WAREHOUSE_STAFF];

// OPERATOR is included here (and on invoices below) but deliberately left
// out of INVENTORY_MANAGE_ROLES — receiving via a purchase order/invoice is
// a documented, auditable flow, unlike ad-hoc manual stock receipt/write-off/
// adjustment, which stays restricted to warehouse/ownership roles.
export const PURCHASE_ORDER_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.WAREHOUSE_STAFF,
  Role.OPERATOR,
];

// Recording and confirming supplier delivery notes is the same day-to-day
// receiving job as purchase orders, so it follows the same roles.
export const INVOICE_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.WAREHOUSE_STAFF,
  Role.OPERATOR,
];

// Roles that can create/cancel vehicles and delivery routes. Drivers don't
// plan routes, but they do execute their assigned ones (see LogisticsService).
export const LOGISTICS_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.WAREHOUSE_STAFF];

export const ROUTE_EXECUTE_ROLES: Role[] = [...LOGISTICS_MANAGE_ROLES, Role.DRIVER];

// Financial data (margins, P&L, expenses) is restricted to the same roles
// that already see the whole network rather than a single location.
export const FINANCE_VIEW_ROLES: Role[] = ORG_WIDE_ROLES;

export const EXPENSE_MANAGE_ROLES: Role[] = ORG_WIDE_ROLES;

// Consignment settlements — what we owe a supplier for their goods we sold,
// and paying it. Money leaving the business against a debt, so the same tier
// as expenses; deliberately NOT open to a store manager, who can already see
// the goods but has no business deciding what gets paid out.
// Written out rather than reusing HARD_DELETE_ROLES, which is declared
// further down this file — referencing it from here would be a temporal
// dead zone error at module load, not a compile error.
export const CONSIGNMENT_VIEW_ROLES: Role[] = ORG_WIDE_ROLES;
export const CONSIGNMENT_PAY_ROLES: Role[] = [Role.OWNER, Role.ADMIN];

// Bank accounts and the income/expense category catalog are org-wide
// financial configuration — same tier as expenses, not opened up to
// location-level operational roles.
export const CASH_ACCOUNT_MANAGE_ROLES: Role[] = ORG_WIDE_ROLES;
export const FINANCE_CATEGORY_MANAGE_ROLES: Role[] = ORG_WIDE_ROLES;

// Planned (not actual) fixed costs — rent, utilities, internet. Same tier as
// the category catalog they hang off: org-wide financial configuration.
// Note this deliberately needs no separate salary gate even though the
// planned break-even it feeds includes a payroll total: FINANCE_VIEW_ROLES
// and SALARY_VIEW_ROLES already resolve to the same five roles, so the
// Finance controller's existing class-level guard is exactly as tight.
export const PLANNED_FIXED_COST_MANAGE_ROLES: Role[] = FINANCE_CATEGORY_MANAGE_ROLES;

// Day-to-day cash register operations (пополнение/снятие) at a location are
// closer to a sales-floor task than network-wide finance oversight, so
// store-level roles that already handle a till are included alongside the
// org-wide ones.
export const CASH_REGISTER_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.ACCOUNTANT,
  Role.STORE_MANAGER,
  Role.CASHIER,
];

// Correcting a cash movement after the fact (the CashMovement ledger is
// append-only — see CashMovement's schema comment) is materially more
// sensitive than an everyday deposit/withdrawal, so it's held to the same
// bar as a hard delete, plus the accountant who actually reconciles books.
export const CASH_ADJUSTMENT_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.ACCOUNTANT];

// Recording that a supplier invoice has been paid is a financial-oversight
// action, not a receiving/warehouse one — deliberately follows
// EXPENSE_MANAGE_ROLES rather than INVOICE_MANAGE_ROLES, which governs who
// can receive goods.
export const SUPPLIER_PAYMENT_ROLES: Role[] = EXPENSE_MANAGE_ROLES;

// Roles that can schedule shifts and view attendance/KPI for their team.
// Store/production managers manage their own location; HR-wide roles see all.
export const HR_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.REGIONAL_MANAGER,
  Role.HR_MANAGER,
  Role.STORE_MANAGER,
  Role.PRODUCTION_MANAGER,
];

// Creating/editing Employee records (name, position, location, status,
// linking a User) is day-to-day HR administration — same bar as shifts.
export const EMPLOYEE_MANAGE_ROLES: Role[] = HR_MANAGE_ROLES;

// Compensation is more sensitive than ordinary HR admin: a Store/Production
// manager can schedule their team's shifts but has no business seeing or
// setting anyone's pay rate — deliberately narrower than HR_MANAGE_ROLES.
export const SALARY_VIEW_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.REGIONAL_MANAGER,
  Role.HR_MANAGER,
  Role.ACCOUNTANT,
];
export const SALARY_MANAGE_ROLES: Role[] = SALARY_VIEW_ROLES;

// Customer directory is organization-wide (a wholesale client isn't tied to
// one location), so viewing/using it follows the same people who record
// sales, plus accounting for reconciliation.
export const CUSTOMER_VIEW_ROLES: Role[] = [...SALE_CREATE_ROLES, Role.ACCOUNTANT];

export const CUSTOMER_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.STORE_MANAGER,
  Role.ACCOUNTANT,
];

export const PAYMENT_RECORD_ROLES: Role[] = CUSTOMER_VIEW_ROLES;

// Adding/editing locations and comparing performance across the whole
// network is an organization-structure decision, so it follows the same
// roles as finance/HR network-wide oversight rather than per-store roles.
export const LOCATION_MANAGE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.REGIONAL_MANAGER,
];

export const NETWORK_VIEW_ROLES: Role[] = ORG_WIDE_ROLES;

// Quality/write-off reporting is visible to the same roles that already
// manage a location's day-to-day operations and to org-wide oversight
// roles. Actually recording a write-off still goes through
// INVENTORY_MANAGE_ROLES.
export const QUALITY_VIEW_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.REGIONAL_MANAGER,
  Role.STORE_MANAGER,
  Role.PRODUCTION_MANAGER,
];

// Deleting a record is permanent (unlike archiving, which can always be
// undone), so it's reserved for Owner/Admin even for roles that can
// otherwise create/edit/archive the same entity type.
export const HARD_DELETE_ROLES: Role[] = [Role.OWNER, Role.ADMIN];

// "Запуск финансового учёта" declares the whole company's opening financial
// position, once, ever — the most sensitive single action in the app, so it
// follows the same bar as a permanent hard delete rather than ordinary
// finance oversight.
export const FINANCE_SETUP_ROLES: Role[] = HARD_DELETE_ROLES;

// Force-deleting a product bypasses the usage check that normally blocks
// HARD_DELETE_ROLES from removing a product referenced by sales, purchase
// orders, invoices, routes, recipes or production history — it strips those
// references outright. That's a materially bigger blast radius than a normal
// hard delete (which only ever succeeds on an unused row), so it's reserved
// for Owner alone rather than reusing HARD_DELETE_ROLES.
export const PRODUCT_FORCE_DELETE_ROLES: Role[] = [Role.OWNER];

// Managing employee accounts (creating logins, assigning roles) is an
// access-control decision, so it's restricted the same way as location
// management rather than opened up to operational roles.
export const USER_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN];

// AI-центр surfaces cross-module financial data (margin, cash balances,
// AR/AP) that isn't otherwise open to location-scoped operational roles —
// same breadth as Finance/Network/Reports, not a per-insight ACL. A
// location-scoped manager still gets the same signal today via
// Notifications (low stock, stale documents); AI-центр's cross-module
// correlation view is deliberately owner/oversight-level only for now.
export const AI_INSIGHTS_VIEW_ROLES: Role[] = ORG_WIDE_ROLES;
