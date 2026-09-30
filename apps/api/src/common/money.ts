// Money in this app is tenge with two decimals. Every aggregate that reaches a
// report goes through round2 once, at the end, so floating-point noise such as
// 9171.199999999999 never surfaces in the UI, an export or a stored snapshot.
// Per-line values are rounded to 2 dp BEFORE they are summed, so the total of
// the lines shown always equals the total shown (no off-by-a-tiyn drift).
export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

// Unit costs carry 4 decimals (a kilo of flour split over many loaves).
export const round4 = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;

// Quantities carry 3 decimals.
export const round3 = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;
