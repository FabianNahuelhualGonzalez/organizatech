import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const gateway = read("./data/google-oauth-gateway.ts");
const boundary = read("./hooks/use-google-oauth-callback-gate.ts");
const screen = read("./components/auth-screen.tsx");
const entry = read("./components/auth-entry-client.tsx");
const root = read("../../components/organizatech-app.tsx");
const migration = read("../../../supabase/migrations/20260826170000_auth_google_hybrid_oauth.sql");

const PKCE_STORAGE_FAILURE = "[AUTH-GOOGLE-01.PKCE.storage-boundary]";

function auditTransientPkceStorage(source: string) {
  const scopedStart = source.indexOf("function scopedStorage(");
  const clientStart = source.indexOf("export function createTransientGoogleOAuthClient(");
  const startOAuth = source.indexOf("export async function startGoogleOAuth(");
  assert.ok(
    scopedStart >= 0 && clientStart > scopedStart && startOAuth > clientStart,
    PKCE_STORAGE_FAILURE,
  );
  const scoped = source.slice(scopedStart, clientStart);
  const client = source.slice(clientStart, startOAuth);
  assert.equal(
    (source.match(/storageKey = `\$\{PKCE_STORAGE_PREFIX\}\$\{intentId\}`/g) ?? []).length,
    2,
    PKCE_STORAGE_FAILURE,
  );
  assert.equal((scoped.match(/key === verifierKey/g) ?? []).length, 3, PKCE_STORAGE_FAILURE);
  assert.match(
    scoped,
    /getItem\(key: string\) \{[\s\S]*return key === verifierKey \? storage\.getItem\(key\) : memory\.get\(key\) \?\? null;/,
    PKCE_STORAGE_FAILURE,
  );
  assert.match(
    scoped,
    /setItem\(key: string, value: string\) \{[\s\S]*if \(key === verifierKey\) \{[\s\S]*storage\.setItem\(key, value\);[\s\S]*return;[\s\S]*\}[\s\S]*memory\.set\(key, value\);/,
    PKCE_STORAGE_FAILURE,
  );
  assert.match(
    scoped,
    /removeItem\(key: string\) \{[\s\S]*if \(key === verifierKey\) \{[\s\S]*storage\.removeItem\(key\);[\s\S]*return;[\s\S]*\}[\s\S]*memory\.delete\(key\);/,
    PKCE_STORAGE_FAILURE,
  );
  assert.match(
    client,
    /flowType: "pkce",[\s\S]*persistSession: true,[\s\S]*autoRefreshToken: false,[\s\S]*detectSessionInUrl: false,[\s\S]*storageKey,[\s\S]*storage: scopedStorage\(intentId, storage\)/,
    PKCE_STORAGE_FAILURE,
  );
}

test("cliente OAuth transitorio usa PKCE, storage aislado y scopes mínimos", () => {
  auditTransientPkceStorage(gateway);
  assert.match(gateway, /scopes: "openid email profile"/);
  assert.match(gateway, /queryParams: \{ prompt: "select_account" \}/);
  assert.doesNotMatch(
    gateway,
    /access_type|offline|prompt: "consent"|provider_token|provider_refresh_token|linkIdentity/,
  );
});

test("mutantes de persistencia PKCE no pueden recuperar el falso PASS", () => {
  const mutants = [
    gateway.replace("persistSession: true,", "persistSession: false,"),
    gateway.replace(
      "const storageKey = `${PKCE_STORAGE_PREFIX}${intentId}`;",
      'const storageKey = "sb-shared-auth-token";',
    ),
    gateway.replaceAll("key === verifierKey", 'key.endsWith("-code-verifier")'),
    gateway.replace(
      "        storage.setItem(key, value);",
      "        memory.set(key, value);",
    ),
    gateway.replace(
      "      memory.set(key, value);",
      "      storage.setItem(key, value);",
    ),
    gateway.replace(
      "        storage.removeItem(key);",
      "        memory.delete(key);",
    ),
  ];
  assert.equal(mutants.length, 6);
  for (const mutant of mutants) {
    assert.notEqual(mutant, gateway);
    assert.throws(
      () => auditTransientPkceStorage(mutant),
      (error: unknown) => (
        error instanceof assert.AssertionError
        && error.message.includes(PKCE_STORAGE_FAILURE)
      ),
    );
  }
});

test("callback conserva A transitorio y registro exige fase DTO antes de transferir", () => {
  const callbackStart = gateway.indexOf("export async function completeGoogleOAuth");
  const registerStart = gateway.indexOf("async function register(");
  const transferStart = gateway.indexOf("async transferToPrincipal");
  assert.ok(callbackStart >= 0 && registerStart > callbackStart && transferStart > registerStart);
  assert.doesNotMatch(gateway.slice(callbackStart, registerStart), /\.rpc\(/);
  assert.match(gateway, /register_own_google_user/);
  assert.match(gateway, /register_own_google_coach/);
  assert.match(gateway, /rowUserId !== userId/);
  assert.match(gateway, /activated\.data\.user\?\.id !== userId/);
  assert.match(gateway, /identity\.user_id === expectedUserId/);
});

function hasFinalPrincipalTransferGuard(source: string) {
  const transferStart = source.indexOf("async transferToPrincipal");
  const transferEnd = source.indexOf("\n    },", transferStart);
  const transfer = source.slice(transferStart, transferEnd);
  const transientSession = transfer.indexOf("await transient.auth.getSession()");
  const principalRead = transfer.indexOf("await readPrincipalUserId(principal, guard)");
  const finalCurrent = transfer.indexOf("assertCurrent(guard);", principalRead);
  const setSession = transfer.indexOf("principal.auth.setSession", finalCurrent);
  const afterPrincipalRead = transfer.slice(
    principalRead + "await readPrincipalUserId(principal, guard)".length,
    setSession,
  );
  return transientSession >= 0
    && principalRead > transientSession
    && finalCurrent > principalRead
    && setSession > finalCurrent
    && !afterPrincipalRead.includes("await ");
}

test("transfer revalida principal como último await antes de setSession y mata mutantes", () => {
  assert.equal(hasFinalPrincipalTransferGuard(gateway), true);
  const finalRead = "      const principalUserId = await readPrincipalUserId(principal, guard);\n";
  const finalReadIndex = gateway.lastIndexOf(finalRead);
  assert.ok(finalReadIndex >= 0);
  const withoutFinalRead = `${gateway.slice(0, finalReadIndex)}      const principalUserId = null;\n${gateway.slice(finalReadIndex + finalRead.length)}`;
  const movedFinalRead = `${gateway.slice(0, finalReadIndex)}${gateway.slice(finalReadIndex + finalRead.length)}`.replace(
    "      await assertTransientIdentity(transient, userId, guard);\n      const sessionResult = await transient.auth.getSession();",
    "      const principalUserId = await readPrincipalUserId(principal, guard);\n      await assertTransientIdentity(transient, userId, guard);\n      const sessionResult = await transient.auth.getSession();",
  );
  assert.equal(hasFinalPrincipalTransferGuard(withoutFinalRead), false);
  assert.equal(hasFinalPrincipalTransferGuard(movedFinalRead), false);
});

test("owner Auth controla Strict Mode, single-flight, URL, revisión y A→B", () => {
  assert.match(boundary, /callbackAttemptRef/);
  assert.match(boundary, /handlingStarted/);
  assert.match(boundary, /createGoogleOAuthOperationOwnerController/);
  assert.match(boundary, /createGoogleOAuthSingleFlight/);
  assert.match(boundary, /formGuard\.isCurrent\(\)/);
  assert.match(boundary, /currentLocationKey\(\) === expectedLocationRef\.current/);
  assert.match(boundary, /acceptPrincipalIdentity\(session\?\.user\.id \?\? null\)/);
  assert.doesNotMatch(boundary, /signOut\(/);
  assert.doesNotMatch(boundary, /startControllerRef\.current\.clear\(/);
  const resetKeepsStartFlight = (source: string) => !/startControllerRef/.test(source);
  const reset = boundary.slice(boundary.indexOf("function resetPendingRegistration("), boundary.indexOf("function start("));
  const start = boundary.slice(boundary.indexOf("function start("), boundary.indexOf("async function submitRegistration("));
  assert.equal(resetKeepsStartFlight(reset), true);
  assert.ok(start.indexOf("startControllerRef.current.start") < start.indexOf("resetPendingRegistration()"));
  assert.ok(start.indexOf("resetPendingRegistration()") < start.indexOf("ownerControllerRef.current.begin()"));
  assert.ok(start.indexOf("ownerControllerRef.current.begin()") < start.indexOf("await startGoogleOAuth(input)"));

  const clearStartMutant = boundary.replace(
    "    submitFlightRef.current.clear();",
    "    submitFlightRef.current.clear();\n    startControllerRef.current.clear();",
  );
  const mutantReset = clearStartMutant.slice(
    clearStartMutant.indexOf("function resetPendingRegistration("),
    clearStartMutant.indexOf("function start("),
  );
  assert.equal(resetKeepsStartFlight(mutantReset), false);
});

test("boundary navega sólo después de transfer y guard vigente; mutante adelantado muere", () => {
  const helper = read("./model/google-oauth-operation-owner.ts");
  const helperStart = helper.indexOf("export async function transferGoogleOAuthAndNavigate");
  const helperEnd = helper.indexOf("\n}\n", helperStart) + 2;
  const transferBoundary = helper.slice(helperStart, helperEnd);
  const isGuardedNavigation = (source: string) => {
    const awaitedTransfer = source.indexOf("await input.transfer()");
    const currentGuard = source.indexOf("input.guard.isCurrent()", awaitedTransfer);
    const navigation = source.indexOf("input.navigate()");
    return awaitedTransfer >= 0 && currentGuard > awaitedTransfer && navigation > currentGuard;
  };
  assert.equal(isGuardedNavigation(transferBoundary), true);

  const earlyNavigationMutant = transferBoundary.replace(
    "  await input.transfer();",
    "  input.navigate();\n  await input.transfer();",
  );
  assert.equal(isGuardedNavigation(earlyNavigationMutant), false);

  const loginBranch = boundary.slice(
    boundary.indexOf('if (operation.intent.mode === "login")'),
    boundary.indexOf("const cleanRegistrationLocation"),
  );
  assert.match(loginBranch, /transferGoogleOAuthAndNavigate/);
  assert.doesNotMatch(loginBranch, /window\.location\.replace[\s\S]*transferGoogleOAuthAndNavigate/);
  const submitBranch = boundary.slice(
    boundary.indexOf("async function submitRegistration("),
    boundary.indexOf("function isPendingRegistrationCurrent("),
  );
  assert.match(submitBranch, /transferGoogleOAuthAndNavigate/);
  assert.doesNotMatch(submitBranch, /window\.location\.replace[\s\S]*transferGoogleOAuthAndNavigate/);
  assert.doesNotMatch(boundary, /await operation\.transferToPrincipal/);
  assert.equal(boundary.match(/window\.location\.replace/g)?.length, 2);
});

test("composition root queda sólo con wiring tipado Google", () => {
  assert.match(entry, /const googleOAuth = useGoogleOAuthCallbackGate\(\)/);
  assert.match(entry, /googleOAuth=\{googleOAuth\}/);
  assert.match(root, /googleOAuth: GoogleOAuthBoundary/);
  assert.match(root, /googleOAuth=\{googleOAuth\}/);
  assert.doesNotMatch(root, /startGoogleOAuth|completeGoogleOAuth|handleGoogleOAuth|GoogleOAuthIntent/);
  assert.match(screen, /googleOAuth\.submitRegistration/);
  assert.match(screen, /googleOAuth\.start\(\{ mode, portal: accountType \}\)/);
});

test("RPC Google derivan autorización sólo de auth.uid y auth.identities", () => {
  assert.match(migration, /identity\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /identity\.provider = 'google'/);
  assert.match(migration, /create function public\.register_own_google_user\(/);
  assert.match(migration, /create function public\.register_own_google_coach\(/);
  assert.match(migration, /security definer[\s\S]*?set search_path = ''/);
  assert.match(migration, /insert into public\.user_registrations \(user_id\)/);
  assert.match(migration, /insert into public\.coach_registrations \([\s\S]*?user_id/);
  assert.match(migration, /update public\.profiles as profile/g);
  assert.doesNotMatch(migration, /p_user_id|p_owner_id|p_profile_id|p_is_google|p_authorized/);
  assert.doesNotMatch(migration, /create or replace function public\.register_own_(?:user|coach)\(/);
  assert.match(migration, /force row level security/g);
  assert.match(migration, /revoke all on function public\.register_own_google_user[\s\S]*?from public/);
  assert.match(migration, /grant execute on function public\.register_own_google_coach[\s\S]*?to authenticated/);
});
