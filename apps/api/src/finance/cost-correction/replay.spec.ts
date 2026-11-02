import { CostFlow, replayCosts } from "./replay";

// Method «Б» worked by hand on small cases. Times are plain numbers; the month
// is [100, 200].
const month = { from: 100, to: 200 };
let order = 0;
const purchase = (at: number, productId: string, quantity: number, unitCost: number): CostFlow => ({ kind: "PURCHASE", at, order: order++, productId, quantity, unitCost });
const out = (at: number, productId: string, quantity: number, stamped: number | null, category: "COGS" | "LOSS" | "PRODUCTION", batchId?: string): CostFlow => ({
  kind: "OUT", at, order: order++, productId, quantity, stampedUnitCost: stamped, category, batchId,
});
const inAt = (at: number, productId: string, quantity: number, stamped: number | null, category: "COGS" | "LOSS" | "NONE"): CostFlow => ({
  kind: "IN", at, order: order++, productId, quantity, stampedUnitCost: stamped, category,
});
const output = (at: number, productId: string, quantity: number, stamped: number | null, batchId: string): CostFlow => ({
  kind: "OUTPUT", at, order: order++, productId, quantity, stampedUnitCost: stamped, batchId,
});
const run = (flows: CostFlow[], untracked: [string, number][] = []) =>
  replayCosts({ flows, batchUntracked: new Map(untracked), ...month });

describe("month-end cost correction, method «Б»", () => {
  it("nothing to correct when the stamps already follow the averages", () => {
    const r = run([purchase(10, "flour", 10, 400), out(120, "flour", 8, 400, "LOSS"), purchase(130, "flour", 20, 500), out(150, "flour", 15, (2 * 400 + 20 * 500) / 22, "LOSS")]);
    expect(r.lossCorrection).toBe(0);
    expect(r.cogsCorrection).toBe(0);
    const flour = r.products.find((p) => p.productId === "flour")!;
    expect(flour.openingAverage).toBe(400);
    expect(flour.losses.recomputed).toBeCloseTo(3200 + 15 * 490.909, 0);
  });

  it("a receipt whose price was corrected later revalues what left after it", () => {
    // Booked at 500, the invoice said 400: the walk uses the corrected 400.
    const r = run([purchase(110, "flour", 10, 400), out(120, "flour", 4, 500, "LOSS")]);
    expect(r.lossCorrection).toBe(-400);
  });

  it("history before the month sets the opening, only the month is corrected", () => {
    const r = run([purchase(10, "flour", 10, 400), out(20, "flour", 5, 999, "LOSS"), out(150, "flour", 5, 450, "LOSS")]);
    // The outflow before the month is not corrected; the month's one is 5 × (400 − 450).
    expect(r.lossCorrection).toBe(-250);
  });

  it("finished goods cost what their batch really cost, not today's recipe", () => {
    const r = run(
      [
        purchase(10, "flour", 10, 400),
        // The batch: 5 kg of flour (stamped at the 400 average) + water 50 that is not stock → 10 loaves.
        out(120, "flour", 5, 400, "PRODUCTION", "b1"),
        output(120, "bread", 10, 205, "b1"),
        // Flour got dearer afterwards, and the sale was stamped at today's recipe (300 a loaf).
        purchase(130, "flour", 10, 600),
        out(140, "bread", 4, 300, "COGS"),
      ],
      [["b1", 50]],
    );
    // Real cost of a loaf: (5 × 400 + 50) ÷ 10 = 205.
    const bread = r.products.find((p) => p.productId === "bread")!;
    expect(bread.cogs).toEqual({ stamped: 1200, recomputed: 820 });
    expect(r.cogsCorrection).toBe(-380);
  });

  it("a corrected ingredient price flows into the batch and into what was sold", () => {
    const r = run(
      [
        // The flour was really 300, though at the time it was booked (and stamped) at 400.
        purchase(110, "flour", 10, 300),
        out(120, "flour", 5, 400, "PRODUCTION", "b1"),
        output(120, "bread", 10, 200, "b1"),
        out(140, "bread", 10, 200, "COGS"),
      ],
    );
    const flour = r.products.find((p) => p.productId === "flour")!;
    expect(flour.production).toEqual({ stamped: 2000, recomputed: 1500 });
    // Production itself is internal: only the bread sold reaches cost of goods.
    expect(r.cogsCorrection).toBe(-500);
    expect(r.lossCorrection).toBe(0);
  });

  it("a restocked return and a count surplus reduce what they belong to", () => {
    const r = run([
      purchase(10, "cake", 10, 1000),
      out(120, "cake", 2, 1200, "COGS"),
      inAt(130, "cake", 1, 1200, "COGS"),
      inAt(140, "cake", 1, 1100, "LOSS"),
    ]);
    // Sale 2 × (1000 − 1200) = −400; the return gives back 1 × (1000 − 1200) = +200.
    expect(r.cogsCorrection).toBe(-200);
    // The surplus was booked as a gain of 1100, it is worth 1000: 100 less gain = +100 loss.
    expect(r.lossCorrection).toBe(100);
  });

  it("an outflow with no stamped cost is counted, not corrected", () => {
    const r = run([purchase(10, "flour", 10, 400), out(120, "flour", 2, null, "LOSS")]);
    expect(r.lossCorrection).toBe(0);
    expect(r.unstampedLines).toBe(1);
  });

  it("flows after the month are ignored", () => {
    const r = run([purchase(10, "flour", 10, 400), out(120, "flour", 1, 450, "LOSS"), purchase(150, "flour", 0.0001, 1), out(250, "flour", 5, 1, "LOSS")]);
    expect(r.lossCorrection).toBe(-50);
  });
});

describe("stock with no known value yet", () => {
  it("counts at the starting average, not at the first purchase price", () => {
    const r = replayCosts({
      flows: [
        inAt(10, "flour", 90, null, "NONE"),
        purchase(20, "flour", 10, 200),
        out(120, "flour", 10, 300, "LOSS"),
      ],
      batchUntracked: new Map(),
      startingAverage: new Map([["flour", 320]]),
      ...month,
    });
    // (90 × 320 + 10 × 200) ÷ 100 = 308.
    expect(r.products[0].losses.recomputed).toBe(3080);
  });
});
