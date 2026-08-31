import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  readonly scripts: Readonly<Record<string, string>>;
};

const domainTests = [
  "src/features/training-cycle-builder/model/catalog-distribution.test.ts",
  "src/features/training-cycle-builder/model/dates-validation.test.ts",
  "src/features/training-cycle-builder/model/lifecycle.test.ts",
  "src/features/training-cycle-builder/model/metrics-suggestions.test.ts",
  "src/features/training-cycle-builder/model/operations-techniques.test.ts",
  "src/features/training-cycle-builder/model/recommendations.test.ts",
  "src/features/training-cycle-builder/model/snapshots.test.ts",
] as const;

const frontendChecks = [
  "src/features/training-cycle-builder/hooks/training-cycle-builder-fixtures.check.ts",
  "src/features/training-cycle-builder/hooks/training-cycle-builder-state.check.ts",
  "src/features/training-cycle-builder/hooks/training-cycle-draft-autosave.check.ts",
  "src/features/training-cycle-builder/hooks/training-cycle-video-url.check.ts",
  "src/features/training-cycle-builder/training-cycle-builder-frontend-contract.check.ts",
] as const;

const backendTests = [
  "src/lib/server/cycle-redesign-backend-migration-contract.test.ts",
] as const;

const integrationTests = [
  "src/features/training-cycle-builder/data/training-cycle-rpc-parsers.test.ts",
  "src/features/training-cycle-builder/data/training-cycle-rpc-mappers.test.ts",
  "src/features/training-cycle-builder/data/supabase-training-cycle-rpc-gateway.test.ts",
  "src/features/training-cycle-builder/integration/training-cycle-product-view-model.test.ts",
  "src/features/training-cycle-builder/integration/training-cycle-product-suggestion.test.ts",
  "src/features/training-cycle-builder/integration/training-cycle-product-gateway.test.ts",
  "src/features/training-cycle-builder/hooks/use-training-cycle-product-controller.test.ts",
  "src/features/training-cycle-builder/active-workout/model/active-workout-execution.test.ts",
  "src/features/training-cycle-builder/active-workout/model/training-cycle-execution-draft-storage.test.ts",
  "src/features/training-cycle-builder/active-workout/model/training-cycle-execution-sync-owner.test.ts",
  "src/features/training-cycle-builder/active-workout/active-workout-execution-integration-contract.test.ts",
  "src/features/notifications/data/supabase-training-cycle-notifications-repository.test.ts",
  "src/features/notifications/hooks/usePersistedTrainingCycleNotifications.test.ts",
  "supabase/functions/_shared/training-cycle-lifecycle/templates.test.ts",
  "supabase/functions/process-training-cycle-lifecycle/handler.test.ts",
  "src/features/training-cycle-builder/training-cycle-builder-test-inventory-contract.test.ts",
] as const;

function pathsInScript(name: string) {
  const script = packageJson.scripts[name];
  assert.ok(script, `falta el script permanente ${name}`);
  return script.split(/\s+/).filter((token) => /\.(?:test|check)\.tsx?$/.test(token));
}

function filesUnder(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

test("los cuatro gates permanentes conservan un inventario exacto y sin duplicados", () => {
  const inventories = [
    ["test:training-cycle-builder-domain", domainTests],
    ["test:training-cycle-builder-frontend", frontendChecks],
    ["test:training-cycle-builder-backend", backendTests],
    ["test:training-cycle-builder-integration", integrationTests],
  ] as const;

  const allPaths: string[] = [];
  for (const [script, expected] of inventories) {
    const actual = pathsInScript(script);
    assert.deepEqual(actual, [...expected], `${script} debe enumerar exactamente su gate`);
    allPaths.push(...actual);
  }
  assert.equal(new Set(allPaths).size, allPaths.length, "cada prueba debe pertenecer a un solo gate");

  const featureTests = filesUnder("src/features/training-cycle-builder")
    .filter((path) => /\.(?:test|check)\.tsx?$/.test(path))
    .sort();
  const expectedFeatureTests = [...domainTests, ...frontendChecks, ...integrationTests]
    .filter((path) => path.startsWith("src/features/training-cycle-builder/"))
    .sort();
  assert.deepEqual(featureTests, expectedFeatureTests, "ningún test de la feature queda fuera del gate");
});

test("npm test ejecuta todos los gates exactamente una vez", () => {
  const pretest = packageJson.scripts.pretest ?? "";
  const posttest = packageJson.scripts.posttest ?? "";
  for (const name of [
    "test:training-cycle-builder-domain",
    "test:training-cycle-builder-frontend",
    "test:training-cycle-builder-backend",
  ]) {
    assert.equal(pretest.split(`npm run ${name}`).length - 1, 1, `${name} debe ejecutarse una vez en pretest`);
  }
  assert.equal(
    posttest.split("npm run test:training-cycle-builder-integration").length - 1,
    1,
    "integración debe ejecutarse una vez en posttest",
  );
});
