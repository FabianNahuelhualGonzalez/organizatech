import type { SupabaseClient } from "@supabase/supabase-js";

const WELCOME_EMAIL_FUNCTION = "send-welcome-email";
const WELCOME_EMAIL_REQUEST_TIMEOUT_MILLISECONDS = 7_000;

export async function requestWelcomeEmailBestEffort(
  client: SupabaseClient,
): Promise<void> {
  try {
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      WELCOME_EMAIL_REQUEST_TIMEOUT_MILLISECONDS,
    );
    try {
      await client.functions.invoke(WELCOME_EMAIL_FUNCTION, {
        body: {},
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // La membresía ya existe: el correo nunca puede cambiar el resultado del registro.
  }
}
