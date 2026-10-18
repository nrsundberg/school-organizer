/**
 * Demo request parsing. The honeypot field must stay empty. A filled honeypot
 * is a successful no-op so the caller can show the confirmation screen
 * without sending mail.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type DemoRequestInput = {
  name: string;
  role: string;
  school: string;
  email: string;
  phone: string;
  studentCount: string;
  message: string;
};

export type DemoFormError = "name" | "role" | "school" | "email";

export type DemoFormResult =
  | { ok: true; honeypot: true }
  | { ok: true; honeypot: false; value: DemoRequestInput }
  | { ok: false; error: DemoFormError };

function field(form: FormData, name: string, max: number): string {
  const raw = form.get(name);
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.slice(0, max);
}

export function parseDemoForm(form: FormData): DemoFormResult {
  const honeypot = field(form, "website", 200);
  if (honeypot.length > 0) return { ok: true, honeypot: true };

  const name = field(form, "name", 120);
  const role = field(form, "role", 80);
  const school = field(form, "school", 160);
  const email = field(form, "email", 200);
  const phone = field(form, "phone", 40);
  const studentCount = field(form, "studentCount", 40);
  const message = field(form, "message", 2000);

  if (!name) return { ok: false, error: "name" };
  if (!role) return { ok: false, error: "role" };
  if (!school) return { ok: false, error: "school" };
  if (!email || !EMAIL.test(email)) return { ok: false, error: "email" };

  return {
    ok: true,
    honeypot: false,
    value: { name, role, school, email, phone, studentCount, message },
  };
}
