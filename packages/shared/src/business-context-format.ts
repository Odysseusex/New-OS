import {
  BUSINESS_CONTEXT_MODULE_LABELS_RU,
  type BusinessContextDto,
  type BusinessContextModule,
} from "./business-context";
import { UNIT_LABELS_RU } from "./catalog";
import { WRITE_OFF_REASON_LABELS_RU } from "./inventory";

// Renders a BusinessContextDto as the text a model actually reads.
//
// One projection of the contract, never the contract itself — the DTO stays
// the thing a future OpenAI/Claude integration posts. Pure: no I/O, no Date
// of its own, no access to anything but its argument, so the same context
// always renders byte-identical and the whole thing is testable without a
// database.
//
// Section headings are FIXED and English (## SALES, ## PRODUCTION, …). They
// are addresses a model is told to look for and a person may reference in a
// prompt months later, so they must not drift with UI wording — the Russian
// business vocabulary lives in the values and labels underneath them.

export interface BusinessContextFormatOptions {
  // Strips Markdown syntax for the .txt download. The structure — headings,
  // key/value lines, column layout — survives, because that structure is
  // what makes the export parseable, not the asterisks.
  plain?: boolean;
}

// Money and quantities to at most 2 decimals, with trailing zeros dropped:
// "400", not "400.00"; "3.7", not "3.70". Fewer tokens, and no false
// precision suggesting a figure is exact to the tiyn when it is not.
function num(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 10) / 10}%`;
}

function text(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : "n/a";
}

// "2026-09-17T10:32:00.000Z" -> "2026-09-17". Sliced rather than parsed: the
// server already emitted these as instants for dates it bucketed itself, and
// re-parsing here could shift one across midnight.
function day(iso: string): string {
  return iso.slice(0, 10);
}

class Buffer {
  private readonly lines: string[] = [];
  constructor(private readonly plain: boolean) {}

  heading(level: 1 | 2 | 3, value: string): void {
    this.blank();
    this.lines.push(this.plain ? (level === 1 ? value.toUpperCase() : value) : `${"#".repeat(level)} ${value}`);
    if (this.plain && level === 1) this.lines.push("=".repeat(value.length));
    this.lines.push("");
  }

  kv(key: string, value: string): void {
    this.lines.push(`${key}: ${value}`);
  }

  line(value = ""): void {
    this.lines.push(value);
  }

  bullet(value: string): void {
    this.lines.push(`- ${value}`);
  }

  blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== "") this.lines.push("");
  }

  // A pipe table in both modes. Markdown renders it as a table; as plain
  // text it still reads as aligned columns, and a model parses it either
  // way — which is why the .txt variant does not need a second layout.
  table(headers: string[], rows: string[][]): void {
    this.blank();
    if (rows.length === 0) {
      this.lines.push("(нет данных за период)");
      this.lines.push("");
      return;
    }
    this.lines.push(`| ${headers.join(" | ")} |`);
    this.lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
    for (const row of rows) this.lines.push(`| ${row.join(" | ")} |`);
    this.lines.push("");
  }

  toString(): string {
    return this.lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
}

export function formatBusinessContext(
  context: BusinessContextDto,
  options: BusinessContextFormatOptions = {},
): string {
  const out = new Buffer(options.plain === true);
  const { meta } = context;

  out.heading(1, "ARAMIR BUSINESS CONTEXT");
  out.line(
    "Экспорт данных ERP ArAmir для анализа внешней AI-моделью. Все суммы в " +
      `${meta.currency}. Календарные дни — по часовому поясу ${meta.timeZone}.`,
  );

  // ── META ────────────────────────────────────────────────────────────
  out.heading(2, "META");
  out.kv("schema_version", meta.schemaVersion);
  out.kv("generated_at", meta.generatedAt);
  out.kv("business_name", meta.businessName);
  out.kv("data_period", `${day(meta.period.from)} .. ${day(meta.period.to)} (${meta.period.days} дн.)`);
  out.kv("timezone", meta.timeZone);
  out.kv("currency", meta.currency);
  out.kv("export_level", meta.exportLevel);
  out.kv(
    "scope",
    meta.scope.kind === "network" ? "network (вся сеть)" : `location: ${meta.scope.locationName}`,
  );
  out.kv(
    "included_modules",
    meta.includedModules.map((m: BusinessContextModule) => m).join(", ") || "n/a",
  );
  out.blank();
  out.line("record_counts:");
  for (const [key, value] of Object.entries(meta.recordCounts)) out.bullet(`${key}: ${value}`);

  if (meta.warnings.length > 0) {
    out.blank();
    out.line("warnings:");
    for (const warning of meta.warnings) out.bullet(warning);
  }

  // ── BUSINESS ────────────────────────────────────────────────────────
  out.heading(2, "BUSINESS");
  out.kv("locations_included", String(context.locations.length));
  out.table(
    ["location_id", "name", "city", "type", "active"],
    context.locations.map((l) => [l.id, l.name, text(l.city), l.type, l.isActive ? "yes" : "no"]),
  );

  // ── PRODUCTS ────────────────────────────────────────────────────────
  out.heading(2, "PRODUCTS");
  out.line(
    "selling_price — цена продажи (только для готовой продукции). cost_price — " +
      "закупочная/себестоимостная цена сырья. unit_cost — рассчитанная себестоимость " +
      "единицы; cost_source говорит, откуда она взята (recipe = из техкарты, " +
      "purchase = средняя фактическая закупочная, none = себестоимость неизвестна).",
  );
  out.table(
    [
      "product_id",
      "sku",
      "name",
      "type",
      "unit",
      "category",
      `selling_price_${meta.currency}`,
      `cost_price_${meta.currency}`,
      `unit_cost_${meta.currency}`,
      "cost_source",
      "has_recipe",
      "shelf_life_days",
      "min_qty",
      "tracked",
      "consignment_supplier",
      `consignment_unit_cost_${meta.currency}`,
    ],
    context.products.map((p) => [
      p.id,
      text(p.sku),
      p.name,
      p.type,
      UNIT_LABELS_RU[p.unit] ?? p.unit,
      text(p.category),
      num(p.sellingPrice),
      num(p.costPrice),
      num(p.unitCost),
      p.costSource,
      p.hasRecipe ? "yes" : "no",
      p.shelfLifeDays === null ? "n/a" : String(p.shelfLifeDays),
      num(p.minQuantity),
      p.trackInventory ? "yes" : "no",
      p.consignment ? p.consignment.supplierName : "n/a",
      p.consignment ? num(p.consignment.unitCost) : "n/a",
    ]),
  );

  // ── RECIPES ─────────────────────────────────────────────────────────
  if (context.recipes) {
    out.heading(2, "RECIPES");
    out.line(
      "Техкарты: сколько единиц готового продукта даёт одна партия и какое сырьё " +
        "на неё уходит. quantity — нормативный расход на ВСЮ партию, в базовой единице " +
        "ингредиента. effective_yield — выход с учётом потерь; именно на него делится " +
        "стоимость сырья, чтобы получить unit_cost.",
    );
    for (const recipe of context.recipes) {
      out.blank();
      out.heading(3, `${recipe.productName} (product_id: ${recipe.productId})`);
      out.kv("recipe_id", recipe.recipeId);
      out.kv("yield_qty", num(recipe.yieldQuantity));
      out.kv("loss_percent", pct(recipe.lossPercent));
      out.kv("effective_yield", num(recipe.effectiveYield));
      out.kv("piece_weight_g", num(recipe.pieceWeightG));
      out.kv("shelf_life_days", recipe.shelfLifeDays === null ? "n/a" : String(recipe.shelfLifeDays));
      out.kv(`total_ingredient_cost_${meta.currency}`, num(recipe.totalIngredientCost));
      out.kv(`unit_cost_${meta.currency}`, num(recipe.unitCost));
      out.kv("is_active", recipe.isActive ? "yes" : "no");
      out.table(
        ["ingredient_product_id", "name", "qty_per_batch", "unit", `unit_cost_${meta.currency}`, `line_cost_${meta.currency}`],
        recipe.ingredients.map((i) => [
          i.productId,
          i.name,
          num(i.quantity),
          UNIT_LABELS_RU[i.unit] ?? i.unit,
          num(i.unitCost),
          num(i.lineCost),
        ]),
      );
    }
  }

  // ── SALES ───────────────────────────────────────────────────────────
  if (context.sales) {
    const s = context.sales;
    out.heading(2, "SALES");
    out.kv(`total_revenue_${meta.currency}`, num(s.totalRevenue));
    out.kv("sales_count", String(s.salesCount));
    out.kv(`average_ticket_${meta.currency}`, num(s.averageTicket));
    out.kv(`total_cost_${meta.currency}`, num(s.totalCost));
    out.kv(`total_margin_${meta.currency}`, num(s.totalMargin));
    out.kv("total_margin_percent", pct(s.totalMarginPercent));
    out.kv(`revenue_without_cost_data_${meta.currency}`, num(s.revenueWithoutCostData));
    out.kv("products_without_cost_data", String(s.productsWithoutCostData));
    out.kv(`markdown_loss_${meta.currency}`, num(s.markdownLoss));
    out.kv("markdown_qty", num(s.markdownQuantity));
    out.line();
    out.line(
      "Итоги по себестоимости и марже покрывают только товары с известной " +
        "себестоимостью. Выручка товаров без неё показана отдельной строкой выше и " +
        "в итоги маржи не входит.",
    );

    out.heading(3, "SALES BY PRODUCT");
    out.line(
      "quantity — продано единиц. avg_selling_price — выручка, делённая на количество " +
        "(фактическая средняя цена продажи с учётом уценки). abc_class — A/B/C по вкладу " +
        "в маржинальную прибыль.",
    );
    out.table(
      [
        "product_id",
        "name",
        "qty",
        `revenue_${meta.currency}`,
        `avg_selling_price_${meta.currency}`,
        `cost_${meta.currency}`,
        `margin_${meta.currency}`,
        "margin_percent",
        "revenue_share",
        "margin_share",
        "abc_class",
        "markdown_qty",
        `markdown_loss_${meta.currency}`,
        "has_cost_data",
      ],
      s.byProduct.map((r) => [
        r.productId,
        r.productName,
        num(r.quantity),
        num(r.revenue),
        num(r.quantity > 0 ? r.revenue / r.quantity : null),
        r.hasCostData ? num(r.cost) : "n/a",
        r.hasCostData ? num(r.margin) : "n/a",
        pct(r.marginPercent),
        pct(r.revenueShare),
        pct(r.marginShare),
        text(r.abcClass),
        num(r.markdownQuantity),
        num(r.markdownLoss),
        r.hasCostData ? "yes" : "no",
      ]),
    );

    out.heading(3, "SALES BY LOCATION");
    out.table(
      ["location_id", "name", `revenue_${meta.currency}`, "sales_count", `average_ticket_${meta.currency}`],
      s.byLocation.map((l) => [
        l.locationId,
        l.locationName,
        num(l.revenue),
        String(l.salesCount),
        num(l.averageTicket),
      ]),
    );

    if (s.dynamics) {
      const d = s.dynamics;
      out.heading(3, "SALES DYNAMICS");
      out.kv("completed_days", String(d.completedDays));
      out.kv(`average_revenue_per_day_${meta.currency}`, num(d.averageRevenuePerDay));
      out.kv(
        "best_day",
        d.bestDay ? `${d.bestDay.date} (${num(d.bestDay.revenue)} ${meta.currency})` : "n/a",
      );
      out.kv(
        "worst_day",
        d.worstDay ? `${d.worstDay.date} (${num(d.worstDay.revenue)} ${meta.currency})` : "n/a",
      );
      out.kv(
        "previous_period",
        `${day(d.previous.from)} .. ${day(d.previous.to)}: ${num(d.previous.revenue)} ${meta.currency}, ` +
          `${d.previous.salesCount} продаж (изм. выручки: ${pct(d.previous.revenueDeltaPct)})`,
      );

      out.line();
      out.line("by_day:");
      out.table(
        ["date", `revenue_${meta.currency}`, "sales_count", `average_ticket_${meta.currency}`],
        d.points.map((p) => [p.date, num(p.revenue), String(p.salesCount), num(p.averageTicket)]),
      );

      out.line("by_weekday (1=Пн .. 7=Вс):");
      out.table(
        ["weekday", `revenue_${meta.currency}`, "sales_count", "occurrences", `avg_revenue_per_occurrence_${meta.currency}`],
        d.byWeekday.map((w) => [
          String(w.weekday),
          num(w.revenue),
          String(w.salesCount),
          String(w.occurrences),
          num(w.averageRevenue),
        ]),
      );

      out.line("by_hour (0..23, местное время):");
      out.table(
        ["hour", `revenue_${meta.currency}`, "sales_count"],
        d.byHour.filter((h) => h.salesCount > 0).map((h) => [String(h.hour), num(h.revenue), String(h.salesCount)]),
      );
    }
  }

  // ── PRODUCTION ──────────────────────────────────────────────────────
  if (context.production) {
    const p = context.production;
    out.heading(2, "PRODUCTION");
    out.line(
      "variance_qty = actual_qty − planned_qty по ЗАВЕРШЁННЫМ партиям: насколько выпуск " +
        "разошёлся с планом. Это НЕ списания и не порча — списания отдельно в разделе " +
        "WRITEOFFS, они фиксируются как отдельное событие и с партией не связаны.",
    );
    out.kv("batches_total", String(p.batchesTotal));
    out.kv("units_planned", num(p.unitsPlanned));
    out.kv("units_produced", num(p.unitsProduced));
    out.table(
      [
        "product_id",
        "name",
        "unit",
        "batches_completed",
        "batches_planned",
        "batches_in_progress",
        "batches_cancelled",
        "planned_qty",
        "actual_qty",
        "variance_qty",
        "variance_percent",
      ],
      p.byProduct.map((r) => [
        r.productId,
        r.productName,
        UNIT_LABELS_RU[r.unit] ?? r.unit,
        String(r.batchesCompleted),
        String(r.batchesPlanned),
        String(r.batchesInProgress),
        String(r.batchesCancelled),
        num(r.plannedQuantity),
        num(r.actualQuantity),
        num(r.varianceQuantity),
        pct(r.variancePercent),
      ]),
    );
  }

  // ── INVENTORY ───────────────────────────────────────────────────────
  if (context.inventory) {
    const inv = context.inventory;
    out.heading(2, "INVENTORY");
    out.line(
      "current_stock — остаток НА МОМЕНТ generated_at, а не на конец периода: система " +
        "не хранит исторических снимков остатка, поэтому остаток на начало периода " +
        "восстановить нельзя (см. DATA LIMITATIONS). movements_by_type — движения ЗА период.",
    );
    out.kv("low_stock_count", String(inv.lowStockCount));
    out.kv(`stock_valuation_${meta.currency}`, num(inv.valuationTotal));
    out.kv("valuation_unknown_cost_lines", String(inv.valuationUnknownLines));

    out.heading(3, "CURRENT STOCK");
    out.table(
      ["product_id", "name", "location_id", "location", "unit", "qty", "min_qty", "is_low"],
      inv.currentStock.map((r) => [
        r.productId,
        r.productName,
        r.locationId,
        r.locationName,
        UNIT_LABELS_RU[r.unit] ?? r.unit,
        num(r.quantity),
        num(r.minQuantity),
        r.isLow ? "yes" : "no",
      ]),
    );

    out.heading(3, "STOCK MOVEMENTS BY TYPE");
    out.line(
      "ВАЖНО: total_qty — это ВЕЛИЧИНА движения, а не знаковое изменение остатка. " +
        "Направление задаёт тип, а не знак числа. Приход (RECEIPT, PRODUCTION_OUTPUT) " +
        "увеличивает остаток; расход (WRITE_OFF, SALE, PRODUCTION_CONSUMPTION) — " +
        "уменьшает, и его total_qty тоже положительный. Исключение — ADJUSTMENT: " +
        "только у него число знаковое, потому что корректировка может идти в обе " +
        "стороны. Не складывай эти строки между собой без учёта типа.",
    );
    out.table(
      ["movement_type", "total_qty", "movement_count"],
      inv.movementsByType.map((m) => [m.type, num(m.totalQuantity), String(m.movementCount)]),
    );
  }

  // ── PURCHASES ───────────────────────────────────────────────────────
  if (context.purchases) {
    const pu = context.purchases;
    out.heading(2, "PURCHASES");
    out.line(
      "Заказы поставщикам и накладные — два независимых способа прихода товара, " +
        "поэтому они НЕ суммируются между собой.",
    );
    out.kv(`orders_total_cost_${meta.currency}`, num(pu.ordersTotalCost));
    out.kv("orders_count", String(pu.ordersCount));
    out.kv(`invoices_total_cost_${meta.currency}`, num(pu.invoicesTotalCost));
    out.kv("invoices_count", String(pu.invoicesCount));
    out.kv(`invoices_unpaid_${meta.currency}`, num(pu.invoicesUnpaid));

    out.heading(3, "PURCHASES BY SUPPLIER");
    out.table(
      ["supplier_id", "name", `total_cost_${meta.currency}`, "order_count"],
      pu.bySupplier.map((s) => [s.supplierId, s.supplierName, num(s.totalCost), String(s.orderCount)]),
    );

    out.heading(3, "PURCHASES BY PRODUCT");
    out.table(
      ["product_id", "name", "unit", "qty", `total_cost_${meta.currency}`, `avg_unit_cost_${meta.currency}`],
      pu.byProduct.map((p) => [
        p.productId,
        p.productName,
        UNIT_LABELS_RU[p.unit] ?? p.unit,
        num(p.quantity),
        num(p.totalCost),
        num(p.averageUnitCost),
      ]),
    );
  }

  // ── WRITEOFFS ───────────────────────────────────────────────────────
  if (context.writeOffs) {
    const w = context.writeOffs;
    out.heading(2, "WRITEOFFS");
    out.line(
      "Фактические списания товара со склада за период — порча, брак, бой и т.д. " +
        "Отдельное событие, не связанное с конкретной производственной партией.",
    );
    out.kv(`total_value_${meta.currency}`, num(w.totalValue));
    out.kv("total_movements", String(w.totalMovements));

    out.heading(3, "WRITEOFFS BY REASON");
    out.table(
      ["reason", "reason_ru", "qty", `value_${meta.currency}`],
      w.byReason.map((r) => [
        r.reason,
        WRITE_OFF_REASON_LABELS_RU[r.reason] ?? r.reason,
        num(r.quantity),
        num(r.value),
      ]),
    );

    out.heading(3, "WRITEOFFS BY PRODUCT");
    out.table(
      ["product_id", "name", "qty", `value_${meta.currency}`],
      w.byProduct.map((r) => [r.productId, r.productName, num(r.quantity), num(r.value)]),
    );
  }

  // ── FINANCE ─────────────────────────────────────────────────────────
  if (context.finance) {
    const f = context.finance;
    out.heading(2, "FINANCE");

    out.heading(3, "P&L");
    out.kv(`revenue_${meta.currency}`, num(f.pnl.revenue));
    out.kv(`cogs_${meta.currency}`, num(f.pnl.cogs));
    out.kv(`gross_profit_${meta.currency}`, num(f.pnl.grossProfit));
    out.kv("gross_margin_percent", pct(f.pnl.grossMarginPercent));
    out.kv(`expenses_total_${meta.currency}`, num(f.pnl.expensesTotal));
    out.kv(`operating_profit_${meta.currency}`, num(f.pnl.operatingProfit));
    out.kv("unknown_cost_line_items", String(f.pnl.unknownCostLineItems));
    out.line(
      "operating_profit = gross_profit − expenses_total. Процентов/налогов/прочих " +
        "внереализационных статей система не ведёт, поэтому чистой прибыли отдельно нет.",
    );

    out.heading(3, "BREAK-EVEN");
    out.kv("status", f.breakEven.status);
    out.kv(`fixed_costs_${meta.currency}`, num(f.breakEven.fixedExpensesTotal));
    out.kv(`variable_costs_${meta.currency}`, num(f.breakEven.variableExpensesTotal));
    out.kv(`unclassified_costs_${meta.currency}`, num(f.breakEven.unclassifiedExpensesTotal));
    out.kv(`contribution_margin_${meta.currency}`, num(f.breakEven.contributionMargin));
    out.kv("contribution_margin_percent", pct(f.breakEven.contributionMarginPercent));
    out.kv(`break_even_revenue_${meta.currency}`, num(f.breakEven.breakEvenRevenue));
    if (f.breakEven.status !== "OK") {
      out.line(
        "Точка безубыточности намеренно не рассчитана: статус выше объясняет, каких " +
          "данных для этого не хватает. Не подставляй сюда собственную оценку.",
      );
    }

    if (f.cashFlow) {
      out.heading(3, "CASH FLOW");
      out.kv(`opening_balance_${meta.currency}`, num(f.cashFlow.openingBalance));
      out.kv(`total_inflow_${meta.currency}`, num(f.cashFlow.totalInflow));
      out.kv(`total_outflow_${meta.currency}`, num(f.cashFlow.totalOutflow));
      out.kv(`net_flow_${meta.currency}`, num(f.cashFlow.netFlow));
      out.kv(`closing_balance_${meta.currency}`, num(f.cashFlow.closingBalance));
      out.kv(`uncategorized_outflow_${meta.currency}`, num(f.cashFlow.uncategorizedOutflow));
      out.line();
      out.line("inflow_by_type:");
      out.table(
        ["type", "label", `amount_${meta.currency}`, "count"],
        f.cashFlow.inflowByType.map((l) => [l.type, l.label, num(l.amount), String(l.count)]),
      );
      out.line("outflow_by_type:");
      out.table(
        ["type", "label", `amount_${meta.currency}`, "count"],
        f.cashFlow.outflowByType.map((l) => [l.type, l.label, num(l.amount), String(l.count)]),
      );
      out.line("outflow_by_category:");
      out.table(
        ["category", `amount_${meta.currency}`, "count"],
        f.cashFlow.outflowByCategory.map((c) => [c.categoryName, num(c.amount), String(c.count)]),
      );
    }

    out.heading(3, "BALANCES");
    out.kv(`accounts_receivable_${meta.currency}`, num(f.accountsReceivable));
    out.kv(`accounts_payable_${meta.currency}`, num(f.accountsPayable));
    out.kv(`consignment_owed_${meta.currency}`, num(f.consignmentOwed));
    if (f.consignmentBalances.length > 0) {
      out.line();
      out.line("consignment_by_supplier (товар под реализацию — чужой товар на нашей полке):");
      out.table(
        [
          "supplier_id",
          "name",
          `sold_${meta.currency}`,
          `returned_${meta.currency}`,
          `paid_${meta.currency}`,
          `balance_owed_${meta.currency}`,
          "qty_sold",
        ],
        f.consignmentBalances.map((c) => [
          c.supplierId,
          c.supplierName,
          num(c.soldAmount),
          num(c.returnedAmount),
          num(c.paidAmount),
          num(c.balance),
          num(c.quantitySold),
        ]),
      );
    }
  }

  // ── CUSTOMERS ───────────────────────────────────────────────────────
  if (context.customers) {
    const c = context.customers;
    out.heading(2, "CUSTOMERS");
    out.line(
      "Только оптовые/именные клиенты. Розничные продажи без клиента показаны " +
        "отдельной строкой retail_*. Контактные данные намеренно не выгружаются.",
    );
    out.kv("active_customers", String(c.activeCount));
    out.kv(`total_outstanding_${meta.currency}`, num(c.totalOutstanding));
    out.kv(`retail_revenue_${meta.currency}`, num(c.retailRevenue));
    out.kv("retail_sales_count", String(c.retailSalesCount));
    out.table(
      [
        "customer_id",
        "name",
        `revenue_${meta.currency}`,
        "sales_count",
        `average_ticket_${meta.currency}`,
        `outstanding_${meta.currency}`,
        `credit_limit_${meta.currency}`,
      ],
      c.byCustomer.map((r) => [
        r.customerId,
        r.name,
        num(r.revenue),
        String(r.salesCount),
        num(r.averageTicket),
        num(r.outstandingBalance),
        num(r.creditLimit),
      ]),
    );
  }

  // ── PERSONNEL ───────────────────────────────────────────────────────
  if (context.personnel) {
    out.heading(2, "PERSONNEL");
    out.line(
      "KPI сотрудников за период. Оклады и выплаты намеренно не выгружаются. " +
        "sales_revenue — выручка по продажам, которые провёл этот сотрудник.",
    );
    out.table(
      ["user_id", "name", "role", "sales_count", `sales_revenue_${meta.currency}`, `average_ticket_${meta.currency}`, "batches_completed", "units_produced"],
      context.personnel.map((e) => [
        e.userId,
        e.userFullName,
        e.role,
        String(e.salesCount),
        num(e.salesRevenue),
        num(e.salesCount > 0 ? e.salesRevenue / e.salesCount : null),
        String(e.batchesCompleted),
        num(e.unitsProduced),
      ]),
    );
  }

  // ── AI INSIGHTS ─────────────────────────────────────────────────────
  if (context.insights) {
    out.heading(2, "AI INSIGHTS");
    out.line(
      "Аномалии, найденные самой ArAmir по правилам (без LLM): каждая строка — уже " +
        "посчитанные факты, а не предположение. hypothesis, если есть, — найденная " +
        "кодом корреляция, НЕ доказанная причина.",
    );
    if (context.insights.length === 0) {
      out.line("(система не нашла отклонений за этот период)");
    }
    for (const insight of context.insights) {
      out.blank();
      out.line(`- [${insight.priority}/${insight.category}] ${insight.title}`);
      for (const fact of insight.facts) out.line(`  - ${fact}`);
      if (insight.hypothesis) out.line(`  - hypothesis (корреляция, не причина): ${insight.hypothesis}`);
      if (insight.locationName) out.line(`  - location: ${insight.locationName}`);
      out.line(`  - confidence: ${insight.confidence}`);
    }
  }

  // ── DATA LIMITATIONS ────────────────────────────────────────────────
  out.heading(2, "DATA LIMITATIONS");
  out.line(
    "Чего в системе нет. Это не ошибка экспорта — этих данных ArAmir не хранит " +
      "вообще. Не подставляй вместо них оценки: если вопрос упирается в один из " +
      "пунктов ниже, так и скажи.",
  );
  out.line();
  for (const limitation of meta.limitations) out.bullet(limitation);

  return out.toString();
}

// Filename for the downloaded file: aramir-context-business-2026-09-01..2026-09-17.md
export function businessContextFilename(context: BusinessContextDto, extension: "md" | "txt"): string {
  const { period, exportLevel } = context.meta;
  return `aramir-context-${exportLevel}-${day(period.from)}..${day(period.to)}.${extension}`;
}
