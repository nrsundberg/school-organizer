import { getPrisma } from "~/db.server";
import {
  checkRateLimit,
  clientIpFromRequest,
  getRateLimiter,
} from "~/domain/utils/rate-limit.server";
import {
  canonicalUrl,
  publicSiteOrigin,
  rootDomainFromContext,
} from "~/lib/marketing-seo";
import { getMeetingUrl } from "~/lib/site";
import { parseBookingForm, type BookingFormError } from "./form";
import { notifyBooking } from "./notify.server";
import { bookingStoreFromPrisma } from "./prisma-store.server";
import {
  bookingRulesFromContext,
  formatSlotRange,
  generateSlots,
  safeTimeZone,
  type BookingKind,
  type Slot,
} from "./rules";
import { reserveBooking, moveBooking, type BookingRecord } from "./store";
import { bookingTokenSecret, signBookingToken, verifyBookingToken } from "./token";
import { turnstileSiteKey, verifyTurnstileFromContext } from "./turnstile";

export type BookingActionData =
  | { status: "sent"; whenLabel: string; meetingUrl: string | null }
  | { status: "error"; code: BookingFormError | "rate" | "turnstile" | "taken" | "full" }
  | { status: "managed"; event: "cancelled" | "rescheduled"; whenLabel: string }
  | { status: "closed" };

export async function loadOpenSlots(
  context: any,
  kind: BookingKind,
  now = new Date(),
): Promise<{ slots: Slot[]; timeZone: string; siteKey: string | null }> {
  const rules = bookingRulesFromContext(context);
  const store = bookingStoreFromPrisma(getPrisma(context));
  const from = now;
  const to = new Date(now.getTime() + rules.horizonMs);
  const [starts, countsByDay] = await Promise.all([
    store.takenStarts(from, to),
    store.countsByDay(rules.timeZone, from, to),
  ]);
  const taken = new Set(starts.map((start) => start.toISOString()));
  return {
    slots: generateSlots({ now, rules, taken, countsByDay }),
    timeZone: rules.timeZone,
    siteKey: turnstileSiteKey(context),
  };
}

export async function submitPublicBooking(args: {
  request: Request;
  context: any;
  kind: BookingKind;
  locale: string;
}): Promise<BookingActionData> {
  const form = await args.request.formData();
  const parsed = parseBookingForm(form, args.kind);
  const limit = await checkRateLimit({
    limiter: getRateLimiter(args.context, "RL_AUTH"),
    key: `${args.kind}:${clientIpFromRequest(args.request)}`,
  });
  if (!limit.ok) return { status: "error", code: "rate" };
  if (!parsed.ok) return { status: "error", code: parsed.error };
  if (parsed.honeypot) return { status: "sent", whenLabel: "", meetingUrl: null };

  const turnstile = await verifyTurnstileFromContext({
    context: args.context,
    request: args.request,
    token: parsed.value.turnstileToken,
    expectedAction: args.kind,
    remoteIp: clientIpFromRequest(args.request),
  });
  if (!turnstile.ok) return { status: "error", code: "turnstile" };

  const now = new Date();
  const rules = bookingRulesFromContext(args.context);
  const wanted = new Date(parsed.value.startsAt);
  const offered = generateSlots({ now, rules });
  const match = offered.find((slot) => slot.start.toISOString() === wanted.toISOString());
  if (!match) return { status: "error", code: "slot" };

  const store = bookingStoreFromPrisma(getPrisma(args.context));
  const stillOpen = generateSlots({
    now,
    rules,
    taken: new Set(
      (await store.takenStarts(now, new Date(now.getTime() + rules.horizonMs))).map((start) =>
        start.toISOString(),
      ),
    ),
    countsByDay: await store.countsByDay(
      rules.timeZone,
      now,
      new Date(now.getTime() + rules.horizonMs),
    ),
  });
  if (!stillOpen.some((slot) => slot.start.toISOString() === match.start.toISOString())) {
    return { status: "error", code: "taken" };
  }

  const reserved = await reserveBooking(store, {
    kind: args.kind,
    startsAt: match.start,
    endsAt: match.end,
    name: parsed.value.name,
    email: parsed.value.email,
    role: parsed.value.role || null,
    school: parsed.value.school,
    phone: parsed.value.phone || null,
    studentCount: parsed.value.studentCount || null,
    message: parsed.value.message || null,
    visitorTimeZone: safeTimeZone(parsed.value.visitorTimeZone, rules.timeZone),
    dayKey: match.dayKey,
    scheduleTimeZone: rules.timeZone,
    maxPerDay: rules.maxPerDay,
  });
  if (!reserved.ok) return { status: "error", code: reserved.error };

  const origin = publicSiteOrigin(args.request, rootDomainFromContext(args.context));
  const manageUrl = await manageUrlFor(args.context, origin, reserved.booking.id, now);
  await notifyBooking({
    context: args.context,
    booking: reserved.booking,
    event: "confirmed",
    scheduleTimeZone: rules.timeZone,
    manageUrl,
    meetingUrl: getMeetingUrl(args.context),
    locale: args.locale,
  });
  const label = formatSlotRange(
    reserved.booking.startsAt,
    reserved.booking.endsAt,
    reserved.booking.visitorTimeZone,
    args.locale,
  );
  return {
    status: "sent",
    whenLabel: `${label.day}, ${label.time} ${label.zone}`,
    meetingUrl: getMeetingUrl(args.context),
  };
}

async function manageUrlFor(
  context: any,
  origin: string,
  bookingId: string,
  now: Date,
): Promise<string> {
  const secret = bookingTokenSecret(context);
  if (!secret) return canonicalUrl(origin, "/demo");
  const token = await signBookingToken(secret, bookingId, now);
  return `${canonicalUrl(origin, "/book/manage")}?token=${encodeURIComponent(token)}`;
}

export async function loadManagedBooking(
  request: Request,
  context: any,
): Promise<{ booking: BookingRecord; token: string; slots: Slot[]; timeZone: string } | null> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const secret = bookingTokenSecret(context);
  if (!secret || !token) return null;
  const verified = await verifyBookingToken(secret, token, new Date());
  if (!verified) return null;
  const store = bookingStoreFromPrisma(getPrisma(context));
  const booking = await store.findById(verified.id);
  if (!booking) return null;
  const rules = bookingRulesFromContext(context);
  const now = new Date();
  const taken = new Set(
    (await store.takenStarts(now, new Date(now.getTime() + rules.horizonMs))).map((start) =>
      start.toISOString(),
    ),
  );
  taken.delete(booking.startsAt.toISOString());
  const counts = await store.countsByDay(
    rules.timeZone,
    now,
    new Date(now.getTime() + rules.horizonMs),
  );
  return {
    booking,
    token,
    timeZone: rules.timeZone,
    slots: generateSlots({ now, rules, taken, countsByDay: counts }),
  };
}

export async function actOnManagedBooking(args: {
  request: Request;
  context: any;
  locale: string;
}): Promise<BookingActionData> {
  const form = await args.request.formData();
  const token = typeof form.get("token") === "string" ? String(form.get("token")) : "";
  const intent = typeof form.get("intent") === "string" ? String(form.get("intent")) : "";
  const secret = bookingTokenSecret(args.context);
  if (!secret) return { status: "error", code: "slot" };
  const verified = await verifyBookingToken(secret, token, new Date());
  if (!verified) return { status: "closed" };

  const limit = await checkRateLimit({
    limiter: getRateLimiter(args.context, "RL_AUTH"),
    key: `manage:${clientIpFromRequest(args.request)}`,
  });
  if (!limit.ok) return { status: "error", code: "rate" };

  const store = bookingStoreFromPrisma(getPrisma(args.context));
  const booking = await store.findById(verified.id);
  if (!booking || booking.status !== "confirmed") return { status: "closed" };
  const rules = bookingRulesFromContext(args.context);
  const now = new Date();
  const origin = publicSiteOrigin(args.request, rootDomainFromContext(args.context));
  const manageUrl = await manageUrlFor(args.context, origin, booking.id, now);

  if (intent === "cancel") {
    await store.cancel(booking.id, now, booking.sequence + 1);
    const cancelled: BookingRecord = {
      ...booking,
      status: "cancelled",
      slotKey: null,
      sequence: booking.sequence + 1,
    };
    await notifyBooking({
      context: args.context,
      booking: cancelled,
      event: "cancelled",
      scheduleTimeZone: rules.timeZone,
      manageUrl,
      meetingUrl: getMeetingUrl(args.context),
      locale: args.locale,
    });
    return { status: "managed", event: "cancelled", whenLabel: "" };
  }

  const startsAt = typeof form.get("startsAt") === "string" ? String(form.get("startsAt")) : "";
  const wanted = new Date(startsAt);
  const offered = generateSlots({ now, rules });
  const match = offered.find((slot) => slot.start.toISOString() === wanted.toISOString());
  if (!match) return { status: "error", code: "slot" };
  const moved = await moveBooking(store, booking, {
    startsAt: match.start,
    endsAt: match.end,
    dayKey: match.dayKey,
    scheduleTimeZone: rules.timeZone,
    maxPerDay: rules.maxPerDay,
  });
  if (!moved.ok) return { status: "error", code: moved.error === "closed" ? "slot" : moved.error };
  const next: BookingRecord = {
    ...booking,
    startsAt: match.start,
    endsAt: match.end,
    sequence: booking.sequence + 1,
    slotKey: match.start.toISOString(),
  };
  await notifyBooking({
    context: args.context,
    booking: next,
    event: "rescheduled",
    scheduleTimeZone: rules.timeZone,
    manageUrl,
    meetingUrl: getMeetingUrl(args.context),
    locale: args.locale,
  });
  const label = formatSlotRange(next.startsAt, next.endsAt, next.visitorTimeZone, args.locale);
  return {
    status: "managed",
    event: "rescheduled",
    whenLabel: `${label.day}, ${label.time} ${label.zone}`,
  };
}
