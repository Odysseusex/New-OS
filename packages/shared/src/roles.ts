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
export const ORG_WIDE_ROLES: Role[] = [
  Role.OWNER,
  Role.ADMIN,
  Role.REGIONAL_MANAGER,
  Role.ACCOUNTANT,
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

// Roles that can create/cancel vehicles and delivery routes. Drivers don't
// plan routes, but they do execute their assigned ones (see LogisticsService).
export const LOGISTICS_MANAGE_ROLES: Role[] = [Role.OWNER, Role.ADMIN, Role.WAREHOUSE_STAFF];

export const ROUTE_EXECUTE_ROLES: Role[] = [...LOGISTICS_MANAGE_ROLES, Role.DRIVER];
