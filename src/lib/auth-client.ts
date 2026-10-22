"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// The dashboard is served by the chatbot app itself: same-origin by default.
// An explicit base URL is only needed for unusual hosting.
export const authClient = createAuthClient({
  ...(process.env.NEXT_PUBLIC_CHATBOT_BASE_URL
    ? { baseURL: process.env.NEXT_PUBLIC_CHATBOT_BASE_URL }
    : {}),
  plugins: [twoFactorClient()],
});
