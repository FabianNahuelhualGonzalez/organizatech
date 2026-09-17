import assert from "node:assert/strict";
import test from "node:test";

import { createCoachLinkEmailHandler } from "./handler";

const STUDENT = "00000000-0000-4000-8000-000000000001";
const COACH = "00000000-0000-4000-8000-000000000002";
const EPISODE = "00000000-0000-4000-8000-000000000003";

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
