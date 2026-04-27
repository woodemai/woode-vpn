-- Backfill required fields before enforcing NOT NULL
UPDATE "User"
SET "externalId" = CONCAT('user-', "id")
WHERE "externalId" IS NULL OR trim("externalId") = '';

UPDATE "User"
SET "telegramName" = "externalId"
WHERE "telegramName" IS NULL OR trim("telegramName") = '';

DROP INDEX IF EXISTS "User_email_key";

ALTER TABLE "User"
ALTER COLUMN "externalId" SET NOT NULL,
ALTER COLUMN "telegramName" SET NOT NULL;

ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
