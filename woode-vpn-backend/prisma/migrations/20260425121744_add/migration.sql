-- CreateTable
CREATE TABLE "SubscriptionConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "supportUrl" TEXT,
    "profileUrl" TEXT,
    "announce" TEXT NOT NULL,
    "updateIntervalHours" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionConfig_pkey" PRIMARY KEY ("id")
);
