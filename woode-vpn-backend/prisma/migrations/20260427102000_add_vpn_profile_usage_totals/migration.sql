-- Add stored x-ui usage totals for subscription payloads
ALTER TABLE "VpnProfile"
ADD COLUMN "usageUploadBytes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "usageDownloadBytes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "usageRefreshedAt" TIMESTAMP(3);
