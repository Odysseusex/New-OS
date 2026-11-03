-- Raw material used above a production batch's recipe norm is written off
-- with its own reason. Additive: a new enum value, nothing existing changes.
ALTER TYPE "WriteOffReason" ADD VALUE 'PRODUCTION_OVERUSE';
