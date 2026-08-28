import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CONTROLLER_PATH = "src/features/auth/model/multiportal-auth-controller.ts";
const SUPABASE_GATEWAY_PATH = "src/features/auth/data/supabase-multiportal-auth-gateway.ts";
const GOOGLE_GATEWAY_PATH = "src/features/auth/data/google-oauth-gateway.ts";
const WELCOME_REQUEST_PATH = "src/features/auth/data/request-welcome-email.ts";

interface AuthWiringSources {
  controller: string;
  supabaseGateway: string;
  googleGateway: string;
  welcomeRequest: string;
}

type Violation =
  | "mass-assignment"
  | "welcome-timeout"
  | "welcome-before-membership"
  | "welcome-on-login"
  | "google-confirmation"
  | "provider-failure-propagates"
  | "client-secret";

function readSources(): AuthWiringSources {
  return {
    controller: readFileSync(CONTROLLER_PATH, "utf8"),
    supabaseGateway: readFileSync(SUPABASE_GATEWAY_PATH, "utf8"),
    googleGateway: readFileSync(GOOGLE_GATEWAY_PATH, "utf8"),
    welcomeRequest: readFileSync(WELCOME_REQUEST_PATH, "utf8"),
  };
}

function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n\r]*/g, "$1 ");
}

function normalized(source: string) {
  return withoutComments(source).replace(/\s+/g, " ").trim();
}

function numericLiteralConstant(source: string, name: string) {
  const match = source.match(
    new RegExp(`\\bconst\\s+${name}\\s*=\\s*([0-9][0-9_]*)\\s*;`),
  );
  if (!match) return null;

  const value = Number(match[1]!.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `inicio requerido: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `fin requerido: ${endMarker}`);
  return source.slice(start, end);
}

function callAppearsAfter(block: string, prerequisite: string, call: string) {
  const prerequisiteOffset = block.indexOf(prerequisite);
  const callOffset = block.indexOf(call);
  return prerequisiteOffset >= 0 && callOffset > prerequisiteOffset;
}

function inspectAuthWiring(sources: AuthWiringSources): Set<Violation> {
  const violations = new Set<Violation>();
  const controller = normalized(sources.controller);
  const google = normalized(sources.googleGateway);
  const welcomeRequest = normalized(sources.welcomeRequest);
  const supabaseGateway = normalized(sources.supabaseGateway);

  if (!welcomeRequest.includes(
    "client.functions.invoke(WELCOME_EMAIL_FUNCTION, { body: {}, signal: abortController.signal, })",
  ) || !welcomeRequest.includes('const WELCOME_EMAIL_FUNCTION = "send-welcome-email"')
    || /body\s*:\s*\{\s*(?:email|contact_email|user_id|owner_id|profile_id|portal|template|delivery_kind)\b/i
      .test(welcomeRequest)) {
    violations.add("mass-assignment");
  }

  if (numericLiteralConstant(
    welcomeRequest,
    "WELCOME_EMAIL_REQUEST_TIMEOUT_MILLISECONDS",
  ) !== 7_000
    || !welcomeRequest.includes("const abortController = new AbortController()")
    || !welcomeRequest.includes(
      "const timeout = setTimeout( () => abortController.abort(), WELCOME_EMAIL_REQUEST_TIMEOUT_MILLISECONDS, )",
    )
    || !welcomeRequest.includes("signal: abortController.signal")
    || !welcomeRequest.includes("finally { clearTimeout(timeout); }")) {
    violations.add("welcome-timeout");
  }

  const signupConfirmation = sliceBetween(
    controller,
    "async function resolveSignupConfirmation",
    "async function rejectPortalSession",
  );
  const sharedCoach = sliceBetween(
    controller,
    "async function registerSharedCoach",
    "async function registerSeparateCoach",
  );
  const separateCoach = sliceBetween(
    controller,
    "async function registerSeparateCoach",
    "async function registerUser",
  );
  const userRegistration = sliceBetween(
    controller,
    "async function registerUser",
    "async function requestWelcomeEmailBestEffort",
  );
  const googleRegistration = sliceBetween(
    google,
    "async function register(",
    "return Object.freeze(",
  );

  if (!callAppearsAfter(
    signupConfirmation,
    'confirmation.status !== "confirmed"',
    "requestWelcomeEmailBestEffort(",
  ) || !callAppearsAfter(
    sharedCoach,
    "gateway.createSharedCoachRegistration(",
    "requestWelcomeEmailBestEffort(",
  ) || !callAppearsAfter(
    separateCoach,
    "gateway.getCoachRegistration(",
    "requestWelcomeEmailBestEffort(",
  ) || !callAppearsAfter(
    userRegistration,
    "gateway.hasUserRegistration(",
    "requestWelcomeEmailBestEffort(",
  ) || !callAppearsAfter(
    googleRegistration,
    "transient.rpc(functionName, payload)",
    "requestWelcomeEmailBestEffort(transient)",
  )) {
    violations.add("welcome-before-membership");
  }

  const normalPortalLogin = sliceBetween(
    controller,
    "async function resolvePortalAccess",
    "async function resolveSignupConfirmation",
  );
  if (normalPortalLogin.includes("requestWelcomeEmail")
    || supabaseGateway.includes("async signInWithPassword")
      && sliceBetween(
        supabaseGateway,
        "async signInWithPassword",
        "async signOut",
      ).includes("requestWelcomeEmail")) {
    violations.add("welcome-on-login");
  }

  if (google.includes("auth-send-email-hook")
    || google.includes("renderEmailTemplate")
    || google.includes("confirmation_user")
    || google.includes("confirmation_coach")
    || google.includes("api.brevo.com")) {
    violations.add("google-confirmation");
  }

  if (!welcomeRequest.includes("} catch { }")
    || !/try\s*\{[\s\S]*gateway\.requestWelcomeEmail\([\s\S]*\)\s*;?\s*\}\s*catch\s*\{/.test(
    withoutComments(sources.controller),
  )) {
    violations.add("provider-failure-propagates");
  }

  const clientSurface = [
    sources.controller,
    sources.supabaseGateway,
    sources.googleGateway,
    sources.welcomeRequest,
  ].join("\n");
  if (/\bservice_role\b/i.test(clientSurface)
    || /\bBREVO_API_KEY\b/.test(clientSurface)
    || /\bxkeysib-[a-z0-9_-]{8,}\b/i.test(clientSurface)
    || /\bwhsec_[a-z0-9+/=_-]{12,}\b/i.test(clientSurface)
    || /console\.(?:log|info|warn|error|debug)\s*\(/.test(clientSurface)) {
    violations.add("client-secret");
  }

  return violations;
}

function replaceOnce(source: string, target: string, replacement: string) {
  assert.equal(source.split(target).length - 1, 1, `precondición de mutación única: ${target}`);
  return source.replace(target, replacement);
}

function replaceWelcomeTimeoutLiteral(source: string, literal: string | null) {
  const declaration = /\bconst\s+WELCOME_EMAIL_REQUEST_TIMEOUT_MILLISECONDS\s*=\s*[0-9][0-9_]*\s*;/g;
  assert.equal(
    [...source.matchAll(declaration)].length,
    1,
    "precondición: declaración única del timeout de bienvenida",
  );
  return source.replace(
    declaration,
    literal === null
      ? ""
      : `const WELCOME_EMAIL_REQUEST_TIMEOUT_MILLISECONDS = ${literal};`,
  );
}

const sources = readSources();

test("wiring Auth solicita bienvenida acotada con body vacío sólo tras membership", () => {
  assert.deepEqual([...inspectAuthWiring(sources)], []);
});

test("login y Google OAuth no conectan la confirmación ni secretos del proveedor", () => {
  const violations = inspectAuthWiring(sources);
  assert.equal(violations.has("welcome-on-login"), false);
  assert.equal(violations.has("google-confirmation"), false);
  assert.equal(violations.has("client-secret"), false);
});

test("timeout de bienvenida acepta separadores numéricos sin aceptar ausencia o ampliación", () => {
  const equivalentLiteral = {
    ...sources,
    welcomeRequest: replaceWelcomeTimeoutLiteral(sources.welcomeRequest, "7000"),
  };
  assert.equal(
    inspectAuthWiring(equivalentLiteral).has("welcome-timeout"),
    false,
  );

  const missingTimeout = {
    ...sources,
    welcomeRequest: replaceWelcomeTimeoutLiteral(sources.welcomeRequest, null),
  };
  assert.equal(inspectAuthWiring(missingTimeout).has("welcome-timeout"), true);

  const unsafeTimeout = {
    ...sources,
    welcomeRequest: replaceWelcomeTimeoutLiteral(sources.welcomeRequest, "70_000"),
  };
  assert.equal(inspectAuthWiring(unsafeTimeout).has("welcome-timeout"), true);
});

test("mutation probes detectan mass assignment, timeout, orden y secretos", async (t) => {
  const mutations: ReadonlyArray<{
    name: string;
    violation: Violation;
    mutate(input: AuthWiringSources): AuthWiringSources;
  }> = [
    {
      name: "portal falsificado entra al body de Edge",
      violation: "mass-assignment",
      mutate: (input) => ({
        ...input,
        welcomeRequest: replaceOnce(
          input.welcomeRequest,
          "        body: {},\n        signal: abortController.signal,",
          '        body: { portal: "coach" },\n        signal: abortController.signal,',
        ),
      }),
    },
    {
      name: "invoke pierde AbortSignal",
      violation: "welcome-timeout",
      mutate: (input) => ({
        ...input,
        welcomeRequest: replaceOnce(
          input.welcomeRequest,
          "        signal: abortController.signal,\n",
          "",
        ),
      }),
    },
    {
      name: "timeout cliente deja de estar acotado",
      violation: "welcome-timeout",
      mutate: (input) => ({
        ...input,
        welcomeRequest: replaceWelcomeTimeoutLiteral(input.welcomeRequest, "70_000"),
      }),
    },
    {
      name: "bienvenida Usuario se mueve antes del chequeo de membership",
      violation: "welcome-before-membership",
      mutate: (input) => {
        const block = sliceBetween(
          input.controller,
          "async function registerUser",
          "async function requestWelcomeEmailBestEffort",
        );
        const call = "    await requestWelcomeEmailBestEffort(gateway, identity.userId, owner);\n";
        assert.equal(block.split(call).length - 1, 1);
        const withoutCall = block.replace(call, "");
        const mutatedBlock = withoutCall.replace(
          "    const hasUserRegistration = await gateway.hasUserRegistration",
          `${call}    const hasUserRegistration = await gateway.hasUserRegistration`,
        );
        return { ...input, controller: input.controller.replace(block, mutatedBlock) };
      },
    },
    {
      name: "Google intenta enviar confirmación",
      violation: "google-confirmation",
      mutate: (input) => ({
        ...input,
        googleGateway: `${input.googleGateway}\nvoid "auth-send-email-hook";\n`,
      }),
    },
    {
      name: "secreto Brevo llega al cliente",
      violation: "client-secret",
      mutate: (input) => ({
        ...input,
        welcomeRequest: `${input.welcomeRequest}\nconsole.log(BREVO_API_KEY);\n`,
      }),
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      assert.equal(
        inspectAuthWiring(mutation.mutate(sources)).has(mutation.violation),
        true,
      );
    });
  }
});
