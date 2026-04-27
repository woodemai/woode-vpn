-- Add stored x-ui usage totals for subscription payloads
ALTER TABLE "VpnProfile"
ADD COLUMN "usageRefreshedAt" TIMESTAMP(3);
