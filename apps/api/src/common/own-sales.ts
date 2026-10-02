// Goods sold «под реализацию» belong to somebody else: the money is collected
// for their owner and is never our revenue, cost or margin. Sale and SaleReturn
// carry `consignmentAmount` (the part of their total that is such goods), so
// "our" figure is always the total minus it.
//
// Money questions (what the till took, what a customer owes, what a refund
// paid out) keep using totalAmount — the cash really moved. Every revenue,
// cost, margin and sales-analytics question uses this.
export const ownAmount = (doc: { totalAmount: { toNumber(): number }; consignmentAmount: { toNumber(): number } }): number =>
  doc.totalAmount.toNumber() - doc.consignmentAmount.toNumber();

// Prisma filter for lines that are ours (not consignment).
export const OWN_ITEMS = { consignmentSupplierId: null } as const;
