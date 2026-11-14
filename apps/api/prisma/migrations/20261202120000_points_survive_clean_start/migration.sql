-- «Начать учёт с чистого листа» keeps the bonus points: the checks they came from are deleted,
-- so an entry may lose its link to a sale / a return — and nothing else. Any other change of a
-- points entry is still refused.
CREATE OR REPLACE FUNCTION loyalty_points_reject_update() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'saleId' - 'saleReturnId') = (to_jsonb(OLD) - 'saleId' - 'saleReturnId')
     AND (NEW."saleId" IS NULL OR NEW."saleId" = OLD."saleId")
     AND (NEW."saleReturnId" IS NULL OR NEW."saleReturnId" = OLD."saleReturnId") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Движение баллов не изменяется: исправление вносится новой записью';
END;
$$ LANGUAGE plpgsql;
