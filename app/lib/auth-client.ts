import { createAuthClient } from "better-auth/react";
import { adminClient, inferAdditionalFields } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
  plugins: [
    adminClient(),
    inferAdditionalFields({
      user: {
        role: { type: "string", required: false },
        mustChangePassword: { type: "boolean", required: false },
        controllerViewPreference: { type: "string", required: false },
        phone: { type: "string", required: false },
      },
    }),
  ],
});

export const { signIn, signOut, signUp, useSession } = authClient;
