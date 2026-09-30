import {
  ForecastDto,
  ForecastMonthDto,
  ModelBaselineDto,
  ModelDriversDto,
} from "@bakery-os/shared";
import { round2 } from "../common/money";

export function validateDrivers(d: ModelDriversDto): string | null {
  if (!Number.isInteger(d.months) || d.months < 1 || d.months > 36) return "Горизонт прогноза — от 1 до 36 месяцев";
  const percent = (v: number | null, name: string) =>
    v !== null && (!Number.isFinite(v) || v < 0 || v > 1000) ? `${name}: значение должно быть от 0 до 1000` : null;
  if (!Number.isFinite(d.revenueGrowthPercentPerMonth) || d.revenueGrowthPercentPerMonth < -100 || d.revenueGrowthPercentPerMonth > 1000) {
    return "Рост выручки: значение вне допустимых пределов";
  }
  const nonNegative = [
    d.capexPerMonth,
    d.ownerWithdrawalsPerMonth,
    d.loanRepaymentPerMonth,
    d.fixedExpensesPerMonth ?? 0,
  ];
  if (nonNegative.some((v) => !Number.isFinite(v) || v < 0)) return "Суммы не могут быть отрицательными";
  return percent(d.cogsPercentOfRevenue, "Себестоимость, %") ?? percent(d.variableExpensePercentOfRevenue, "Переменные расходы, %");
}

// A deterministic projection. The same baseline and drivers ALWAYS give the
// same months: no randomness, no clock beyond the `start` month it is given, no
// reading of anything. It does not model tax (not configured) nor the change in
// working capital, and says so in the result.
//
// `scheduledDepreciation(index)` supplies the register's depreciation for the
// index-th forecast month (0 when nothing depreciates).
export function forecast(
  baseline: ModelBaselineDto,
  drivers: ModelDriversDto,
  start: { year: number; month: number },
  scheduledDepreciation: (index: number, year: number, month: number) => number,
): ForecastDto {
  const cogsPct = drivers.cogsPercentOfRevenue ?? baseline.cogsPercentOfRevenue;
  const varPct = drivers.variableExpensePercentOfRevenue ?? baseline.variableExpensePercentOfRevenue;
  const fixed = drivers.fixedExpensesPerMonth ?? baseline.fixedExpensesPerMonth;
  const growth = 1 + drivers.revenueGrowthPercentPerMonth / 100;
  let cash = drivers.openingCash ?? baseline.openingCash;

  const months: ForecastMonthDto[] = [];
  let y = start.year;
  let m = start.month;
  let minCash = Infinity;
  let minCashIndex = 0;
  const sum = { revenue: 0, op: 0, net: 0, flow: 0 };

  for (let i = 1; i <= drivers.months; i++) {
    const netRevenue = round2(baseline.averageMonthlyNetRevenue * growth ** i);
    const cogs = round2((netRevenue * cogsPct) / 100);
    const grossProfit = round2(netRevenue - cogs);
    const variableExpenses = round2((netRevenue * varPct) / 100);
    const fixedExpenses = round2(fixed);
    const inventoryLosses = round2(baseline.inventoryLossesPerMonth);
    const depreciation = round2(scheduledDepreciation(i, y, m));
    const operatingProfit = round2(grossProfit - variableExpenses - fixedExpenses - inventoryLosses - depreciation);
    // Tax is not configured: the net profit is the profit before tax, marked preliminary.
    const netProfit = operatingProfit;
    const operatingCashFlow = round2(operatingProfit + depreciation);
    const investingCashFlow = round2(-drivers.capexPerMonth);
    const financingCashFlow = round2(-(drivers.ownerWithdrawalsPerMonth + drivers.loanRepaymentPerMonth));
    const netCashFlow = round2(operatingCashFlow + investingCashFlow + financingCashFlow);
    cash = round2(cash + netCashFlow);
    if (cash < minCash) {
      minCash = cash;
      minCashIndex = i;
    }
    months.push({
      index: i, year: y, month: m, netRevenue, cogs, grossProfit, variableExpenses, fixedExpenses, inventoryLosses, depreciation,
      operatingProfit, incomeTax: null, netProfit, operatingCashFlow, investingCashFlow, financingCashFlow, netCashFlow, closingCash: cash,
    });
    sum.revenue += netRevenue;
    sum.op += operatingProfit;
    sum.net += netProfit;
    sum.flow += netCashFlow;
    if (m === 12) {
      y += 1;
      m = 1;
    } else m += 1;
  }

  const margin = 1 - cogsPct / 100 - varPct / 100;
  const nonVariable = fixed + baseline.inventoryLossesPerMonth + (months[0]?.depreciation ?? 0);
  return {
    baseline,
    drivers,
    months,
    totals: {
      netRevenue: round2(sum.revenue),
      operatingProfit: round2(sum.op),
      netProfit: round2(sum.net),
      netCashFlow: round2(sum.flow),
      endingCash: months[months.length - 1]?.closingCash ?? cash,
      minimumCash: minCash === Infinity ? cash : minCash,
      minimumCashMonthIndex: minCashIndex,
    },
    breakEvenMonthlyRevenue: margin > 0 ? round2(nonVariable / margin) : null,
    netProfitStatus: "PRELIMINARY",
    notConfigured: ["INCOME_TAX"],
    assumptions: [
      "Налоги не моделируются: налоговая политика не утверждена",
      "Изменение оборотного капитала (запасы, долги) не моделируется",
      `Рост выручки ${drivers.revenueGrowthPercentPerMonth}% в месяц от среднемесячной чистой выручки базового периода`,
      "Прогноз ничего не записывает в учёт",
    ],
  };
}
