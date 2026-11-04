-- Goods given away for tasting get their own write-off reason (ТЗ §3.4).
-- Additive: a new enum value, nothing existing changes.
ALTER TYPE "WriteOffReason" ADD VALUE 'TASTING';
