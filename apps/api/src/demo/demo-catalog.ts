// The invented bakery of the sandbox («Песочница»): what it buys, bakes and
// sells, whom it employs and what it pays for. Plain data, no logic — the
// generator in demo-company.service.ts turns it into ~two months of history.
//
// Recipe amounts are multiples of 1/1000 of the yield (and prices of 10 ₸), so
// any batch size consumes whole grams worth whole tiyn: two months of baking
// then leave no rounding residue between stock and the books — the balance
// sheet of a sandbox must balance, not show a few tenge of NOT_BALANCED.
//
// The numbers are chosen to look like a real two-shop bakery in Almaty: about
// 2.4 M ₸ revenue a month, ingredients ~40 % of the price, a modest profit
// sitting not far above the break-even point — something a financier can
// actually analyse.

export type RawKey =
  | "flour"
  | "sugar"
  | "butter"
  | "eggs"
  | "milk"
  | "yeast"
  | "salt"
  | "curd"
  | "honey"
  | "sourcream"
  | "cabbage"
  | "oil"
  | "cinnamon";

export type SupplierKey = "dry" | "dairy" | "farm";

export const DEMO_RAW: { key: RawKey; name: string; unit: "KG" | "L" | "PCS"; price: number; supplier: SupplierKey }[] = [
  { key: "flour", name: "Мука пшеничная в/с", unit: "KG", price: 320, supplier: "dry" },
  { key: "sugar", name: "Сахар", unit: "KG", price: 480, supplier: "dry" },
  { key: "yeast", name: "Дрожжи прессованные", unit: "KG", price: 1800, supplier: "dry" },
  { key: "salt", name: "Соль", unit: "KG", price: 120, supplier: "dry" },
  { key: "oil", name: "Масло подсолнечное", unit: "L", price: 900, supplier: "dry" },
  { key: "cinnamon", name: "Корица молотая", unit: "KG", price: 6000, supplier: "dry" },
  { key: "butter", name: "Масло сливочное 82%", unit: "KG", price: 4200, supplier: "dairy" },
  { key: "milk", name: "Молоко 3,2%", unit: "L", price: 520, supplier: "dairy" },
  { key: "curd", name: "Творог 9%", unit: "KG", price: 2600, supplier: "dairy" },
  { key: "sourcream", name: "Сметана 20%", unit: "KG", price: 1900, supplier: "dairy" },
  { key: "eggs", name: "Яйцо куриное С1", unit: "PCS", price: 75, supplier: "dairy" },
  { key: "honey", name: "Мёд", unit: "KG", price: 3500, supplier: "farm" },
  { key: "cabbage", name: "Капуста белокочанная", unit: "KG", price: 180, supplier: "farm" },
];

export const DEMO_SUPPLIERS: { key: SupplierKey; name: string; phone: string }[] = [
  { key: "dry", name: "ТОО «Алтын Дән»", phone: "+7 727 300 11 22" },
  { key: "dairy", name: "ИП «Сүт Әлемі»", phone: "+7 701 222 33 44" },
  { key: "farm", name: "ИП Бекова (овощи, мёд)", phone: "+7 705 555 66 77" },
];

export type ProductKey = "bread" | "baton" | "croissant" | "bun" | "pie" | "vatrushka" | "medovik";

export interface DemoFinishedGood {
  key: ProductKey;
  name: string;
  category: "Хлеб" | "Выпечка" | "Торты";
  price: number;
  // Average units a day at the first shop on an ordinary weekday.
  demand: number;
  // Fresh bakes go stale overnight; a cake keeps a few days.
  keepsDays: number;
  recipe: { yield: number; items: Partial<Record<RawKey, number>> };
}

export const DEMO_FINISHED: DemoFinishedGood[] = [
  {
    key: "bread",
    name: "Хлеб пшеничный",
    category: "Хлеб",
    price: 350,
    demand: 22,
    keepsDays: 1,
    recipe: { yield: 40, items: { flour: 14.4, yeast: 0.28, salt: 0.28, sugar: 0.4, oil: 0.4 } },
  },
  {
    key: "baton",
    name: "Батон нарезной",
    category: "Хлеб",
    price: 380,
    demand: 14,
    keepsDays: 1,
    recipe: { yield: 40, items: { flour: 12, sugar: 0.6, yeast: 0.24, salt: 0.2, butter: 0.4, milk: 1.6 } },
  },
  {
    key: "croissant",
    name: "Круассан классический",
    category: "Выпечка",
    price: 550,
    demand: 14,
    keepsDays: 1,
    recipe: { yield: 40, items: { flour: 4, butter: 1.8, sugar: 0.4, eggs: 8, milk: 1.6, yeast: 0.16, salt: 0.08 } },
  },
  {
    key: "bun",
    name: "Булочка с корицей",
    category: "Выпечка",
    price: 380,
    demand: 12,
    keepsDays: 1,
    recipe: { yield: 40, items: { flour: 4, butter: 0.8, sugar: 0.8, eggs: 6, milk: 1.6, yeast: 0.12, cinnamon: 0.04 } },
  },
  {
    key: "pie",
    name: "Пирожок с капустой",
    category: "Выпечка",
    price: 280,
    demand: 22,
    keepsDays: 1,
    recipe: { yield: 60, items: { flour: 4.2, cabbage: 4.5, oil: 0.6, eggs: 6, yeast: 0.12, salt: 0.06, sugar: 0.18 } },
  },
  {
    key: "vatrushka",
    name: "Ватрушка с творогом",
    category: "Выпечка",
    price: 450,
    demand: 10,
    keepsDays: 1,
    recipe: { yield: 40, items: { flour: 2.4, curd: 2.4, sugar: 0.6, eggs: 8, butter: 0.4, milk: 0.8, yeast: 0.08 } },
  },
  {
    key: "medovik",
    name: "Торт «Медовик»",
    category: "Торты",
    price: 8900,
    demand: 0.7,
    keepsDays: 3,
    recipe: { yield: 4, items: { flour: 2, honey: 0.6, sugar: 1.2, eggs: 16, butter: 0.8, sourcream: 3 } },
  },
];

// Somebody else's goods sold on the first shop's shelf («под реализацию»).
export const DEMO_CONSIGNMENT_SUPPLIER = { name: "КХ «Береке»", phone: "+7 777 100 20 30" };
export const DEMO_CONSIGNMENT: { name: string; price: number }[] = [
  { name: "Сыр «Деревенский» 300 г", price: 1600 },
  { name: "Мёд горный 500 г", price: 2400 },
];

export const DEMO_STORES = [
  { key: "center" as const, name: "Пекарня «Центр»", address: "ул. Желтоксан, 87", lat: 43.2497, lng: 76.9378, demandFactor: 1 },
  { key: "north" as const, name: "Пекарня «Север»", address: "пр. Райымбека, 241", lat: 43.2716, lng: 76.9142, demandFactor: 0.85 },
];

// Wholesale buyers of the first shop, on credit. The canteen stops paying in the
// last weeks, so there is an overdue receivable to look at.
export const DEMO_CUSTOMERS = [
  {
    key: "cafe" as const,
    name: "Кофейня «Бариста»",
    phone: "+7 701 888 12 12",
    creditLimit: 150000,
    // Weekdays (0 = Sunday) it orders on, and what.
    days: [1, 3, 5],
    lines: { croissant: 20, bun: 15 } as Partial<Record<ProductKey, number>>,
    discount: 0.15,
  },
  {
    key: "canteen" as const,
    name: "Столовая «Достар»",
    phone: "+7 727 255 40 40",
    creditLimit: 100000,
    days: [2, 4],
    lines: { bread: 25, baton: 15 } as Partial<Record<ProductKey, number>>,
    discount: 0.1,
  },
];

export const DEMO_EMPLOYEES: { name: string; position: string; store: "center" | "north" | null; salary: number }[] = [
  { name: "Ерлан Касымов", position: "Управляющий", store: null, salary: 220000 },
  { name: "Гульмира Абенова", position: "Пекарь", store: "center", salary: 170000 },
  { name: "Нурлан Сейтов", position: "Пекарь", store: "north", salary: 165000 },
  { name: "Айгерим Жумабаева", position: "Продавец-кассир", store: "center", salary: 130000 },
  { name: "Дина Ахметова", position: "Продавец-кассир", store: "north", salary: 125000 },
];

export const DEMO_RENT = 130000;
export const DEMO_UTILITIES = 35000;
export const DEMO_INTERNET = 9900;
export const DEMO_MARKETING = 35000;
export const DEMO_OVEN_COST = 3200000;
export const DEMO_MIXER_COST = 780000;
export const DEMO_OPENING_BANK = 2800000;
export const DEMO_OPENING_TILL = 30000;
