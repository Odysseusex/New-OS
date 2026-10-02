-- Packaging becomes its own product type. Additive: no row uses the new value
-- yet, and every existing product keeps its type.
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'PACKAGING';
