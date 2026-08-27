import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthActionUrl,
  parseAuthEmailHookPayload,
  type AuthEmailAction,
} from "./auth-hook-payload";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const REDIRECT_TO = "https://app.organizatech.example/auth/callback?portal=usuario";
const APP_SITE_URL = "https://organizatech.cl/";

function payload(input: {
  action?: string;
  token?: string;
  tokenHash?: string;
  tokenHashNew?: string;
  redirectTo?: string;
  userId?: string;
  email?: string;
  newEmail?: string;
  siteUrl?: string;
  oldEmail?: string;
} = {}) {
  return JSON.stringify({
    user: {
      id: input.userId ?? USER_ID,
      email: input.email ?? "Owner@Example.COM",
      ...(input.newEmail === undefined ? {} : { new_email: input.newEmail }),
    },
    email_data: {
      email_action_type: input.action ?? "signup",
      token: input.token ?? "12345678",
      token_hash: input.tokenHash ?? "opaque-primary-token",
      ...(input.tokenHashNew === undefined ? {} : { token_hash_new: input.tokenHashNew }),
      redirect_to: input.redirectTo ?? REDIRECT_TO,
      site_url: input.siteUrl ?? APP_SITE_URL,
      ...(input.oldEmail === undefined ? {} : { old_email: input.oldEmail }),
    },
  });
}

test("parsea todas las acciones Auth soportadas sin convertir el token opaco", () => {
  const actions: readonly AuthEmailAction[] = [
    "signup",
    "recovery",
    "magiclink",
    "invite",
    "email",
  ];

  for (const action of actions) {
    assert.deepEqual(parseAuthEmailHookPayload(payload({ action })), {
      userId: USER_ID,
      action,
      redirectTo: REDIRECT_TO,
      siteUrl: APP_SITE_URL,
      deliveries: [{
        slot: "primary",
        tokenHash: "opaque-primary-token",
        oneTimeCode: null,
        recipientEmail: "owner@example.com",
      }],
    });
  }
});

test("reauthentication conserva el nonce firmado y nunca lo convierte en link", () => {
  assert.deepEqual(parseAuthEmailHookPayload(payload({
    action: "reauthentication",
    token: "87654321",
  })), {
    userId: USER_ID,
    action: "reauthentication",
    redirectTo: REDIRECT_TO,
    siteUrl: APP_SITE_URL,
    deliveries: [{
      slot: "primary",
      tokenHash: "opaque-primary-token",
      oneTimeCode: "87654321",
      recipientEmail: "owner@example.com",
    }],
  });
});

test("secure email change conserva la inversión oficial de hashes por destinatario", () => {
  assert.deepEqual(parseAuthEmailHookPayload(payload({
    action: "email_change",
    tokenHash: "hash-for-new-address",
    tokenHashNew: "hash-for-current-address",
    newEmail: "New.Owner@Example.COM",
  })), {
    userId: USER_ID,
    action: "email_change",
    redirectTo: REDIRECT_TO,
    siteUrl: APP_SITE_URL,
    deliveries: [
      {
        slot: "current",
        tokenHash: "hash-for-current-address",
        oneTimeCode: null,
        recipientEmail: "owner@example.com",
      },
      {
        slot: "new",
        tokenHash: "hash-for-new-address",
        oneTimeCode: null,
        recipientEmail: "new.owner@example.com",
      },
    ],
  });

  assert.deepEqual(parseAuthEmailHookPayload(payload({
    action: "email_change",
    tokenHash: "hash-for-new-address",
    newEmail: "new.owner@example.com",
  })).deliveries, [{
    slot: "new",
    tokenHash: "hash-for-new-address",
    oneTimeCode: null,
    recipientEmail: "new.owner@example.com",
  }]);
});

test("payloads incompletos, ambiguos, inseguros o sobredimensionados fallan cerrados", () => {
  const invalidPayloads = [
    "{}",
    "not-json",
    payload({ userId: "client-controlled-user" }),
    payload({ action: "delete_account" }),
    payload({ tokenHash: "" }),
    payload({ action: "reauthentication", token: "not-a-nonce" }),
    payload({ email: "attacker-selected-not-an-email" }),
    payload({ redirectTo: "http://attacker.example/callback" }),
    payload({ redirectTo: "https://user:password@app.organizatech.example/callback" }),
    payload({ redirectTo: "javascript:alert(1)" }),
    payload({ siteUrl: "http://attacker.example/auth/v1" }),
    JSON.stringify({
      user: { id: USER_ID },
      email_data: {
        email_action_type: "email_change",
        token_hash_new: "hash-without-new-recipient-token",
        redirect_to: REDIRECT_TO,
      },
    }),
    `{"padding":"${"a".repeat(65_536)}"}`,
  ];

  for (const rawBody of invalidPayloads) {
    assert.throws(
      () => parseAuthEmailHookPayload(rawBody),
      { name: "TypeError", message: /Invalid Auth email/ },
    );
  }
});

test("notificaciones Auth globales priorizan redirect_to y conservan site_url como fallback", () => {
  const currentEmailNotifications: readonly AuthEmailAction[] = [
    "password_changed_notification",
    "phone_changed_notification",
    "identity_linked_notification",
    "identity_unlinked_notification",
    "mfa_factor_enrolled_notification",
    "mfa_factor_unenrolled_notification",
  ];
  for (const action of currentEmailNotifications) {
    assert.deepEqual(parseAuthEmailHookPayload(payload({ action })), {
      userId: USER_ID,
      action,
      redirectTo: REDIRECT_TO,
      siteUrl: APP_SITE_URL,
      deliveries: [{
        slot: "primary",
        tokenHash: null,
        oneTimeCode: null,
        recipientEmail: "owner@example.com",
      }],
    });
  }

  assert.deepEqual(parseAuthEmailHookPayload(payload({
    action: "email_changed_notification",
    oldEmail: "Previous.Owner@Example.COM",
  })).deliveries, [{
    slot: "primary",
    tokenHash: null,
    oneTimeCode: null,
    recipientEmail: "previous.owner@example.com",
  }]);

  assert.deepEqual(parseAuthEmailHookPayload(payload({
    action: "password_changed_notification",
    redirectTo: "",
  })), {
    userId: USER_ID,
    action: "password_changed_notification",
    redirectTo: null,
    siteUrl: APP_SITE_URL,
    deliveries: [{
      slot: "primary",
      tokenHash: null,
      oneTimeCode: null,
      recipientEmail: "owner@example.com",
    }],
  });
});

test("construye exclusivamente la URL verify de Supabase y codifica token y redirect", () => {
  const actionUrl = buildAuthActionUrl({
    supabaseUrl: "https://project-ref.supabase.co/",
    tokenHash: "token+/= with reserved chars",
    action: "signup",
    redirectTo: REDIRECT_TO,
  });
  const parsed = new URL(actionUrl);

  assert.equal(parsed.origin, "https://project-ref.supabase.co");
  assert.equal(parsed.pathname, "/auth/v1/verify");
  assert.equal(parsed.searchParams.get("token"), "token+/= with reserved chars");
  assert.equal(parsed.searchParams.get("type"), "signup");
  assert.equal(parsed.searchParams.get("redirect_to"), REDIRECT_TO);
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");

  const prefixedActionUrl = buildAuthActionUrl({
    supabaseUrl: "https://project-ref.supabase.co/auth/v1",
    tokenHash: "opaque",
    action: "signup",
    redirectTo: REDIRECT_TO,
  });
  assert.equal(new URL(prefixedActionUrl).pathname, "/auth/v1/verify");
});

test("URL de proyecto inválida o token vacío nunca produce CTA", () => {
  for (const candidate of [
    { supabaseUrl: "http://project-ref.supabase.co", tokenHash: "opaque" },
    { supabaseUrl: "https://user:password@project-ref.supabase.co", tokenHash: "opaque" },
    { supabaseUrl: "https://project-ref.supabase.co/auth/v1?unsafe=1", tokenHash: "opaque" },
    { supabaseUrl: "javascript:alert(1)", tokenHash: "opaque" },
    { supabaseUrl: "https://project-ref.supabase.co", tokenHash: "" },
  ]) {
    assert.throws(() => buildAuthActionUrl({
      ...candidate,
      action: "signup",
      redirectTo: REDIRECT_TO,
    }), TypeError);
  }
  assert.throws(() => buildAuthActionUrl({
    supabaseUrl: "https://project-ref.supabase.co",
    tokenHash: "opaque",
    action: "password_changed_notification",
    redirectTo: REDIRECT_TO,
  }), TypeError);
  assert.throws(() => buildAuthActionUrl({
    supabaseUrl: "https://project-ref.supabase.co",
    tokenHash: "opaque",
    action: "reauthentication",
    redirectTo: REDIRECT_TO,
  }), TypeError);
});
