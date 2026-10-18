import { getSignupNotifyEmail } from "~/lib/site";
import { enqueueEmail } from "./queue.server";

export type NewSignupNotice = {
  schoolName: string;
  personName: string | null;
  personEmail: string;
  plan: string;
  signedUpAt: Date;
};

/**
 * Tell the founder a trial just started.
 *
 * Uses the existing EMAIL_QUEUE → Resend path. Any failure is logged and
 * swallowed so signup still succeeds when the queue or provider is down.
 */
export async function notifyNewSignup(
  context: any,
  notice: NewSignupNotice,
): Promise<void> {
  try {
    await enqueueEmail(context, {
      kind: "signup_notification",
      to: getSignupNotifyEmail(context),
      schoolName: notice.schoolName,
      personName: notice.personName,
      personEmail: notice.personEmail,
      plan: notice.plan,
      signedUpAt: notice.signedUpAt.toISOString(),
      locale: "en",
    });
  } catch (err) {
    console.error("notifyNewSignup failed", err);
  }
}
