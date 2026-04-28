CREATE INDEX IF NOT EXISTS "subscription_active_window_lookup_idx"
ON "Subscription" ("userId", "status", "startsAt", "endsAt");
