import type { NeutralAuthEmailAction } from "./templates.ts";

export type AuthEmailAction = NeutralAuthEmailAction;
export type AuthEmailRecipientSlot = "primary" | "current" | "new";

export interface ParsedAuthEmailHookPayload {
  readonly userId: string;
  readonly action: AuthEmailAction;
  readonly redirectTo: string | null;
  readonly siteUrl: string | null;
  readonly deliveries: readonly {
    readonly slot: AuthEmailRecipientSlot;
    readonly tokenHash: string | null;
    readonly oneTimeCode: string | null;
    readonly recipientEmail: string;
  }[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;
const AUTH_ACTIONS = new Set<AuthEmailAction>([
  "signup",
  "recovery",
  "magiclink",
  "invite",
  "email_change",
  "email",
  "reauthentication",
  "password_changed_notification",
  "email_changed_notification",
  "phone_changed_notification",
  "identity_linked_notification",
  "identity_unlinked_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
]);
const NOTIFICATION_ACTIONS = new Set<AuthEmailAction>([
  "password_changed_notification",
  "email_changed_notification",
  "phone_changed_notification",
  "identity_linked_notification",
  "identity_unlinked_notification",
  "mfa_factor_enrolled_notification",
  "mfa_factor_unenrolled_notification",
]);
const LINK_ACTIONS = new Set<AuthEmailAction>([
  "signup",
  "recovery",
  "magiclink",
  "invite",
  "email_change",
  "email",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length > 0
    && normalized.length <= maximumLength
    && !/[\u0000-\u001F\u007F]/.test(normalized)
    ? normalized
    : "";
}

function validateRedirectUrl(value: unknown) {
  const candidate = boundedString(value, 4096);
  if (!candidate) throw new TypeError("Invalid Auth email redirect.");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError("Invalid Auth email redirect.");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
    throw new TypeError("Invalid Auth email redirect.");
  }
  return url.toString();
}

function validateOptionalRedirectUrl(value: unknown) {
  return boundedString(value, 4096) ? validateRedirectUrl(value) : null;
}

function validateRecipientEmail(value: unknown) {
  const email = boundedString(value, 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new TypeError("Invalid Auth email recipient.");
  }
  return email;
}

export function parseAuthEmailHookPayload(rawBody: string): ParsedAuthEmailHookPayload {
  if (rawBody.length < 2 || rawBody.length > 65_536) {
    throw new TypeError("Invalid Auth email hook payload.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new TypeError("Invalid Auth email hook payload.");
  }

  const root = asRecord(parsed);
  const user = asRecord(root?.user);
  const emailData = asRecord(root?.email_data);
  const userId = boundedString(user?.id, 64);
  const action = boundedString(emailData?.email_action_type, 64) as AuthEmailAction;
  const tokenHash = boundedString(emailData?.token_hash, 2048);
  const tokenHashNew = boundedString(emailData?.token_hash_new, 2048);
  const oneTimeCode = boundedString(emailData?.token, 32);
  if (!UUID_PATTERN.test(userId) || !AUTH_ACTIONS.has(action)) {
    throw new TypeError("Invalid Auth email hook payload.");
  }

  const currentEmail = validateRecipientEmail(user?.email);
  if (NOTIFICATION_ACTIONS.has(action)) {
    const recipientEmail = action === "email_changed_notification"
      ? validateRecipientEmail(emailData?.old_email)
      : currentEmail;
    return {
      userId,
      action,
      redirectTo: validateOptionalRedirectUrl(emailData?.redirect_to),
      siteUrl: validateRedirectUrl(emailData?.site_url),
      deliveries: [{
        slot: "primary",
        tokenHash: null,
        oneTimeCode: null,
        recipientEmail,
      }],
    };
  }

  const redirectTo = validateRedirectUrl(emailData?.redirect_to);
  const siteUrl = validateRedirectUrl(emailData?.site_url);
  if (action === "reauthentication") {
    if (!tokenHash || !/^[0-9]{6,10}$/.test(oneTimeCode)) {
      throw new TypeError("Invalid Auth email hook payload.");
    }
    return {
      userId,
      action,
      redirectTo,
      siteUrl,
      deliveries: [{
        slot: "primary",
        tokenHash,
        oneTimeCode,
        recipientEmail: currentEmail,
      }],
    };
  }
  if (action !== "email_change") {
    if (!tokenHash) throw new TypeError("Invalid Auth email hook payload.");
    return {
      userId,
      action,
      redirectTo,
      siteUrl,
      deliveries: [{
        slot: "primary",
        tokenHash,
        oneTimeCode: null,
        recipientEmail: currentEmail,
      }],
    };
  }

  const newEmail = validateRecipientEmail(user?.new_email);
  if (tokenHash && tokenHashNew) {
    return {
      userId,
      action,
      redirectTo,
      siteUrl,
      deliveries: [
        {
          slot: "current",
          tokenHash: tokenHashNew,
          oneTimeCode: null,
          recipientEmail: currentEmail,
        },
        {
          slot: "new",
          tokenHash,
          oneTimeCode: null,
          recipientEmail: newEmail,
        },
      ],
    };
  }
  if (tokenHash) {
    return {
      userId,
      action,
      redirectTo,
      siteUrl,
      deliveries: [{
        slot: "new",
        tokenHash,
        oneTimeCode: null,
        recipientEmail: newEmail,
      }],
    };
  }
  throw new TypeError("Invalid Auth email hook payload.");
}

function validatedSupabaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid Supabase URL.");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !localHttp)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new TypeError("Invalid Supabase URL.");
  }
  return url;
}

export function buildAuthActionUrl(input: {
  readonly supabaseUrl: string;
  readonly tokenHash: string;
  readonly action: AuthEmailAction;
  readonly redirectTo: string;
}) {
  const supabaseUrl = validatedSupabaseUrl(input.supabaseUrl);
  const tokenHash = boundedString(input.tokenHash, 2048);
  if (!tokenHash || !LINK_ACTIONS.has(input.action)) {
    throw new TypeError("Invalid Auth action URL input.");
  }
  const redirectTo = validateRedirectUrl(input.redirectTo);
  const basePath = supabaseUrl.pathname.replace(/\/+$/, "");
  supabaseUrl.pathname = basePath.endsWith("/auth/v1")
    ? `${basePath}/verify`
    : `${basePath}/auth/v1/verify`;
  const url = supabaseUrl;
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", input.action);
  url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}
