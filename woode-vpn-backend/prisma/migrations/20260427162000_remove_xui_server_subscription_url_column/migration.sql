-- Remove deprecated remote subscription endpoint column.
-- We now build subscription configs locally via inbounds + buildConfig.
ALTER TABLE "XuiServer"
DROP COLUMN IF EXISTS "subscriptionUrl";
