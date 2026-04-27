-- Add stored x-ui usage totals as bigint
ALTER TABLE "VpnProfile"
ADD COLUMN IF NOT EXISTS "usageUploadBytes" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "usageDownloadBytes" BIGINT NOT NULL DEFAULT 0;
