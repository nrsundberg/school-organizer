import { getSignupNotifyEmail } from "~/lib/site";
import { enqueueEmail } from "./queue.server";
import type { DemoRequestInput } from "~/lib/demo-form";

/**
 * Tell the founder someone asked for a demo.
 *
 * Uses the same EMAIL_QUEUE → Resend path as the signup alert. A queue
 * failure is logged and swallowed so the visitor still sees confirmation.
 */
export async function notifyDemoRequest(
  context: any,
  request: DemoRequestInput,
  submittedAt: Date,
): Promise<void> {
  try {
    await enqueueEmail(context, {
      kind: "demo_request",
      to: getSignupNotifyEmail(context),
      name: request.name,
      role: request.role,
      school: request.school,
      email: request.email,
      phone: request.phone || null,
      studentCount: request.studentCount || null,
      message: request.message || null,
      submittedAt: submittedAt.toISOString(),
      locale: "en",
    });
  } catch (err) {
    console.error("notifyDemoRequest failed", err);
  }
}
