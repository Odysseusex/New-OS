import type { SaleDetailDto } from "@bakery-os/shared";
import { api } from "@/lib/api";
import { saleWaybill, unitsOf, type UnitByProduct, type Waybill } from "@/lib/waybill";

// A sale's lines carry no unit: it is the product's, read once from the catalogue (archived products
// too — an old накладная may hold one) and kept while the page lives.
let units: Promise<UnitByProduct> | null = null;
const productUnits = () => (units ??= api.products.list(true).then(unitsOf).catch((err) => ((units = null), Promise.reject(err))));

export async function saleWaybills(sales: SaleDetailDto[]): Promise<Waybill[]> {
  const map = await productUnits();
  return sales.map((s) => saleWaybill(s, map));
}

// From the list of sales, where only the heads are loaded: each check is opened for its lines.
export async function saleWaybillsById(ids: string[]): Promise<Waybill[]> {
  const sales: SaleDetailDto[] = [];
  for (const id of ids) sales.push(await api.sales.findOne(id));
  return saleWaybills(sales);
}
