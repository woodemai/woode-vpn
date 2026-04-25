-- CreateIndex
CREATE INDEX "Subscription_status_endsAt_idx" ON "Subscription"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Subscription_status_endsAt_notified3DaysBefore_idx" ON "Subscription"("status", "endsAt", "notified3DaysBefore");

-- CreateIndex
CREATE INDEX "Subscription_status_endsAt_notified1DayBefore_idx" ON "Subscription"("status", "endsAt", "notified1DayBefore");

-- CreateIndex
CREATE INDEX "Subscription_status_endsAt_notifiedAfterExpiration_idx" ON "Subscription"("status", "endsAt", "notifiedAfterExpiration");
