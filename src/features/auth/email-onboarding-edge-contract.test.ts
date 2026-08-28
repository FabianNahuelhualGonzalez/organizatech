import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PATHS = {
  authHandler: "supabase/functions/auth-send-email-hook/handler.ts",
  authIndex: "supabase/functions/auth-send-email-hook/index.ts",
  welcomeHandler: "supabase/functions/send-welcome-email/handler.ts",
  welcomeIndex: "supabase/functions/send-welcome-email/index.ts",
  rest: "supabase/functions/_shared/email-onboarding/supabase-rest.ts",
  brevo: "supabase/functions/_shared/email-onboarding/brevo-client.ts",
  config: "supabase/config.toml",
} as const;

type Sources = Record<keyof typeof PATHS, string>;
type Violation =
  | "hook-order"
  | "hook-recipient-binding"
  | "hook-global-fallback"
  | "welcome-auth-binding"
  | "welcome-mass-assignment"
  | "deno-relative-imports"
  | "internal-timeouts"
  | "ambiguous-outcome"
  | "rpc-capability"
  | "edge-config"
  | "provider-trace"
  | "secret-or-log";

function readSources(): Sources {
  return Object.fromEntries(
    Object.entries(PATHS).map(([name, path]) => [name, readFileSync(path, "utf8")]),
  ) as Sources;
}

function withoutComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n\r]*/g, "$1 ")
    .replace(/(^|\s)#(?![0-9a-fA-F]{3,8}\b)[^\n\r]*/g, "$1 ");
}

function normalized(source: string) {
  return withoutComments(source).replace(/\s+/g, " ").trim();
}

function occurrences(source: string, target: string) {
  return source.split(target).length - 1;
}

function relativeImportSpecifiers(source: string) {
  return [...source.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)]
    .map((match) => match[1]!);
}

function processKeepsAmbiguousOutcomePending(
  source: string,
  startMarker: string,
  endMarker: string,
) {
  const startOffset = source.indexOf(startMarker);
  const endOffset = source.indexOf(endMarker, startOffset);
  if (startOffset < 0 || endOffset <= startOffset) return false;

  const processSource = source.slice(startOffset, endOffset);
  const classificationOffset = processSource.indexOf(
    "const providerErrorCode = completionErrorCode(error)",
  );
  const guardOffset = processSource.indexOf("if (providerErrorCode)", classificationOffset);
  const failedOffset = processSource.indexOf('outcome: "failed"', guardOffset);
  const returnOffset = processSource.indexOf("return;", failedOffset);
  const sentOffset = processSource.indexOf('outcome: "sent"', returnOffset);

  return classificationOffset >= 0
    && guardOffset > classificationOffset
    && failedOffset > guardOffset
    && returnOffset > failedOffset
    && sentOffset > returnOffset
    && occurrences(processSource, 'outcome: "failed"') === 1
    && occurrences(processSource, 'outcome: "sent"') === 1;
}

function inspectEdge(sources: Sources): Set<Violation> {
  const violations = new Set<Violation>();
  const auth = normalized(sources.authHandler);
  const welcome = normalized(sources.welcomeHandler);
  const authIndex = normalized(sources.authIndex);
  const welcomeIndex = normalized(sources.welcomeIndex);
  const rest = normalized(sources.rest);
  const brevo = normalized(sources.brevo);
  const config = normalized(sources.config);

  const verifyOffset = auth.indexOf("verifyStandardWebhookSignature({");
  const parseOffset = auth.indexOf("parseAuthEmailHookPayload(rawBody)");
  const processOffset = auth.indexOf("Promise.allSettled(parsedHook.deliveries.map");
  if (verifyOffset < 0 || parseOffset <= verifyOffset || processOffset <= parseOffset
    || auth.includes("request.json()")
    || !auth.includes('const eventId = request.headers.get("webhook-id")?.trim() ?? ""')
    || !auth.includes("p_event_id: input.eventId")) {
    violations.add("hook-order");
  }

  if (!auth.includes("recipientEmail !== expected.recipientEmail")
    || !auth.includes("userId !== parsedHook.userId")
    || !auth.includes("recipientEmail: claimed.recipientEmail")
    || !auth.includes("p_payload: input.rawBody")) {
    violations.add("hook-recipient-binding");
  }

  if (!auth.includes('(parsedHook.action !== "signup" && templateKey !== "auth_fallback")')
    || !auth.includes("renderNeutralAuthEmail({")
    || !auth.includes("const destinationUrl = parsedHook.redirectTo ?? parsedHook.siteUrl")
    || !auth.includes("actionUrl = expected.tokenHash && destinationUrl")
    || !auth.includes("supabaseUrl: authOrigin")
    || !auth.includes("redirectTo: destinationUrl")
    || !auth.includes("environment.supabaseUrl,")
    || auth.includes("supabaseUrl: parsedHook.siteUrl")) {
    violations.add("hook-global-fallback");
  }

  const bearerOffset = welcome.indexOf("bearerTokenFromRequest(request)");
  const authUserOffset = welcome.indexOf("getAuthenticatedAuthUser({");
  const claimOffset = welcome.indexOf('functionName: "claim_own_transactional_welcome_emails"');
  if (bearerOffset < 0 || authUserOffset <= bearerOffset || claimOffset <= authUserOffset
    || !welcome.includes("userId !== authenticatedUser.id")
    || !welcome.includes("recipientEmail !== authenticatedUser.email")
    || !welcome.includes("authorization,")) {
    violations.add("welcome-auth-binding");
  }

  if (!welcome.includes("isEmptyJsonObject(rawBody)")
    || !welcome.includes("Object.keys(parsed as Record<string, unknown>).length === 0")
    || welcome.includes("request.json()")
    || /\bp_(?:user_id|owner_id|profile_id|email|recipient|portal|template|delivery_kind)\b/i
      .test(welcome)) {
    violations.add("welcome-mass-assignment");
  }

  const denoSources = [
    sources.authHandler,
    sources.authIndex,
    sources.welcomeHandler,
    sources.welcomeIndex,
  ];
  const relativeImports = denoSources.map(relativeImportSpecifiers);
  if (relativeImports.some((imports) => (
    imports.length === 0 || imports.some((specifier) => !specifier.endsWith(".ts"))
  ))
    || !authIndex.includes('from "./handler.ts"')
    || !welcomeIndex.includes('from "./handler.ts"')) {
    violations.add("deno-relative-imports");
  }

  if (!auth.includes("const AUTH_LEDGER_REQUEST_TIMEOUT_MILLISECONDS = 700")
    || occurrences(
      auth,
      "timeoutMilliseconds: AUTH_LEDGER_REQUEST_TIMEOUT_MILLISECONDS",
    ) !== 2
    || !auth.includes("timeoutMilliseconds: 2_500")
    || !welcome.includes("const WELCOME_INTERNAL_REQUEST_TIMEOUT_MILLISECONDS = 1_000")
    || occurrences(
      welcome,
      "timeoutMilliseconds: WELCOME_INTERNAL_REQUEST_TIMEOUT_MILLISECONDS",
    ) !== 3
    || !welcome.includes("timeoutMilliseconds: 3_000")
    || !rest.includes("const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 3_000")
    || !rest.includes("const abortController = new AbortController()")
    || !rest.includes("requestTimeoutMilliseconds(input.timeoutMilliseconds)")
    || !rest.includes("signal: abortController.signal")
    || !rest.includes("finally { clearTimeout(timeout); }")
    || !rest.includes("normalized < 250 || normalized > 10_000")) {
    violations.add("internal-timeouts");
  }

  if (occurrences(auth, "if (error.ambiguous) return null") !== 1
    || occurrences(welcome, "if (error.ambiguous) return null") !== 1
    || !processKeepsAmbiguousOutcomePending(
      auth,
      "async function processDelivery(",
      "export function createAuthSendEmailHookHandler(",
    )
    || !processKeepsAmbiguousOutcomePending(
      welcome,
      "async function processWelcomeDelivery(",
      "function isEmptyJsonObject(",
    )
    || !brevo.includes("readonly ambiguous: boolean")
    || !brevo.includes("const MAX_SAFE_PROVIDER_ATTEMPTS = 2")
    || !brevo.includes("attempt < MAX_SAFE_PROVIDER_ATTEMPTS")
    || !brevo.includes("providerError.retryable")
    || !brevo.includes("!providerError.ambiguous")
    || !brevo.includes("return status === 408 || status >= 500")
    || !brevo.includes(
      'new BrevoEmailError("duplicate_request", false, response.status, true)',
    )
    || occurrences(
      brevo,
      'new BrevoEmailError("invalid_provider_response", true, response.status, true)',
    ) !== 2
    || !brevo.includes(
      'new BrevoEmailError("provider_unavailable", true, null, true)',
    )) {
    violations.add("ambiguous-outcome");
  }

  const rpcBodies = [
    /functionName:\s*"claim_auth_transactional_email"[\s\S]{0,500}?p_capability:\s*environment\.emailLedgerRpcSecret/,
    /functionName:\s*"complete_auth_transactional_email"[\s\S]{0,500}?p_capability:\s*environment\.emailLedgerRpcSecret/,
    /functionName:\s*"claim_own_transactional_welcome_emails"[\s\S]{0,300}?p_capability:\s*environment\.emailLedgerRpcSecret/,
    /functionName:\s*"complete_own_transactional_welcome_email"[\s\S]{0,500}?p_capability:\s*environment\.emailLedgerRpcSecret/,
  ];
  const combinedHandlers = `${sources.authHandler}\n${sources.welcomeHandler}`;
  if (rpcBodies.some((pattern) => !pattern.test(combinedHandlers))
    || !authIndex.includes('Deno.env.get("EMAIL_LEDGER_RPC_SECRET")')
    || !welcomeIndex.includes('Deno.env.get("EMAIL_LEDGER_RPC_SECRET")')) {
    violations.add("rpc-capability");
  }

  if (!config.includes("[functions.auth-send-email-hook] verify_jwt = false")
    || !config.includes("[functions.send-welcome-email] verify_jwt = true")) {
    violations.add("edge-config");
  }

  if (!auth.includes("let providerMessageId: string")
    || !auth.includes("providerMessageId = result.messageId")
    || !auth.includes("outcome: \"sent\", providerMessageId,")
    || !welcome.includes("let providerMessageId: string")
    || !welcome.includes("providerMessageId = result.messageId")
    || !welcome.includes("outcome: \"sent\", providerMessageId,")
    || !brevo.includes("idempotencyKey: input.idempotencyKey")) {
    violations.add("provider-trace");
  }

  const implementationSurface = Object.values(sources).join("\n");
  if (/\bservice_role\b/i.test(withoutComments(implementationSurface))
    || /\bxkeysib-[a-z0-9_-]{8,}\b/i.test(implementationSurface)
    || /\bwhsec_[a-z0-9+/=_-]{12,}\b/i.test(implementationSurface)
    || /\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/i.test(implementationSurface)
    || /console\.(?:log|info|warn|error|debug)\s*\(/.test(implementationSurface)) {
    violations.add("secret-or-log");
  }

  return violations;
}

function replaceOnce(source: string, target: string, replacement: string) {
  assert.equal(source.split(target).length - 1, 1, `precondición de mutación única: ${target}`);
  return source.replace(target, replacement);
}

const sources = readSources();

test("Edge boundaries fijan imports, timeouts, ambigüedad y evidencia server-side", () => {
  assert.deepEqual([...inspectEdge(sources)], []);
});

test("metadata Edge separa Hook sin JWT de bienvenida con JWT", () => {
  const violations = inspectEdge(sources);
  assert.equal(violations.has("edge-config"), false);
  assert.equal(violations.has("secret-or-log"), false);
});

test("mutation probes detectan regresiones de seguridad y resiliencia", async (t) => {
  const mutations: ReadonlyArray<{
    name: string;
    violation: Violation;
    mutate(input: Sources): Sources;
  }> = [
    {
      name: "RPC Auth cruza destinatario",
      violation: "hook-recipient-binding",
      mutate: (input) => ({
        ...input,
        authHandler: replaceOnce(
          input.authHandler,
          "    || recipientEmail !== expected.recipientEmail\n",
          "",
        ),
      }),
    },
    {
      name: "Hook usa Site URL de la aplicación como origen Auth",
      violation: "hook-global-fallback",
      mutate: (input) => ({
        ...input,
        authHandler: replaceOnce(
          input.authHandler,
          "      supabaseUrl: authOrigin,\n",
          "      supabaseUrl: parsedHook.siteUrl,\n",
        ),
      }),
    },
    {
      name: "welcome acepta body con campos",
      violation: "welcome-mass-assignment",
      mutate: (input) => ({
        ...input,
        welcomeHandler: replaceOnce(
          input.welcomeHandler,
          "Object.keys(parsed as Record<string, unknown>).length === 0",
          "Object.keys(parsed as Record<string, unknown>).length >= 0",
        ),
      }),
    },
    {
      name: "welcome elimina vínculo user id",
      violation: "welcome-auth-binding",
      mutate: (input) => ({
        ...input,
        welcomeHandler: replaceOnce(
          input.welcomeHandler,
          "      || userId !== authenticatedUser.id\n",
          "",
        ),
      }),
    },
    {
      name: "claim welcome omite capability Edge",
      violation: "rpc-capability",
      mutate: (input) => ({
        ...input,
        welcomeHandler: replaceOnce(
          input.welcomeHandler,
          "body: { p_capability: environment.emailLedgerRpcSecret },",
          "body: {},",
        ),
      }),
    },
    {
      name: "welcome desactiva validación JWT",
      violation: "edge-config",
      mutate: (input) => ({
        ...input,
        config: replaceOnce(
          input.config,
          "[functions.send-welcome-email]\nverify_jwt = true",
          "[functions.send-welcome-email]\nverify_jwt = false",
        ),
      }),
    },
    {
      name: "entrypoint Deno omite extensión TypeScript",
      violation: "deno-relative-imports",
      mutate: (input) => ({
        ...input,
        authIndex: replaceOnce(
          input.authIndex,
          'from "./handler.ts"',
          'from "./handler"',
        ),
      }),
    },
    {
      name: "timeout interno Auth excede el presupuesto",
      violation: "internal-timeouts",
      mutate: (input) => ({
        ...input,
        authHandler: replaceOnce(
          input.authHandler,
          "const AUTH_LEDGER_REQUEST_TIMEOUT_MILLISECONDS = 700;",
          "const AUTH_LEDGER_REQUEST_TIMEOUT_MILLISECONDS = 11_000;",
        ),
      }),
    },
    {
      name: "resultado ambiguo se clasifica automáticamente como fallo",
      violation: "ambiguous-outcome",
      mutate: (input) => ({
        ...input,
        authHandler: replaceOnce(
          input.authHandler,
          "    if (error.ambiguous) return null;",
          "    if (error.ambiguous) return error.code;",
        ),
      }),
    },
    {
      name: "retry automático acepta un resultado ambiguo",
      violation: "ambiguous-outcome",
      mutate: (input) => ({
        ...input,
        brevo: replaceOnce(
          input.brevo,
          "          && !providerError.ambiguous\n",
          "          && providerError.ambiguous\n",
        ),
      }),
    },
    {
      name: "API key se imprime",
      violation: "secret-or-log",
      mutate: (input) => ({
        ...input,
        authIndex: `${input.authIndex}\nconsole.log(Deno.env.get("BREVO_API_KEY"));\n`,
      }),
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      assert.equal(inspectEdge(mutation.mutate(sources)).has(mutation.violation), true);
    });
  }
});
