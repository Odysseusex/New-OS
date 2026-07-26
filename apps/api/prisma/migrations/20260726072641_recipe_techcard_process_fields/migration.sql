-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "doughTempC" DECIMAL(5,2),
ADD COLUMN     "mixingTimeFastMinutes" INTEGER,
ADD COLUMN     "mixingTimeSlowMinutes" INTEGER,
ADD COLUMN     "pieceWeightG" DECIMAL(8,2),
ADD COLUMN     "proofingHumidityPercent" DECIMAL(5,2),
ADD COLUMN     "proofingTempC" DECIMAL(5,2),
ADD COLUMN     "shapingWeightG" DECIMAL(8,2),
ADD COLUMN     "steamSeconds" INTEGER;

