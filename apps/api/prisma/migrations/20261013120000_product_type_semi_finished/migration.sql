-- Semi-finished products (полуфабрикаты): a new product type. Purely additive — one
-- enum value; no product, recipe, sale, stock or accounting row is touched.
ALTER TYPE "ProductType" ADD VALUE IF NOT EXISTS 'SEMI_FINISHED';
