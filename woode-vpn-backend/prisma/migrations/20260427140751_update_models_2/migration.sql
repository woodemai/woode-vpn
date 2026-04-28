/*
  Warnings:

  - You are about to drop the column `clientMappings` on the `VpnProfile` table. All the data in the column will be lost.
  - You are about to drop the column `usageRefreshedAt` on the `VpnProfile` table. All the data in the column will be lost.
  - You are about to drop the column `inboundIds` on the `XuiServer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "VpnProfile" DROP COLUMN "clientMappings",
DROP COLUMN "usageRefreshedAt";

-- AlterTable
ALTER TABLE "XuiServer" DROP COLUMN "inboundIds";
