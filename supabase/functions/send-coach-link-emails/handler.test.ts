import assert from "node:assert/strict";
import test from "node:test";

import { createCoachLinkEmailHandler } from "./handler";

const STUDENT = "00000000-0000-4000-8000-000000000001";
const COACH = "00000000-0000-4000-8000-000000000002";
const EPISODE = "00000000-0000-4000-8000-000000000003";
const INVITATION = "00000000-0000-4000-8000-000000000010";
const REQUEST = "00000000-0000-4000-8000-000000000011";

const environment = {
  supabaseUrl: "https://project.supabase.co", supabaseAnonKey: "anon-key",
  emailLedgerRpcSecret: "x".repeat(32), brevoApiKey: "brevo-key",
  senderEmail: "hola@organizatech.cl", senderName: "Organizatech",
  appUrl: "https://app.organizatech.cl",
};

function delivery(audience: "student" | "coach") {
  const student = audience === "student";
  return { delivery_id: student ? "00000000-0000-4000-8000-000000000004" : "00000000-0000-4000-8000-000000000005",
    episode_id: EPISODE, student_user_id: STUDENT, recipient_user_id: student ? STUDENT : COACH,
    audience, idempotency_key: student ? "00000000-0000-8000-8000-000000000006" : "00000000-0000-8000-8000-000000000007",
    recipient_email: student ? "sofia@example.com" : "marcos@example.com",
    recipient_first_name: student ? "Sofía" : "Marcos", coach_name: "Coach Marcos Díaz",
    student_name: "Sofía Reyes", attempt_token: student ? "00000000-0000-4000-8000-000000000008" : "00000000-0000-4000-8000-000000000009" };
}

function invitationDelivery(audience: "student" | "coach", recipientHasAccount = false) {
  const student = audience === "student";
  return { delivery_id: student ? "00000000-0000-4000-8000-000000000012" : "00000000-0000-4000-8000-000000000013",
    invitation_id: INVITATION, request_id: REQUEST, coach_user_id: COACH, audience,
    operation_action: "create", idempotency_key: student
      ? "00000000-0000-8000-8000-000000000014" : "00000000-0000-8000-8000-000000000015",
    recipient_email: student ? "sofia@example.com" : "marcos@example.com",
    invited_email: "sofia@example.com",
    recipient_first_name: student ? null : "Marcos", coach_name: "Coach Marcos Díaz",
    invitation_code: "AB2-CD3-EF4", expires_at: "2026-09-24T12:00:00.000Z",
    recipient_has_account: student ? recipientHasAccount : true,
    attempt_token: student ? "00000000-0000-4000-8000-000000000016" : "00000000-0000-4000-8000-000000000017" };
}

test("reclama y entrega exactamente dos correos con destinos y completions idempotentes", async () => {
  const providerBodies: Record<string, unknown>[] = [];
  const completions: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: STUDENT, email: "sofia@example.com" });
    if (url.endsWith("/rpc/claim_own_coach_link_emails")) return Response.json([delivery("student"), delivery("coach")]);
    if (url.endsWith("/rpc/complete_own_coach_link_email")) {
      completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(true);
    }
    if (url.includes("api.brevo.com")) {
      providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ messageId: `message-${providerBodies.length}` });
    }
    throw new Error(`unexpected ${url}`);
  };
  const response = await createCoachLinkEmailHandler(environment, fetchImpl)(new Request(
    "https://project.supabase.co/functions/v1/send-coach-link-emails",
    { method: "POST", headers: { authorization: "Bearer token" }, body: "{}" },
  ));
  assert.equal(response.status, 202);
  assert.equal(providerBodies.length, 2);
  assert.equal(completions.length, 2);
  const rendered = providerBodies.map((body) => `${body.subject} ${body.htmlContent}`).join("\n");
  assert.match(rendered, /coachLinkDestination=profile-coaching/);
  assert.match(rendered, new RegExp(`coachLinkEpisode=${EPISODE}`));
  assert.deepEqual(new Set(completions.map((body) => body.p_outcome)), new Set(["sent"]));
});

test("un rechazo del proveedor queda fallido y el endpoint no revierte el vínculo", async () => {
  const completions: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: STUDENT, email: "sofia@example.com" });
    if (url.endsWith("/rpc/claim_own_coach_link_emails")) return Response.json([delivery("student")]);
    if (url.endsWith("/rpc/complete_own_coach_link_email")) {
      completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(true);
    }
    return Response.json({ code: "invalid_parameter" }, { status: 400 });
  };
  const response = await createCoachLinkEmailHandler(environment, fetchImpl)(new Request(
    "https://project.supabase.co/functions/v1/send-coach-link-emails",
    { method: "POST", headers: { authorization: "Bearer token" }, body: "{}" },
  ));
  assert.equal(response.status, 202);
  assert.equal(completions[0]?.p_outcome, "failed");
});

test("creación entrega dos correos sin poner código ni correo en rutas o respuesta pública", async () => {
  const providerBodies: Record<string, unknown>[] = [];
  const completions: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: COACH, email: "marcos@example.com" });
    if (url.endsWith("/rpc/claim_own_coach_invitation_emails")) {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        p_capability: environment.emailLedgerRpcSecret, p_request_id: REQUEST, p_recover: false,
        p_invitation_id: null,
      });
      return Response.json([invitationDelivery("student"), invitationDelivery("coach")]);
    }
    if (url.endsWith("/rpc/complete_own_coach_invitation_email")) {
      completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(true);
    }
    if (url.includes("api.brevo.com")) {
      providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ messageId: `invitation-${providerBodies.length}` });
    }
    throw new Error(`unexpected ${url}`);
  };
  const response = await createCoachLinkEmailHandler(environment, fetchImpl)(new Request(
    "https://project.supabase.co/functions/v1/send-coach-link-emails",
    { method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify({ requestId: REQUEST }) },
  ));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, claimed: 2, sent: 2, pending: 0 });
  assert.equal(providerBodies.length, 2);
  assert.equal(completions.length, 2);
  const serialized = JSON.stringify(providerBodies);
  assert.match(serialized, /AB2-CD3-EF4/);
  assert.match(serialized, /Código de vinculación creado para sofia@example\.com/);
  assert.doesNotMatch(serialized, /Código de vinculación creado para marcos@example\.com/);
  assert.match(serialized, /mode=registro/);
  assert.match(serialized, /coachLinkDestination=profile-coaching/);
  assert.doesNotMatch(serialized, /coachCode=|sofia%40example|AB2-CD3-EF4[^\"]*href/);
  assert.ok(completions.every((body) => body.p_outcome === "sent"));
});

test("recuperación autenticada reclama un request pendiente sin exponer su id al cliente", async () => {
  let claimBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: COACH, email: "marcos@example.com" });
    if (url.endsWith("/rpc/claim_own_coach_invitation_emails")) {
      claimBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json([]);
    }
    throw new Error(`unexpected ${url}`);
  };
  const response = await createCoachLinkEmailHandler(environment, fetchImpl)(new Request(
    "https://project.supabase.co/functions/v1/send-coach-link-emails",
    { method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify({ recover: true }) },
  ));
  assert.equal(response.status, 202);
  assert.deepEqual(claimBody, {
    p_capability: environment.emailLedgerRpcSecret, p_request_id: null, p_recover: true,
    p_invitation_id: null,
  });
  assert.deepEqual(await response.json(), { accepted: true, claimed: 0, sent: 0, pending: 0 });
});

test("reintento manual queda acotado a la invitación seleccionada", async () => {
  let claimBody: Record<string, unknown> | null = null;
  let statusBody: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: COACH, email: "marcos@example.com" });
    if (url.endsWith("/rpc/claim_own_coach_invitation_emails")) {
      claimBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json([]);
    }
    if (url.endsWith("/rpc/own_coach_invitation_email_delivery_complete")) {
      statusBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json(true);
    }
    throw new Error(`unexpected ${url}`);
  };
  const response = await createCoachLinkEmailHandler(environment, fetchImpl)(new Request(
    "https://project.supabase.co/functions/v1/send-coach-link-emails",
    { method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify({ invitationId: INVITATION }) },
  ));
  assert.equal(response.status, 202);
  assert.deepEqual(claimBody, {
    p_capability: environment.emailLedgerRpcSecret, p_request_id: null, p_recover: false,
    p_invitation_id: INVITATION,
  });
  assert.deepEqual(statusBody, {
    p_capability: environment.emailLedgerRpcSecret, p_invitation_id: INVITATION,
  });
  assert.deepEqual(await response.json(), {
    accepted: true, claimed: 0, sent: 0, pending: 0, delivered: true,
  });
});

test("la copia Coach falla cerrada si el claim no coincide con su correo Auth vigente", async () => {
  let providerCalls = 0;
  const staleCoach = { ...invitationDelivery("coach"), recipient_email: "anterior@example.com" };
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: COACH, email: "marcos@example.com" });
    if (url.endsWith("/rpc/claim_own_coach_invitation_emails")) return Response.json([staleCoach]);
    if (url.includes("api.brevo.com")) { providerCalls += 1; return Response.json({ messageId: "unexpected" }); }
    throw new Error(`unexpected ${url}`);
  };
  const response = await createCoachLinkEmailHandler(environment, fetchImpl)(new Request(
    "https://project.supabase.co/functions/v1/send-coach-link-emails",
    { method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify({ requestId: REQUEST }) },
  ));
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});

test("falla Brevo conserva entrega pendiente, mismo código e idempotencia sin regenerar", async () => {
  const completions: Record<string, unknown>[] = [];
  const providerKeys: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: COACH, email: "marcos@example.com" });
    if (url.endsWith("/rpc/claim_own_coach_invitation_emails")) {
      return Response.json([invitationDelivery("student", true)]);
    }
    if (url.endsWith("/rpc/complete_own_coach_invitation_email")) {
      completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(true);
    }
    const body = JSON.parse(String(init?.body)) as { headers: { idempotencyKey: string } };
    providerKeys.push(body.headers.idempotencyKey);
    return Response.json({ code: "invalid_parameter" }, { status: 400 });
  };
  const response = await createCoachLinkEmailHandler(environment, fetchImpl)(new Request(
    "https://project.supabase.co/functions/v1/send-coach-link-emails",
    { method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify({ requestId: REQUEST }) },
  ));
  assert.deepEqual(await response.json(), { accepted: true, claimed: 1, sent: 0, pending: 1 });
  assert.deepEqual(providerKeys, [invitationDelivery("student", true).idempotency_key]);
  assert.equal(completions[0]?.p_outcome, "failed");
  assert.equal(JSON.stringify(completions).includes("AB2-CD3-EF4"), false);
});

test("payload de invitación es allowlist exacta y rechaza código enviado por cliente", async () => {
  let authCalls = 0;
  const handler = createCoachLinkEmailHandler(environment, async () => { authCalls += 1; return Response.json({}); });
  for (const body of [{ requestId: REQUEST, code: "AB2-CD3-EF4" }, { requestId: "invalid" },
    { invitationId: INVITATION, code: "AB2-CD3-EF4" }, { invitationId: "invalid" }]) {
    const response = await handler(new Request("https://project.supabase.co/functions/v1/send-coach-link-emails", {
      method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(authCalls, 0);
});
