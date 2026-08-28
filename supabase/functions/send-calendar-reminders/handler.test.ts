import assert from "node:assert/strict";
import test from "node:test";

import { BREVO_TRANSACTIONAL_EMAIL_ENDPOINT } from "../_shared/email-onboarding/brevo-client";
import { createCalendarReminderWorker, type CalendarReminderWorkerEnvironment } from "./handler";

const environment: CalendarReminderWorkerEnvironment = {
  supabaseUrl: "https://qa-project.supabase.co",
  supabaseAnonKey: "qa-anon-key",
  calendarReminderRpcSecret: "calendar-rpc-capability-with-32-characters",
  schedulerSecret: "scheduler-secret-with-32-characters",
  brevoApiKey: "brevo-test-key",
  senderEmail: "cuentas@organizatech.cl",
  senderName: "Organizatech",
  appUrl: "https://qa.organizatech.cl",
};

const delivery = {
  delivery_id: "10000000-0000-8000-8000-000000000001",
  user_id: "10000000-0000-8000-8000-000000000002",
  reminder_id: "10000000-0000-8000-8000-000000000003",
  occurrence_on: "2026-09-07",
  idempotency_key: "10000000-0000-8000-8000-000000000004",
  recipient_email: "persona@example.test",
  title: "Control mensual",
  description: "Revisar el avance",
  reminder_time: "09:30:00",
  attempt_token: "10000000-0000-8000-8000-000000000005",
};

function request(secret = environment.schedulerSecret) {
  return new Request("https://edge.example/send-calendar-reminders", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

test("scheduler válido reclama, envía y completa una vez", async () => {
  const rpcBodies: Record<string, unknown>[] = [];
  let brevoCalls = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_calendar_reminder_deliveries")) {
      rpcBodies.push(JSON.parse(String(init.body)));
      return Response.json([delivery]);
    }
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) {
      brevoCalls += 1;
      return Response.json({ messageId: "message-1" }, { status: 201 });
    }
    if (url.endsWith("/rpc/complete_calendar_reminder_delivery")) {
      rpcBodies.push(JSON.parse(String(init.body)));
      return Response.json(true);
    }
    throw new Error(`unexpected ${url}`);
  };

  const response = await createCalendarReminderWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 202);
  assert.equal(brevoCalls, 1);
  assert.deepEqual(rpcBodies[0], { p_capability: environment.calendarReminderRpcSecret });
  assert.equal(rpcBodies[1]?.p_outcome, "sent");
  assert.equal(rpcBodies[1]?.p_provider_message_id, "message-1");
});

test("éxito Brevo con completion incierta nunca se degrada a retry", async () => {
  const completionOutcomes: unknown[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_calendar_reminder_deliveries")) return Response.json([delivery]);
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) {
      return Response.json({ messageId: "accepted-but-unconfirmed" }, { status: 201 });
    }
    if (url.endsWith("/rpc/complete_calendar_reminder_delivery")) {
      completionOutcomes.push((JSON.parse(String(init.body)) as Record<string, unknown>).p_outcome);
      return new Response("unavailable", { status: 503 });
    }
    throw new Error(`unexpected ${url}`);
  };

  const response = await createCalendarReminderWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 202);
  assert.deepEqual(completionOutcomes, ["sent"]);
});

test("rechazo definitivo no se reintenta y queda rejected", async () => {
  const completionOutcomes: unknown[] = [];
  let brevoCalls = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_calendar_reminder_deliveries")) return Response.json([delivery]);
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) {
      brevoCalls += 1;
      return new Response("private", { status: 400 });
    }
    if (url.endsWith("/rpc/complete_calendar_reminder_delivery")) {
      completionOutcomes.push((JSON.parse(String(init.body)) as Record<string, unknown>).p_outcome);
      return Response.json(true);
    }
    throw new Error(`unexpected ${url}`);
  };

  await createCalendarReminderWorker(environment, fetchImpl)(request());
  assert.equal(brevoCalls, 1);
  assert.deepEqual(completionOutcomes, ["rejected"]);
});

test("secreto scheduler incorrecto falla antes de cualquier llamada", async () => {
  let calls = 0;
  const response = await createCalendarReminderWorker(environment, async () => {
    calls += 1;
    return Response.json({});
  })(request("incorrect-secret-with-32-characters"));
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});
