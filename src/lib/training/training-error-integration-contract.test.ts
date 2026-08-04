import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Training error integration source contract only.
 *
 * This test does not render React, simulate interactions or execute handlers.
 * Runtime behavior is covered by the unit tests for each error translator;
 * these assertions only guard imports, call-sites and integration boundaries.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const trainingDataControllerSource = readFileSync(
  "src/features/training-data/model/training-data-controller.ts",
  "utf8",
);
const packageStaticSource = readFileSync("package.json", "utf8");

const translators = [
  {
    name: "translateTrainingCycleRepositoryError",
    modulePath: "@/lib/training/training-cycle-error",
    sourcePath: "src/lib/training/training-cycle-error.ts",
    expectedCallSites: 4,
  },
  {
    name: "translateTrainingWorkoutReadinessError",
    modulePath: "@/lib/training/training-workout-readiness-repository",
    sourcePath: "src/lib/training/training-workout-readiness-repository.ts",
    expectedCallSites: 1,
  },
  {
    name: "translateTrainingWorkoutReadinessLinkError",
    modulePath: "@/lib/training/training-workout-readiness-link-flow",
    sourcePath: "src/lib/training/training-workout-readiness-link-flow.ts",
    expectedCallSites: 3,
  },
  {
    name: "translateDailyReadinessError",
    modulePath: "@/lib/training/training-daily-readiness-repository",
    sourcePath: "src/lib/training/training-daily-readiness-repository.ts",
    expectedCallSites: 2,
  },
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

assert.match(
  trainingDataControllerSource,
  /import \{ translateTrainingCycleRepositoryError \} from "@\/lib\/training\/training-cycle-error";/,
  "TrainingData importa el traductor canonico de ciclos",
);
assert.match(
  trainingDataControllerSource,
  /translateCycleError = translateTrainingCycleRepositoryError/,
  "el boundary usa el traductor canonico como dependencia por defecto",
);
assert.ok(
  (trainingDataControllerSource.match(/translateCycleError\(/g) ?? []).length >= 2,
  "errores de cycles y snapshot pasan por el traductor inyectado",
);

for (const translator of translators) {
  const importPattern = new RegExp(
    `import\\s*\\{[^}]*\\b${translator.name}\\b[^}]*\\}\\s*from\\s*"${escapeRegExp(translator.modulePath)}";`,
  );
  assert.match(
    appStaticSource,
    importPattern,
    `${translator.name} debe importarse desde su modulo preparado`,
  );
  assert.doesNotMatch(
    appStaticSource,
    new RegExp(`^\\s*(?:export\\s+)?function\\s+${translator.name}\\b`, "m"),
    `${translator.name} no debe conservar una implementacion local`,
  );

  const callSiteCount = appStaticSource.match(new RegExp(`\\b${translator.name}\\(`, "g"))?.length ?? 0;
  assert.equal(
    callSiteCount,
    translator.expectedCallSites,
    `${translator.name} debe conservar todos sus call-sites productivos`,
  );

  const moduleStaticSource = readFileSync(translator.sourcePath, "utf8");
  assert.match(
    moduleStaticSource,
    new RegExp(`export function ${translator.name}\\b`),
    `${translator.sourcePath} debe exportar ${translator.name}`,
  );
}

for (const testRegistration of [
  "tsx src/lib/training/training-cycle-error.test.ts",
  "tsx src/lib/training/training-error-integration-contract.test.ts",
]) {
  assert.equal(
    packageStaticSource.split(testRegistration).length - 1,
    1,
    `${testRegistration} debe registrarse exactamente una vez`,
  );
}

console.log("training error static integration source contract tests passed");
