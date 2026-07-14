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
}

export const ROLE_LABELS_RU: Record<Role, string> = {
  [Role.OWNER]: "Владелец",
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
];

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

export const PURCHASE_ORDER_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.WAREHOUSE_STAFF];

// Recording and confirming supplier delivery notes is the same day-to-day
// receiving job as purchase orders, so it follows the same roles.
export const INVOICE_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.WAREHOUSE_STAFF];

// Roles that can create/cancel vehicles and delivery routes. Drivers don't
// plan routes, but they do execute their assigned ones (see LogisticsService).
export const LOGISTICS_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.WAREHOUSE_STAFF];

export const ROUTE_EXECUTE_ROLES: Role[] = [...LOGISTICS_MANAGE_ROLES, Role.DRIVER];

// Financial data (margins, P&L, expenses) is restricted to the same roles
// that already see the whole network rather than a single location.
export const FINANCE_VIEW_ROLES: Role[] = ORG_WIDE_ROLES;

export const EXPENSE_MANAGE_ROLES: Role[] = ORG_WIDE_ROLES;

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

// Deleting a record is permanent (unlike archiving, which can always be
// undone), so it's reserved for Owner/Admin even for roles that can
// otherwise create/edit/archive the same entity type.
export const HARD_DELETE_ROLES: Role[] = [Role.OWNER, Role.ADMIN];

// Managing employee accounts (creating logins, assigning roles) is an
// access-control decision, so it's restricted the same way as location
// management rather than opened up to operational roles.
export const USER_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN];
