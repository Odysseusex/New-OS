-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "bin" TEXT,
ADD COLUMN     "paymentTermDays" INTEGER;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "bin" TEXT,
ADD COLUMN     "legalName" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "paymentDueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "bin" TEXT,
ADD COLUMN     "paymentTermDays" INTEGER;

