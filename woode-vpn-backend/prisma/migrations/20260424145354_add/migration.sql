-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "notified1DayBefore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notified3DaysBefore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifiedAfterExpiration" BOOLEAN NOT NULL DEFAULT false;
