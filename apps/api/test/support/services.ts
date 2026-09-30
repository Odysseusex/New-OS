import { PrismaService } from "../../src/prisma/prisma.service";
import { CashMovementsService } from "../../src/finance/cash-movements.service";
import { FinanceService } from "../../src/finance/finance.service";
import { InventoryService } from "../../src/inventory/inventory.service";
import { InvoicesService } from "../../src/invoices/invoices.service";
import { LogisticsService } from "../../src/logistics/logistics.service";
import { ProcurementService } from "../../src/procurement/procurement.service";
import { ProductionService } from "../../src/production/production.service";
import { FiscalService } from "../../src/fiscal/fiscal.service";
import { FiscalSettings } from "../../src/fiscal/fiscal.settings";
import { FakeFiscalProvider } from "../../src/fiscal/fake-fiscal.provider";
import { PromotionsService } from "../../src/promotions/promotions.service";
import { SalesService } from "../../src/sales/sales.service";
import { SaleReturnsService } from "../../src/sales/sale-returns.service";
import { CostingService } from "../../src/costing/costing.service";
import { StocktakeService } from "../../src/stocktake/stocktake.service";

// The same hand-wiring the existing specs use (no Nest container), in one
// place. Callers must clear FISCALIZATION_ENABLED first so a sale is a plain
// sale — fiscal behaviour has its own specs.
export function buildServices(prisma: PrismaService) {
  const cash = new CashMovementsService(prisma);
  const costing = new CostingService(prisma);
  const fiscal = new FiscalService(prisma, new FakeFiscalProvider(), new FiscalSettings());
  return {
    cash,
    costing,
    stocktake: new StocktakeService(prisma, costing),
    finance: new FinanceService(prisma, cash),
    inventory: new InventoryService(prisma),
    invoices: new InvoicesService(prisma, cash),
    logistics: new LogisticsService(prisma),
    procurement: new ProcurementService(prisma, cash),
    production: new ProductionService(prisma),
    sales: new SalesService(prisma, cash, fiscal, new FiscalSettings(), new PromotionsService(prisma)),
    returns: new SaleReturnsService(prisma, cash, fiscal, new FiscalSettings()),
  };
}
