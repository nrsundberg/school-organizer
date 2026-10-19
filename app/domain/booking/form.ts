import type { BookingKind } from "./rules";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BookingFormError = "name" | "role" | "school" | "email" | "slot";

export type BookingInput = {
  name: string;
  role: string;
  school: string;
  email: string;
  phone: string;
  studentCount: string;
  message: string;
  startsAt: string;
  visitorTimeZone: string;
  turnstileToken: string;
};

export type BookingFormResult =
  | { ok: true; honeypot: true }
  | { ok: true; honeypot: false; value: BookingInput }
  | { ok: false; error: BookingFormError };

function field(form: FormData, name: string, max: number): string {
  const raw = form.get(name);
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.slice(0, max);
}

export function parseBookingForm(form: FormData, kind: BookingKind): BookingFormResult {
  const honeypot = field(form, "website", 200);
  if (honeypot.length > 0) return { ok: true, honeypot: true };

  const name = field(form, "name", 120);
  const role = field(form, "role", 80);
  const school = field(form, "school", 160);
  const email = field(form, "email", 200);
  const phone = field(form, "phone", 40);
  const studentCount = field(form, "studentCount", 40);
  const message = field(form, "message", 2000);
  const startsAt = field(form, "startsAt", 40);
  const visitorTimeZone = field(form, "visitorTimeZone", 80);
  const turnstileToken = field(form, "cf-turnstile-response", 2048);

  if (!name) return { ok: false, error: "name" };
  if (kind === "demo" && !role) return { ok: false, error: "role" };
  if (!school) return { ok: false, error: "school" };
  if (!email || !EMAIL.test(email)) return { ok: false, error: "email" };
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) {
    return { ok: false, error: "slot" };
  }

  return {
    ok: true,
    honeypot: false,
    value: {
      name,
      role,
      school,
      email,
      phone,
      studentCount,
      message,
      startsAt,
      visitorTimeZone,
      turnstileToken,
    },
  };
}
