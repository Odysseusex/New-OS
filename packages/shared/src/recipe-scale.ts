import { ProductType, Unit } from "./catalog";

// The baker's calculator: a tech card scaled to any amount («47 деревенского»
// or «замес на 25 кг муки»), with fillings and other semi-finished parts
// already laid out into the same single list of what goes on the scales.
//
// The server sends the recipe ONCE, expanded for its own yield
// (`recipe-tree.ts` expandRecipe — the same expansion production consumes by);
// everything here is pure arithmetic on that, so the screen recalculates on
// every keystroke without another request.

export interface RecipeBreakdownLineDto {
  productId: string;
  name: string;
  type: ProductType;
  // A semi-finished product held as stock: taken from stock as it is, not made again.
  fromStock: boolean;
  unit: Unit;
  // For the recipe's whole yield (yieldQuantity), in the ingredient's own unit.
  quantity: number;
}

export interface RecipeBreakdownDto {
  recipeId: string;
  productId: string;
  productName: string;
  productUnit: Unit;
  yieldQuantity: number;
  mixCapacityKg: number | null;
  lines: RecipeBreakdownLineDto[];
  // Semi-finished ingredients with no active recipe: the list is short by these.
  missing: string[];
}

// Mass of a quantity in kg; 1 l is taken as 1 kg, as the recipe card's dough
// weight already does. Pieces have no mass here.
export function lineMassKg(quantity: number, unit: Unit): number | null {
  switch (unit) {
    case Unit.KG:
    case Unit.L:
      return quantity;
    case Unit.G:
    case Unit.ML:
      return quantity / 1000;
    default:
      return null;
  }
}

// «Мука …» — what the baker's percentage is counted against.
export const isFlourName = (name: string): boolean => name.trim().toLowerCase().startsWith("мука");

export const ALL_FLOUR_KEY = "FLOUR";

export interface ScaleBaseOption {
  key: string;
  label: string;
  // Mass of this base in the recipe as written (its whole yield), kg.
  massKg: number;
}

// What the amount can be stated against besides the output: all the flour
// together (when the recipe has any), or any single ingredient that has a mass.
export function scaleBaseOptions(lines: RecipeBreakdownLineDto[]): ScaleBaseOption[] {
  const options: ScaleBaseOption[] = [];
  const flour = lines.filter((l) => isFlourName(l.name) && lineMassKg(l.quantity, l.unit) !== null);
  if (flour.length > 1) {
    options.push({ key: ALL_FLOUR_KEY, label: "Вся мука", massKg: flour.reduce((s, l) => s + (lineMassKg(l.quantity, l.unit) ?? 0), 0) });
  }
  for (const line of lines) {
    if (line.fromStock) continue;
    const mass = lineMassKg(line.quantity, line.unit);
    if (mass !== null && mass > 0) options.push({ key: line.productId, label: line.name, massKg: mass });
  }
  return options;
}

// Flour when there is any (all of it when there are several kinds), else the
// heaviest ingredient; null when nothing has a mass.
export function defaultScaleBaseKey(lines: RecipeBreakdownLineDto[]): string | null {
  const options = scaleBaseOptions(lines);
  if (options.some((o) => o.key === ALL_FLOUR_KEY)) return ALL_FLOUR_KEY;
  const flour = options.find((o) => isFlourName(o.label));
  if (flour) return flour.key;
  const heaviest = [...options].sort((a, b) => b.massKg - a.massKg)[0];
  return heaviest?.key ?? null;
}

export interface ScaledRecipeLine extends RecipeBreakdownLineDto {
  scaled: number;
  // Share of the base (flour) by mass, %; null for pieces or with no base.
  bakersPercent: number | null;
  // What goes into ONE mix when the amount is split; null when it is not split.
  perMix: number | null;
}

export interface ScaledRecipe {
  factor: number;
  outputQuantity: number;
  lines: ScaledRecipeLine[];
  // What goes into the mixer, kg.
  totalMassKg: number;
  // Not in that mass (nor in the mixes, nor in the baker's percentage): what is
  // counted in pieces, and a ready filling taken from stock — it is not mixed.
  excludedFromMass: string[];
  mixes: number;
  perMixKg: number | null;
}

// `factor` multiplies the recipe as written: output / yield, or entered base kg / base kg in the recipe.
export function scaleRecipe(
  breakdown: Pick<RecipeBreakdownDto, "lines" | "yieldQuantity">,
  factor: number,
  baseKey: string | null,
  mixCapacityKg: number | null,
): ScaledRecipe {
  const safe = Number.isFinite(factor) && factor > 0 ? factor : 0;
  const base = baseKey ? scaleBaseOptions(breakdown.lines).find((o) => o.key === baseKey) : undefined;
  let totalMassKg = 0;
  const excludedFromMass: string[] = [];
  const scaled = breakdown.lines.map((line) => {
    const amount = line.quantity * safe;
    const mass = line.fromStock ? null : lineMassKg(line.quantity, line.unit);
    if (mass === null) excludedFromMass.push(line.name);
    else totalMassKg += mass * safe;
    return {
      ...line,
      scaled: amount,
      bakersPercent: base && mass !== null && base.massKg > 0 ? (mass / base.massKg) * 100 : null,
    };
  });
  const mixes = mixCapacityKg && mixCapacityKg > 0 && totalMassKg > mixCapacityKg ? Math.ceil(totalMassKg / mixCapacityKg) : 1;
  return {
    factor: safe,
    outputQuantity: breakdown.yieldQuantity * safe,
    lines: scaled.map((line) => ({ ...line, perMix: mixes > 1 ? line.scaled / mixes : null })),
    totalMassKg,
    excludedFromMass,
    mixes,
    perMixKg: mixes > 1 ? totalMassKg / mixes : null,
  };
}

// Factor for «make N of the product».
export const factorForOutput = (outputQuantity: number, yieldQuantity: number): number =>
  yieldQuantity > 0 && outputQuantity > 0 ? outputQuantity / yieldQuantity : 0;

// Factor for «a mix of N kg of flour» (or of whichever base was chosen).
export function factorForBase(lines: RecipeBreakdownLineDto[], baseKey: string, baseKg: number): number {
  const base = scaleBaseOptions(lines).find((o) => o.key === baseKey);
  return base && base.massKg > 0 && baseKg > 0 ? baseKg / base.massKg : 0;
}
