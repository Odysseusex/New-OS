-- CreateTable
CREATE TABLE "stock_voids" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_voids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_void_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "voidId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,

    CONSTRAINT "stock_void_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_voids_organizationId_productId_idx" ON "stock_voids"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_void_lines_movementId_key" ON "stock_void_lines"("movementId");

-- CreateIndex
CREATE INDEX "stock_void_lines_voidId_idx" ON "stock_void_lines"("voidId");

-- AddForeignKey
ALTER TABLE "stock_voids" ADD CONSTRAINT "stock_voids_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_voids" ADD CONSTRAINT "stock_voids_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_voids" ADD CONSTRAINT "stock_voids_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_void_lines" ADD CONSTRAINT "stock_void_lines_voidId_fkey" FOREIGN KEY ("voidId") REFERENCES "stock_voids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_void_lines" ADD CONSTRAINT "stock_void_lines_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "stock_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

