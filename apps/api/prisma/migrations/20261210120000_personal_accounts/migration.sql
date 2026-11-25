-- AlterEnum
ALTER TYPE "CashAccountType" ADD VALUE 'PERSONAL';

-- AlterEnum
ALTER TYPE "SupplierIntakePayment" ADD VALUE 'PERSONAL';

-- AlterTable
ALTER TABLE "supplier_intakes" ADD COLUMN     "paymentAccountId" TEXT,
ADD COLUMN     "paymentAccountName" TEXT;

