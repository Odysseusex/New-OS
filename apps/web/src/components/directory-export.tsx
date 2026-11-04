"use client";

import { FileDown } from "lucide-react";
import type { CashAccountDto, FinanceCategoryDto, LocationDto, UserAccountDto } from "@bakery-os/shared";
import {
  BALANCE_TREATMENT_LABELS_RU,
  CASH_ACCOUNT_TYPE_LABELS_RU,
  CASH_ACTIVITY_LABELS_RU,
  COST_BEHAVIOR_LABELS_RU,
  FINANCE_CATEGORY_KIND_LABELS_RU,
  LOCATION_TYPE_LABELS_RU,
  PNL_TREATMENT_LABELS_RU,
  ROLE_LABELS_RU,
} from "@bakery-os/shared";
import { downloadTable } from "@/lib/export-table";

// «Excel» for the small directories (ТЗ §2): points, accounts, finance articles and
// employees are exported from the list already on screen. They are a handful of rows
// each, so they are entered in the app rather than loaded from a file.

export function ExcelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-surface-muted"
    >
      <FileDown className="h-4 w-4" strokeWidth={1.75} />
      Excel
    </button>
  );
}

const yesNo = (v: boolean) => (v ? "да" : "нет");

export function exportLocations(locations: LocationDto[]) {
  void downloadTable(
    "tochki",
    ["Название", "Тип", "Город", "Адрес", "Активна"],
    locations.map((l) => [l.name, LOCATION_TYPE_LABELS_RU[l.type], l.city, l.address, yesNo(l.isActive)]),
    { sheetName: "Точки" },
  );
}

export function exportAccounts(accounts: CashAccountDto[]) {
  void downloadTable(
    "scheta",
    ["Счёт", "Тип", "Точка", "Основной", "Остаток", "Активен"],
    accounts.map((a) => [a.name, CASH_ACCOUNT_TYPE_LABELS_RU[a.type], a.locationName ?? "", yesNo(a.isDefault), { v: a.currentBalance, fmt: "money" as const }, yesNo(a.isActive)]),
    { sheetName: "Счета" },
  );
}

export function exportFinanceCategories(categories: FinanceCategoryDto[]) {
  void downloadTable(
    "stati-dds",
    ["Код", "Статья", "Вид", "Деятельность (ДДС)", "ОПиУ", "Баланс", "Поведение затрат", "Активна"],
    categories.map((c) => [
      c.code ?? "",
      c.name,
      FINANCE_CATEGORY_KIND_LABELS_RU[c.kind],
      CASH_ACTIVITY_LABELS_RU[c.cashActivity],
      PNL_TREATMENT_LABELS_RU[c.pnlTreatment],
      BALANCE_TREATMENT_LABELS_RU[c.balanceTreatment],
      COST_BEHAVIOR_LABELS_RU[c.costBehavior],
      yesNo(c.isActive),
    ]),
    { sheetName: "Статьи ДДС" },
  );
}

export function exportEmployees(users: UserAccountDto[]) {
  void downloadTable(
    "sotrudniki",
    ["ФИО", "Email", "Роль", "Должность", "Точка", "PIN", "Активен"],
    users.map((u) => [u.fullName, u.email, ROLE_LABELS_RU[u.role], u.title ?? "", u.locationName ?? "Вся сеть", yesNo(u.hasPin), yesNo(u.isActive)]),
    { sheetName: "Сотрудники" },
  );
}
