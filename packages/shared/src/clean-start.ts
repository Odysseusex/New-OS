// «Начать учёт с чистого листа»: the owner wipes the transactional history of the
// organization (sales, stock, production, purchases, money, periods, points) and keeps
// the reference data (products, recipes, points of sale, people, counterparties,
// articles, accounts). Then opening balances are entered and finance is started again.

export interface CleanStartGroupDto {
  label: string;
  count: number;
}

export interface CleanStartPreviewDto {
  // What will be deleted, by group (main documents counted, their lines go with them).
  remove: CleanStartGroupDto[];
  // What stays untouched.
  keep: CleanStartGroupDto[];
  // The last full backup download (the reset is refused without one in the last 24 h).
  lastBackupAt: string | null;
  backupFresh: boolean;
}

export interface CleanStartResultDto {
  removed: CleanStartGroupDto[];
  at: string;
}

// The word typed to confirm; the server checks it too.
export const CLEAN_START_CONFIRMATION = "ОЧИСТИТЬ";
export const CLEAN_START_BACKUP_HOURS = 24;
