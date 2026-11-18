"use client";
import { createBrowserClient } from "@supabase/ssr";
let client: ReturnType<typeof createBrowserClient> | undefined;
export function browserDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error(
      "TripMate is not configured. Set the Supabase URL and publishable key.",
    );
  return (client ??= createBrowserClient(url, key));
}
let signingIn: Promise<string> | undefined;
export async function ensureIdentity(): Promise<string> {
  if (signingIn) return signingIn;
  signingIn = (async () => {
    const db = browserDb();
    const { data, error } = await db.auth.getUser();
    if (data.user) return data.user.id;
    // A missing local session is normal. An unavailable Auth server must not replace an existing identity.
    const { data: session } = await db.auth.getSession();
    if (session.session)
      throw new Error(
        error?.message || "Unable to verify your session. Please retry.",
      );
    const result = await db.auth.signInAnonymously();
    if (result.error || !result.data.user)
      throw new Error(
        "Unable to start your private session. Enable anonymous sign-ins in Supabase and try again.",
      );
    return result.data.user.id;
  })();
  try {
    return await signingIn;
  } finally {
    signingIn = undefined;
  }
}
