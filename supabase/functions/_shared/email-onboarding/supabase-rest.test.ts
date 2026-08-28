import assert from "node:assert/strict";
import test from "node:test";

import {
  SupabaseEmailBoundaryError,
  bearerTokenFromRequest,
  getAuthenticatedAuthUser,
  invokeEmailRpc,
} from "./supabase-rest";

const SUPABASE_URL = "https://project-ref.supabase.co";
const ANON_KEY = "public-anon-key-for-tests";
const AUTHORIZATION = "Bearer user-jwt-for-tests";
const USER_ID = "11111111-1111-4111-8111-111111111111";

test("RPC usa sólo POST JSON, anon key y autorización suministrada", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await invokeEmailRpc({
    supabaseUrl: `${SUPABASE_URL}/`,
    anonKey: ANON_KEY,
    authorization: AUTHORIZATION,
    functionName: "claim_own_transactional_welcome_emails",
    body: {},
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json([{ delivery_id: USER_ID }]);
    },
  });

  assert.deepEqual(result, [{ delivery_id: USER_ID }]);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    `${SUPABASE_URL}/rest/v1/rpc/claim_own_transactional_welcome_emails`,
  );
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, "{}");
  assert.ok(calls[0]?.init?.signal instanceof AbortSignal);
  assert.equal(calls[0]?.init?.signal?.aborted, false);
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("apikey"), ANON_KEY);
  assert.equal(headers.get("authorization"), AUTHORIZATION);
  assert.equal(headers.get("content-type"), "application/json");
});

test("errores remotos, de red y JSON inválido se reducen a un error público neutro", async () => {
  const remoteSecret = "provider-secret-that-must-not-escape";
  const failingFetches: Array<typeof fetch> = [
    async () => new Response(JSON.stringify({ message: remoteSecret }), { status: 403 }),
    async () => new Response(remoteSecret, { status: 200 }),
    async () => { throw new Error(remoteSecret); },
    async () => new Response("{}", {
      status: 200,
      headers: { "content-length": "262145" },
    }),
  ];

  for (const fetchImpl of failingFetches) {
    await assert.rejects(
      invokeEmailRpc({
        supabaseUrl: SUPABASE_URL,
        anonKey: ANON_KEY,
        authorization: AUTHORIZATION,
        functionName: "complete_own_transactional_welcome_email",
        body: {
          p_delivery_id: USER_ID,
          p_attempt_token: USER_ID,
          p_outcome: "failed",
          p_provider_error_code: "provider_rejected",
        },
        fetchImpl,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupabaseEmailBoundaryError);
        assert.equal(error.message.includes(remoteSecret), false);
        return true;
      },
    );
  }
});

test("/auth/v1/user fija identidad y correo desde el JWT, nunca desde el body", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const authenticatedUser = await getAuthenticatedAuthUser({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authorization: AUTHORIZATION,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ id: USER_ID, email: "  Owner@Example.COM " });
    },
  });

  assert.deepEqual(authenticatedUser, { id: USER_ID, email: "owner@example.com" });
  assert.equal(calls[0]?.url, `${SUPABASE_URL}/auth/v1/user`);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(calls[0]?.init?.body, undefined);
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("authorization"), AUTHORIZATION);
  assert.equal(headers.get("apikey"), ANON_KEY);
});

test("identidad Auth malformada, correo ausente o credenciales inseguras fallan cerrados", async () => {
  for (const payload of [
    { id: "attacker-selected-id", email: "owner@example.com" },
    { id: USER_ID, email: "not-an-email" },
    { id: USER_ID, email: `${"a".repeat(250)}@example.com` },
    { id: USER_ID },
  ]) {
    await assert.rejects(getAuthenticatedAuthUser({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      authorization: AUTHORIZATION,
      fetchImpl: async () => Response.json(payload),
    }), SupabaseEmailBoundaryError);
  }

  for (const authorization of ["", "Basic abc", "Bearer two tokens"]) {
    assert.throws(
      () => bearerTokenFromRequest(new Request(SUPABASE_URL, {
        headers: { authorization },
      })),
      SupabaseEmailBoundaryError,
    );
  }
  const requestWithHeaderInjection = {
    headers: new Headers(),
  } as Request;
  requestWithHeaderInjection.headers.get = () => "Bearer\nsecret";
  assert.throws(
    () => bearerTokenFromRequest(requestWithHeaderInjection),
    SupabaseEmailBoundaryError,
  );
  assert.equal(
    bearerTokenFromRequest(new Request(SUPABASE_URL, {
      headers: { authorization: AUTHORIZATION },
    })),
    AUTHORIZATION,
  );
});

test("rechaza URL con downgrade HTTP remoto o credenciales embebidas", async () => {
  for (const supabaseUrl of [
    "http://project-ref.supabase.co",
    "https://user:password@project-ref.supabase.co",
    "javascript:alert(1)",
  ]) {
    await assert.rejects(invokeEmailRpc({
      supabaseUrl,
      anonKey: ANON_KEY,
      authorization: AUTHORIZATION,
      functionName: "claim_own_transactional_welcome_emails",
      body: {},
      fetchImpl: async () => assert.fail("una URL inválida no debe llegar a fetch"),
    }), SupabaseEmailBoundaryError);
  }
});

test("timeout aborta determinísticamente un fetch pendiente y sanitiza el error", async () => {
  const captured: { signal?: AbortSignal } = {};
  let fetchCalls = 0;
  const startedAt = performance.now();

  await assert.rejects(invokeEmailRpc({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    authorization: AUTHORIZATION,
    functionName: "claim_own_transactional_welcome_emails",
    body: {},
    timeoutMilliseconds: 250,
    fetchImpl: async (_url, init) => {
      fetchCalls += 1;
      const signal = init?.signal;
      assert.ok(signal instanceof AbortSignal);
      captured.signal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("private timeout detail")),
          { once: true },
        );
      });
    },
  }), (error: unknown) => {
    assert.ok(error instanceof SupabaseEmailBoundaryError);
    assert.equal(error.message.includes("private timeout detail"), false);
    return true;
  });

  assert.equal(fetchCalls, 1);
  assert.equal(captured.signal?.aborted, true);
  assert.ok(
    performance.now() - startedAt < 2_000,
    "el test usa el mínimo permitido de 250 ms; no debe convertirse en un sleep largo",
  );
});

test("timeout inválido falla antes de fetch para RPC y Auth user", async () => {
  const invalidTimeouts = [0, 249, 10_001, 250.5, Number.NaN, Number.POSITIVE_INFINITY];
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    return assert.fail("timeout inválido no debe llegar a fetch");
  };

  for (const timeoutMilliseconds of invalidTimeouts) {
    await assert.rejects(invokeEmailRpc({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      authorization: AUTHORIZATION,
      functionName: "claim_own_transactional_welcome_emails",
      body: {},
      timeoutMilliseconds,
      fetchImpl,
    }), SupabaseEmailBoundaryError);

    await assert.rejects(getAuthenticatedAuthUser({
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      authorization: AUTHORIZATION,
      timeoutMilliseconds,
      fetchImpl,
    }), SupabaseEmailBoundaryError);
  }

  assert.equal(fetchCalls, 0);
});
