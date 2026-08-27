import { createWelcomeEmailHandler } from "./handler.ts";

declare const Deno: {
  readonly env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

const handler = createWelcomeEmailHandler({
  environment: {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    emailLedgerRpcSecret: Deno.env.get("EMAIL_LEDGER_RPC_SECRET") ?? "",
    brevoApiKey: Deno.env.get("BREVO_API_KEY") ?? "",
    senderEmail: Deno.env.get("ORGANIZATECH_EMAIL_SENDER") ?? "",
    senderName: Deno.env.get("ORGANIZATECH_EMAIL_SENDER_NAME") ?? "Organizatech",
    appUrl: Deno.env.get("ORGANIZATECH_APP_URL") ?? "",
  },
});

Deno.serve(handler);
