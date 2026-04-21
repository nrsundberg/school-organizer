ALTER TABLE "StripeWebhookEvent" ADD COLUMN "processedAt" DATETIME;
ALTER TABLE "StripeWebhookEvent" ADD COLUMN "lastError" TEXT;
