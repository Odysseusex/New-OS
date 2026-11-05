-- «Оплата труда» flag on a finance article: presentation of unpaid wages in the balance sheet.
ALTER TABLE "finance_categories" ADD COLUMN "payroll" BOOLEAN NOT NULL DEFAULT false;
