import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { cashSignOf, stockSignOf } from "../../common/ledger-effects";

// READ-ONLY. Compares the two cached balances with the append-only ledgers
// that are supposed to explain them:
//
//   StockLevel.quantity        vs  Σ signed StockMovement   (per location, product)
//   CashAccount.currentBalance vs  Σ signed CashMovement    (per account)
//
// Nothing here writes, repairs or "fixes" a figure. A difference is a finding
// for a human: legacy rows written before a movement existed, a hand-edited
// balance, or a bug. Correcting one goes through the normal mechanisms
// (stock adjustment, cash ADJUSTMENT), never through this module.

export interface StockDrift {
  locationId: string;
  locationName: string;
  productId: string;
  productName: string;
  cachedQuantity: number;
  ledgerQuantity: number;
  difference: number;
  hasLevelRow: boolean;
}

export interface CashDrift {
  accountId: string;
  accountName: string;
  cachedBalance: number;
  ledgerBalance: number;
  difference: number;
}

export interface LedgerConsistencyReport {
  organizationId: string;
  generatedAt: string;
  stock: {
    levelsChecked: number;
    drifts: StockDrift[];
    negativeLevels: { locationName: string; productName: string; quantity: number }[];
    // WRITE_OFF rows attached to a sale return: counted as zero on purpose.
    returnScrapMarkers: number;
  };
  cash: {
    accountsChecked: number;
    drifts: CashDrift[];
    negativeBalances: { accountName: string; balance: number }[];
  };
  isConsistent: boolean;
}

const ZERO = new Prisma.Decimal(0);

function signed(sign: 1 | -1 | "SIGNED", value: Prisma.Decimal): Prisma.Decimal {
  return sign === "SIGNED" ? value : value.mul(sign);
}

export async function checkLedgerConsistency(
  prisma: PrismaService,
  organizationId: string,
): Promise<LedgerConsistencyReport> {
  const [levels, stockGroups, markerCount, accounts, cashGroups] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { organizationId },
      include: { product: { select: { name: true } }, location: { select: { name: true } } },
    }),
    prisma.stockMovement.groupBy({
      by: ["locationId", "productId", "type"],
      where: { organizationId, NOT: { type: "WRITE_OFF", saleReturnId: { not: null } } },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.count({ where: { organizationId, type: "WRITE_OFF", saleReturnId: { not: null } } }),
    prisma.cashAccount.findMany({ where: { organizationId } }),
    prisma.cashMovement.groupBy({
      by: ["accountId", "type"],
      where: { organizationId },
      _sum: { amount: true },
    }),
  ]);

  // ── Stock ────────────────────────────────────────────────────────────────
  const key = (locationId: string, productId: string) => `${locationId}::${productId}`;
  const ledger = new Map<string, Prisma.Decimal>();
  for (const g of stockGroups) {
    const k = key(g.locationId, g.productId);
    const delta = signed(stockSignOf(g.type) as 1 | -1 | "SIGNED", g._sum.quantity ?? ZERO);
    ledger.set(k, (ledger.get(k) ?? ZERO).plus(delta));
  }

  const levelByKey = new Map(levels.map((l) => [key(l.locationId, l.productId), l]));
  const ledgerOnly = [...ledger.keys()].filter((k) => !levelByKey.has(k));

  // Names for pairs that have movements but no StockLevel row at all.
  const [orphanProducts, orphanLocations] = ledgerOnly.length
    ? await Promise.all([
        prisma.product.findMany({
          where: { id: { in: ledgerOnly.map((k) => k.split("::")[1]) } },
          select: { id: true, name: true },
        }),
        prisma.location.findMany({
          where: { id: { in: ledgerOnly.map((k) => k.split("::")[0]) } },
          select: { id: true, name: true },
        }),
      ])
    : [[], []];
  const productName = new Map(orphanProducts.map((p) => [p.id, p.name]));
  const locationName = new Map(orphanLocations.map((l) => [l.id, l.name]));

  const stockDrifts: StockDrift[] = [];
  for (const level of levels) {
    const expected = ledger.get(key(level.locationId, level.productId)) ?? ZERO;
    const difference = level.quantity.minus(expected);
    if (!difference.isZero()) {
      stockDrifts.push({
        locationId: level.locationId,
        locationName: level.location.name,
        productId: level.productId,
        productName: level.product.name,
        cachedQuantity: level.quantity.toNumber(),
        ledgerQuantity: expected.toNumber(),
        difference: difference.toNumber(),
        hasLevelRow: true,
      });
    }
  }
  for (const k of ledgerOnly) {
    const expected = ledger.get(k)!;
    if (expected.isZero()) continue;
    const [locationId, productId] = k.split("::");
    stockDrifts.push({
      locationId,
      locationName: locationName.get(locationId) ?? locationId,
      productId,
      productName: productName.get(productId) ?? productId,
      cachedQuantity: 0,
      ledgerQuantity: expected.toNumber(),
      difference: expected.negated().toNumber(),
      hasLevelRow: false,
    });
  }

  // ── Cash ─────────────────────────────────────────────────────────────────
  const cashLedger = new Map<string, Prisma.Decimal>();
  for (const g of cashGroups) {
    const delta = signed(cashSignOf(g.type), g._sum.amount ?? ZERO);
    cashLedger.set(g.accountId, (cashLedger.get(g.accountId) ?? ZERO).plus(delta));
  }

  const cashDrifts: CashDrift[] = [];
  for (const account of accounts) {
    const expected = cashLedger.get(account.id) ?? ZERO;
    const difference = account.currentBalance.minus(expected);
    if (!difference.isZero()) {
      cashDrifts.push({
        accountId: account.id,
        accountName: account.name,
        cachedBalance: account.currentBalance.toNumber(),
        ledgerBalance: expected.toNumber(),
        difference: difference.toNumber(),
      });
    }
  }

  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    stock: {
      levelsChecked: levels.length,
      drifts: stockDrifts,
      negativeLevels: levels
        .filter((l) => l.quantity.isNegative())
        .map((l) => ({ locationName: l.location.name, productName: l.product.name, quantity: l.quantity.toNumber() })),
      returnScrapMarkers: markerCount,
    },
    cash: {
      accountsChecked: accounts.length,
      drifts: cashDrifts,
      negativeBalances: accounts
        .filter((a) => a.currentBalance.isNegative())
        .map((a) => ({ accountName: a.name, balance: a.currentBalance.toNumber() })),
    },
    isConsistent: stockDrifts.length === 0 && cashDrifts.length === 0,
  };
}
