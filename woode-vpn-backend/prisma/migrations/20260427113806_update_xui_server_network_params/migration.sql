-- Make new network columns nullable first, backfill from adminUrl, then enforce NOT NULL
ALTER TABLE "XuiServer"
ADD COLUMN IF NOT EXISTS "host" TEXT,
ADD COLUMN IF NOT EXISTS "port" INTEGER,
ADD COLUMN IF NOT EXISTS "webBasePath" TEXT;

-- Parse adminUrl like: https://host:port/base/path
UPDATE "XuiServer"
SET
  "host" = COALESCE(
    "host",
    NULLIF(substring("adminUrl" FROM '^[a-zA-Z]+://([^/:?#]+)'), '')
  ),
  "port" = COALESCE(
    "port",
    NULLIF(substring("adminUrl" FROM '^[a-zA-Z]+://[^/:?#]+:([0-9]+)'), '')::INTEGER,
    CASE
      WHEN "adminUrl" ~* '^https://' THEN 443
      WHEN "adminUrl" ~* '^http://' THEN 80
      ELSE 443
    END
  ),
  "webBasePath" = COALESCE(
    NULLIF("webBasePath", ''),
    NULLIF(substring("adminUrl" FROM '^[a-zA-Z]+://[^/]+(/[^?#]*)'), ''),
    '/'
  )
WHERE "adminUrl" IS NOT NULL;

UPDATE "XuiServer"
SET
  "host" = COALESCE(NULLIF("host", ''), CONCAT('xui-server-', "id")),
  "port" = COALESCE("port", 443),
  "webBasePath" = COALESCE(NULLIF("webBasePath", ''), '/');

ALTER TABLE "XuiServer"
ALTER COLUMN "host" SET NOT NULL,
ALTER COLUMN "port" SET NOT NULL,
ALTER COLUMN "webBasePath" SET NOT NULL;

ALTER TABLE "XuiServer" DROP COLUMN IF EXISTS "adminUrl";

CREATE UNIQUE INDEX IF NOT EXISTS "XuiServer_host_key" ON "XuiServer"("host");
