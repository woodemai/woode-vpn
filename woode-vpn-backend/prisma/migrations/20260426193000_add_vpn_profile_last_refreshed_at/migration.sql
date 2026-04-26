-- Add throttling timestamp for background subscription refresh
ALTER TABLE "VpnProfile"
ADD COLUMN "lastRefreshedAt" TIMESTAMP(3);
