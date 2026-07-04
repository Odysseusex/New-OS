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

// Roles allowed to view data across the whole organization / any region.
export const NETWORK_WIDE_ROLES: Role[] = [Role.OWNER, Role.ADMIN];
