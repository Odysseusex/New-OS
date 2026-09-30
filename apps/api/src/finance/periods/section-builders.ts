// A section a later module adds to a period snapshot (the balance sheet, the
// inventory roll-forward…). Kept behind an interface so closing a period does
// not have to know which statements exist.
export interface PeriodSectionBuilder {
  key: string;
  build(organizationId: string, from: Date, to: Date): Promise<unknown>;
}
