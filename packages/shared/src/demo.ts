// «Песочница» — a separate demo company with invented data, made by the owner
// so someone (a financier, an accountant) can explore the platform without
// seeing the real books. It lives in the same database as a separate
// organization; its login is a «Бухгалтер» of that organization only.

export type DemoCompanyState = "NONE" | "GENERATING" | "READY" | "INTERRUPTED" | "FAILED";

export interface DemoCompanyStatusDto {
  state: DemoCompanyState;
  name: string | null;
  // The sandbox login (its password is shown only when it is set).
  email: string | null;
  // While generating: days of history done out of all.
  progress: { done: number; total: number } | null;
  // The period the invented history covers ("YYYY-MM-DD", Almaty).
  periodFrom: string | null;
  periodTo: string | null;
  error: string | null;
}

export interface DemoCompanyCredentialsDto {
  email: string;
  password: string;
}
