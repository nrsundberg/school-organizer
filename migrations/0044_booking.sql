-- Public demo and intro-call bookings. Not tenant-scoped.
-- slotKey is the UTC start while a booking is confirmed, shared by demos
-- and intro calls. Cancelling sets it to NULL,
-- which SQLite does not treat as a duplicate, so the slot can be booked again.
CREATE TABLE IF NOT EXISTS "Booking" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "slotKey" TEXT,
  "startsAt" DATETIME NOT NULL,
  "endsAt" DATETIME NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT,
  "school" TEXT,
  "phone" TEXT,
  "studentCount" TEXT,
  "message" TEXT,
  "visitorTimeZone" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_slotKey_key" ON "Booking"("slotKey");
CREATE INDEX IF NOT EXISTS "Booking_kind_startsAt_idx" ON "Booking"("kind", "startsAt");
CREATE INDEX IF NOT EXISTS "Booking_email_idx" ON "Booking"("email");
