import { createAuthSendEmailHookHandler } from "./handler.ts";

declare const Deno: {
  readonly env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

const handler = createAuthSendEmailHookHandler({
  environment: {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    supabaseAnonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    sendEmailHookSecret: Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "",
    emailLedgerRpcSecret: Deno.env.get("EMAIL_LEDGER_RPC_SECRET") ?? "",
    brevoApiKey: Deno.env.get("BREVO_API_KEY") ?? "",
    senderEmail: Deno.env.get("ORGANIZATECH_EMAIL_SENDER") ?? "",
    senderName: Deno.env.get("ORGANIZATECH_EMAIL_SENDER_NAME") ?? "Organizatech",
  },
});

Deno.serve(handler);
