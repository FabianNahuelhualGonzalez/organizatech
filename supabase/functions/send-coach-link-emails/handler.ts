import { BrevoEmailError, sendBrevoTransactionalEmail } from "../_shared/email-onboarding/brevo-client.ts";
import {
  bearerTokenFromRequest,
  getAuthenticatedAuthUser,
  invokeEmailRpc,
} from "../_shared/email-onboarding/supabase-rest.ts";
import {
  renderCoachInvitationEmail,
  renderCoachLinkEmail,
  type CoachInvitationEmailAudience,
  type CoachLinkEmailAudience,
} from "../_shared/coach-linking/templates.ts";

export interface CoachLinkEmailEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly emailLedgerRpcSecret: string;
  readonly brevoApiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly appUrl: string;
}

interface Delivery {
  deliveryId: string; episodeId: string; studentUserId: string; recipientUserId: string;
  audience: CoachLinkEmailAudience; idempotencyKey: string; recipientEmail: string;
  recipientFirstName: string; coachName: string; studentName: string; attemptToken: string;
}

interface InvitationDelivery {
  deliveryId: string; invitationId: string; requestId: string; coachUserId: string;
  audience: CoachInvitationEmailAudience; operationAction: "create" | "resend" | "regenerate";
  idempotencyKey: string; recipientEmail: string; invitedEmail: string; recipientFirstName: string | null;
  coachName: string; invitationCode: string; expiresAt: string;
  recipientHasAccount: boolean; attemptToken: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;

function cors(request: Request, appUrl: string): Record<string, string> {
  try {
    const allowed = new URL(appUrl);
    const origin = request.headers.get("origin");
    if (allowed.protocol !== "https:" || allowed.username || allowed.password || origin !== allowed.origin) return {};
    return { "access-control-allow-origin": allowed.origin,
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" };
  } catch { return {}; }
}

function response(request: Request, appUrl: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(request, appUrl),
    "content-type": "application/json", "cache-control": "no-store" } });
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0
    && value.length <= maximum && !/[\u0000-\u001F\u007F]/u.test(value);
}

function parseDeliveries(value: unknown, studentUserId: string): Delivery[] {
  if (!Array.isArray(value) || value.length > 2) throw new TypeError("invalid claim");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("invalid claim");
    const row = item as Record<string, unknown>;
    const delivery: Delivery = {
      deliveryId: String(row.delivery_id ?? ""), episodeId: String(row.episode_id ?? ""),
      studentUserId: String(row.student_user_id ?? ""), recipientUserId: String(row.recipient_user_id ?? ""),
      audience: row.audience as CoachLinkEmailAudience, idempotencyKey: String(row.idempotency_key ?? ""),
      recipientEmail: String(row.recipient_email ?? ""), recipientFirstName: String(row.recipient_first_name ?? ""),
      coachName: String(row.coach_name ?? ""), studentName: String(row.student_name ?? ""),
      attemptToken: String(row.attempt_token ?? ""),
    };
    if (seen.has(delivery.deliveryId)
      || ![delivery.deliveryId, delivery.episodeId, delivery.studentUserId, delivery.recipientUserId,
        delivery.idempotencyKey, delivery.attemptToken].every((candidate) => UUID.test(candidate))
      || delivery.studentUserId !== studentUserId
      || (delivery.audience !== "student" && delivery.audience !== "coach")
      || (delivery.audience === "student" && delivery.recipientUserId !== studentUserId)
      || !EMAIL.test(delivery.recipientEmail)
      || !safeText(delivery.recipientFirstName, 80) || !safeText(delivery.coachName, 201)
      || !safeText(delivery.studentName, 201)) throw new TypeError("invalid claim");
    seen.add(delivery.deliveryId);
    return delivery;
  });
}

function parseInvitationDeliveries(
  value: unknown,
  coachUserId: string,
  requestId: string | null,
  expectedInvitationId: string | null,
  coachEmail: string,
): InvitationDelivery[] {
  if (!Array.isArray(value) || value.length > 2) throw new TypeError("invalid invitation claim");
  const seenIds = new Set<string>();
  const seenAudiences = new Set<string>();
  let invitationId: string | null = null;
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("invalid invitation claim");
    const row = item as Record<string, unknown>;
    const delivery: InvitationDelivery = {
      deliveryId: String(row.delivery_id ?? ""), invitationId: String(row.invitation_id ?? ""),
      requestId: String(row.request_id ?? ""), coachUserId: String(row.coach_user_id ?? ""),
      audience: row.audience as CoachInvitationEmailAudience,
      operationAction: row.operation_action as InvitationDelivery["operationAction"],
      idempotencyKey: String(row.idempotency_key ?? ""), recipientEmail: String(row.recipient_email ?? ""),
      invitedEmail: String(row.invited_email ?? ""),
      recipientFirstName: row.recipient_first_name === null ? null : String(row.recipient_first_name ?? ""),
      coachName: String(row.coach_name ?? ""), invitationCode: String(row.invitation_code ?? ""),
      expiresAt: String(row.expires_at ?? ""), recipientHasAccount: row.recipient_has_account as boolean,
      attemptToken: String(row.attempt_token ?? ""),
    };
    if (seenIds.has(delivery.deliveryId) || seenAudiences.has(delivery.audience)
      || ![delivery.deliveryId, delivery.invitationId, delivery.requestId, delivery.coachUserId,
        delivery.idempotencyKey, delivery.attemptToken].every((candidate) => UUID.test(candidate))
      || delivery.coachUserId !== coachUserId
      || (requestId !== null && delivery.requestId !== requestId)
      || (expectedInvitationId !== null && delivery.invitationId !== expectedInvitationId)
      || (invitationId !== null && delivery.invitationId !== invitationId)
      || (delivery.audience !== "student" && delivery.audience !== "coach")
      || !["create", "resend", "regenerate"].includes(delivery.operationAction)
      || !EMAIL.test(delivery.recipientEmail)
      || !EMAIL.test(delivery.invitedEmail)
      || (delivery.audience === "coach" && delivery.recipientEmail !== coachEmail)
      || (delivery.recipientFirstName !== null && !safeText(delivery.recipientFirstName, 80))
      || !safeText(delivery.coachName, 201)
      || !/^([ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]-){2}[ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]$/.test(delivery.invitationCode)
      || !Number.isFinite(Date.parse(delivery.expiresAt))
      || typeof delivery.recipientHasAccount !== "boolean") throw new TypeError("invalid invitation claim");
    invitationId = delivery.invitationId;
    seenIds.add(delivery.deliveryId);
    seenAudiences.add(delivery.audience);
    return delivery;
  });
}

function actionUrl(appUrl: string, delivery: Delivery) {
  const url = new URL("/login", appUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("invalid app url");
  if (delivery.audience === "student") {
    url.searchParams.set("tipo", "usuario");
    url.searchParams.set("coachLinkDestination", "profile-coaching");
  } else {
    url.searchParams.set("tipo", "coach");
    url.searchParams.set("coachLinkEpisode", delivery.episodeId);
  }
  return url.toString();
}

function invitationActionUrl(appUrl: string, delivery: InvitationDelivery) {
  const url = new URL("/login", appUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("invalid app url");
  if (delivery.audience === "student") {
    if (!delivery.recipientHasAccount) url.searchParams.set("mode", "registro");
    url.searchParams.set("tipo", "usuario");
    url.searchParams.set("coachLinkDestination", "profile-coaching");
  } else {
    url.searchParams.set("tipo", "coach");
  }
  return url.toString();
}

async function complete(environment: CoachLinkEmailEnvironment, authorization: string, delivery: Delivery,
  outcome: "sent" | "failed" | "ambiguous", value: string, fetchImpl?: typeof fetch) {
  await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey, authorization,
    functionName: "complete_own_coach_link_email",
    body: { p_capability: environment.emailLedgerRpcSecret, p_delivery_id: delivery.deliveryId,
      p_attempt_token: delivery.attemptToken, p_outcome: outcome,
      p_provider_message_id: outcome === "sent" ? value : null,
      p_provider_error_code: outcome === "sent" ? null : value }, fetchImpl,
  });
}

async function processDelivery(environment: CoachLinkEmailEnvironment, authorization: string,
  delivery: Delivery, fetchImpl?: typeof fetch): Promise<"sent" | "failed" | "ambiguous"> {
  try {
    const rendered = renderCoachLinkEmail({ audience: delivery.audience,
      recipientFirstName: delivery.recipientFirstName, coachName: delivery.coachName,
      studentName: delivery.studentName, actionUrl: actionUrl(environment.appUrl, delivery) });
    const sent = await sendBrevoTransactionalEmail({ apiKey: environment.brevoApiKey,
      senderEmail: environment.senderEmail, senderName: environment.senderName,
      recipientEmail: delivery.recipientEmail, ...rendered,
      idempotencyKey: delivery.idempotencyKey, fetchImpl });
    await complete(environment, authorization, delivery, "sent", sent.messageId, fetchImpl).catch(() => undefined);
    return "sent";
  } catch (error) {
    const ambiguous = error instanceof BrevoEmailError && error.ambiguous;
    const code = error instanceof BrevoEmailError ? error.code : "invalid_configuration";
    const outcome = ambiguous ? "ambiguous" : "failed";
    await complete(environment, authorization, delivery, outcome, code, fetchImpl)
      .catch(() => undefined);
    return outcome;
  }
}

async function completeInvitation(environment: CoachLinkEmailEnvironment, authorization: string,
  delivery: InvitationDelivery, outcome: "sent" | "failed" | "ambiguous", value: string,
  fetchImpl?: typeof fetch) {
  await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey, authorization,
    functionName: "complete_own_coach_invitation_email",
    body: { p_capability: environment.emailLedgerRpcSecret, p_delivery_id: delivery.deliveryId,
      p_attempt_token: delivery.attemptToken, p_outcome: outcome,
      p_provider_message_id: outcome === "sent" ? value : null,
      p_provider_error_code: outcome === "sent" ? null : value }, fetchImpl,
  });
}

async function processInvitationDelivery(environment: CoachLinkEmailEnvironment, authorization: string,
  delivery: InvitationDelivery, fetchImpl?: typeof fetch): Promise<"sent" | "failed" | "ambiguous"> {
  try {
    const rendered = renderCoachInvitationEmail({
      audience: delivery.audience, recipientFirstName: delivery.recipientFirstName,
      coachName: delivery.coachName, invitedEmail: delivery.invitedEmail,
      invitationCode: delivery.invitationCode, expiresAt: delivery.expiresAt,
      recipientHasAccount: delivery.recipientHasAccount,
      actionUrl: invitationActionUrl(environment.appUrl, delivery),
    });
    const sent = await sendBrevoTransactionalEmail({ apiKey: environment.brevoApiKey,
      senderEmail: environment.senderEmail, senderName: environment.senderName,
      recipientEmail: delivery.recipientEmail, ...rendered,
      idempotencyKey: delivery.idempotencyKey, fetchImpl });
    await completeInvitation(environment, authorization, delivery, "sent", sent.messageId, fetchImpl)
      .catch(() => undefined);
    return "sent";
  } catch (error) {
    const ambiguous = error instanceof BrevoEmailError && error.ambiguous;
    const code = error instanceof BrevoEmailError ? error.code : "invalid_configuration";
    const outcome = ambiguous ? "ambiguous" : "failed";
    await completeInvitation(environment, authorization, delivery, outcome, code, fetchImpl)
      .catch(() => undefined);
    return outcome;
  }
}

export function createCoachLinkEmailHandler(environment: CoachLinkEmailEnvironment, fetchImpl?: typeof fetch) {
  return async (request: Request) => {
    if (request.method === "OPTIONS") {
      const headers = cors(request, environment.appUrl);
      return Object.keys(headers).length
        ? new Response(null, { status: 204, headers })
        : response(request, environment.appUrl, 403, { error: "origin_not_allowed" });
    }
    if (request.method !== "POST") return response(request, environment.appUrl, 405, { error: "method_not_allowed" });
    let authorization: string;
    try { authorization = bearerTokenFromRequest(request); }
    catch { return response(request, environment.appUrl, 401, { error: "unauthorized" }); }
    let body: unknown;
    try { body = await request.json(); } catch { return response(request, environment.appUrl, 400, { error: "invalid_request" }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return response(request, environment.appUrl, 400, { error: "invalid_request" });
    }
    const requestBody = body as Record<string, unknown>;
    const invitationRequestId = Object.keys(requestBody).length === 1
      && typeof requestBody.requestId === "string" && UUID.test(requestBody.requestId)
      ? requestBody.requestId
      : null;
    const recoverInvitationDeliveries = Object.keys(requestBody).length === 1
      && requestBody.recover === true;
    const invitationId = Object.keys(requestBody).length === 1
      && typeof requestBody.invitationId === "string" && UUID.test(requestBody.invitationId)
      ? requestBody.invitationId
      : null;
    const acceptedLinkRequest = Object.keys(requestBody).length === 0;
    if (!acceptedLinkRequest && invitationRequestId === null && !recoverInvitationDeliveries && invitationId === null) {
      return response(request, environment.appUrl, 400, { error: "invalid_request" });
    }
    try {
      const user = await getAuthenticatedAuthUser({ supabaseUrl: environment.supabaseUrl,
        anonKey: environment.supabaseAnonKey, authorization, fetchImpl });
      if (invitationRequestId !== null || recoverInvitationDeliveries || invitationId !== null) {
        const payload = await invokeEmailRpc({ supabaseUrl: environment.supabaseUrl,
          anonKey: environment.supabaseAnonKey, authorization,
          functionName: "claim_own_coach_invitation_emails",
          body: { p_capability: environment.emailLedgerRpcSecret,
            p_request_id: invitationRequestId, p_recover: recoverInvitationDeliveries,
            p_invitation_id: invitationId }, fetchImpl });
        const deliveries = parseInvitationDeliveries(payload, user.id, invitationRequestId, invitationId, user.email);
        const outcomes = await Promise.all(deliveries.map((delivery) => processInvitationDelivery(
          environment, authorization, delivery, fetchImpl,
        )));
        const sent = outcomes.filter((outcome) => outcome === "sent").length;
        const delivered = invitationId === null ? null : await invokeEmailRpc({
          supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey, authorization,
          functionName: "own_coach_invitation_email_delivery_complete",
          body: { p_capability: environment.emailLedgerRpcSecret, p_invitation_id: invitationId }, fetchImpl,
        }).then((value) => {
          if (typeof value !== "boolean") throw new TypeError("invalid invitation delivery status");
          return value;
        }).catch(() => false);
        return response(request, environment.appUrl, 202, {
          accepted: true, claimed: deliveries.length, sent, pending: deliveries.length - sent,
          ...(delivered === null ? {} : { delivered }),
        });
      }
      const payload = await invokeEmailRpc({ supabaseUrl: environment.supabaseUrl,
        anonKey: environment.supabaseAnonKey, authorization,
        functionName: "claim_own_coach_link_emails",
        body: { p_capability: environment.emailLedgerRpcSecret }, fetchImpl });
      const deliveries = parseDeliveries(payload, user.id);
      const outcomes = await Promise.all(deliveries.map((delivery) => processDelivery(
        environment, authorization, delivery, fetchImpl,
      )));
      return response(request, environment.appUrl, 202, {
        accepted: true, claimed: deliveries.length,
        sent: outcomes.filter((outcome) => outcome === "sent").length,
        pending: outcomes.filter((outcome) => outcome !== "sent").length,
      });
    } catch {
      return response(request, environment.appUrl, 503, { error: "delivery_unavailable" });
    }
  };
}
