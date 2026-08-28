import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const PACKAGE_PATH = "package.json";
const EMAIL_TEST_SCRIPT = "test:email-onboarding";
const MIGRATION_CONTRACT_PATH =
  "src/features/auth/email-onboarding-migration-contract.test.ts";

const EXPECTED_EMAIL_ONBOARDING_FOCALS = [
  "src/features/auth/email-onboarding-auth-wiring-contract.test.ts",
  "src/features/auth/email-onboarding-edge-contract.test.ts",
  "src/features/auth/email-onboarding-migration-contract.test.ts",
  "src/features/auth/email-onboarding-test-inventory-contract.test.ts",
  "supabase/functions/_shared/email-onboarding/auth-hook-payload.test.ts",
  "supabase/functions/_shared/email-onboarding/brevo-client.test.ts",
  "supabase/functions/_shared/email-onboarding/standard-webhook-signature.test.ts",
  "supabase/functions/_shared/email-onboarding/supabase-rest.test.ts",
  "supabase/functions/_shared/email-onboarding/templates.test.ts",
  "supabase/functions/auth-send-email-hook/handler.test.ts",
  "supabase/functions/send-welcome-email/handler.test.ts",
] as const;

interface PackageManifest {
  scripts?: Record<string, string>;
}

function walkTypeScriptTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkTypeScriptTests(path);
    return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function discoverEmailOnboardingFocals() {
  const authFeatureFocals = readdirSync("src/features/auth", { withFileTypes: true })
    .filter((entry) => (
      entry.isFile() && /^email-onboarding-.*\.test\.tsx?$/.test(entry.name)
    ))
    .map((entry) => join("src/features/auth", entry.name));

  return [
    ...authFeatureFocals,
    ...walkTypeScriptTests("supabase/functions/_shared/email-onboarding"),
    ...walkTypeScriptTests("supabase/functions/auth-send-email-hook"),
    ...walkTypeScriptTests("supabase/functions/send-welcome-email"),
  ].sort();
}

function registeredEmailOnboardingFocals(script: string) {
  return script.match(
    /\b(?:src|supabase)\/[a-z0-9_./-]+\.test\.tsx?\b/gi,
  ) ?? [];
}

function assertExactInventory(script: string) {
  const expected = [...EXPECTED_EMAIL_ONBOARDING_FOCALS].sort();
  const discovered = discoverEmailOnboardingFocals();
  const registered = registeredEmailOnboardingFocals(script);
  const uniqueRegistered = [...new Set(registered)].sort();

  assert.deepEqual(
    discovered,
    expected,
    "el inventario focal EMAIL en disco debe ser exactamente el esperado",
  );
  assert.equal(
    registered.length,
    uniqueRegistered.length,
    "package.json no debe registrar focales EMAIL duplicados",
  );
  assert.deepEqual(
    uniqueRegistered,
    expected,
    "package.json debe registrar exactamente una vez cada focal EMAIL esperado",
  );
}

const packageManifest = JSON.parse(
  readFileSync(PACKAGE_PATH, "utf8"),
) as PackageManifest;
const emailTestScript = packageManifest.scripts?.[EMAIL_TEST_SCRIPT] ?? "";

test("EMAIL-ONBOARDING-01 mantiene inventario focal exacto 1:1 en package.json", () => {
  assertExactInventory(emailTestScript);
});

test("mutation probe mata la omisión del contrato de migración", () => {
  assert.equal(
    emailTestScript.split(MIGRATION_CONTRACT_PATH).length - 1,
    1,
    "precondición: migration-contract está registrado exactamente una vez",
  );
  const mutatedScript = emailTestScript.replace(MIGRATION_CONTRACT_PATH, "");
  assert.throws(
    () => assertExactInventory(mutatedScript),
    /package\.json debe registrar exactamente una vez cada focal EMAIL esperado/,
  );
});
