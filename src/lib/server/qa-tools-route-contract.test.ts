import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const page = readFileSync("src/app/qa/training-cycles/page.tsx", "utf8");
const client = readFileSync("src/app/qa/training-cycles/training-cycles-qa-client.tsx", "utf8");
const serverGate = readFileSync("src/lib/server/qa-tools-access.ts", "utf8");
const environmentContract = readFileSync("docs/security/qa-routes-environment-contract.md", "utf8");

assert.match(page, /export const dynamic = "force-dynamic";/);
assert.match(page, /export const revalidate = 0;/);
assert.match(page, /notFound\(\)/);
assert.doesNotMatch(page, /force-static|Acceso bloqueado|VERCEL_ENV|NODE_ENV/);
assert.doesNotMatch(page, /NEXT_PUBLIC_ENABLE_QA_TOOLS|NEXT_PUBLIC_SUPABASE_ENV/);
assert.doesNotMatch(page, /accessState|searchParams|cookies\(/);

const gatePosition = page.indexOf("await isQaToolsAccessAllowed()");
const clientImportPosition = page.indexOf('await import("./training-cycles-qa-client")');
assert.ok(gatePosition >= 0 && clientImportPosition > gatePosition, "El cliente se importa después del gate");

assert.equal(serverGate.trimStart().startsWith('import "server-only";'), true, "El wrapper empieza con server-only");
assert.match(serverGate, /headers\(\)/);
assert.match(serverGate, /get\("x-forwarded-host"\)/);
assert.match(serverGate, /get\("host"\)/);
assert.match(serverGate, /process\.env\.ENABLE_QA_TOOLS/);
assert.match(serverGate, /process\.env\.QA_EXPECTED_SUPABASE_PROJECT_REF/);
assert.match(serverGate, /process\.env\.APP_PRODUCTION_HOSTS/);
assert.match(serverGate, /process\.env\.VERCEL_PROJECT_PRODUCTION_URL/);

assert.match(client, /\b\w+\.auth\.getUser\(\)/);
assert.match(client, /\b\w+\.auth\.onAuthStateChange/);
assert.match(client, /event === "SIGNED_OUT"/);
assert.match(client, /clearQaSessionState\(\)/);
assert.match(client, /window\.confirm/);
assert.match(client, /createdCycleIds/);
assert.match(client, /useRef\(false\)/);
assert.match(client, /mutationLockRef\.current/);
assert.doesNotMatch(client, /accessState|VERCEL_ENV|NODE_ENV|NEXT_PUBLIC_SUPABASE_ENV/);
assert.doesNotMatch(client, /console\.|error\.message|error\.stack|JSON\.stringify\(error/);

const runActionStart = client.indexOf("async function runAction");
const runActionEnd = client.indexOf("async function handleCreateCycle", runActionStart);
const runAction = client.slice(runActionStart, runActionEnd);
const policyPosition = runAction.indexOf("canRunQaAction(authStatus, isBusy)");
const refGuardPosition = runAction.indexOf("mutationLockRef.current");
const acquirePosition = runAction.indexOf("tryAcquireQaMutationLock(mutationLockRef)");
const busyPosition = runAction.indexOf("setIsBusy(true)");
const operationPosition = runAction.indexOf("await operation()");
const finallyPosition = runAction.indexOf("finally");
const releasePosition = runAction.indexOf("releaseQaMutationLock(mutationLockRef)");
assert.ok(runActionStart >= 0 && runActionEnd > runActionStart, "Se localizó runAction");
assert.ok(policyPosition >= 0 && refGuardPosition > policyPosition, "La política y el ref protegen la mutación");
assert.ok(acquirePosition >= 0 && acquirePosition < operationPosition, "El lock se adquiere antes del await");
assert.ok(acquirePosition < busyPosition && busyPosition < operationPosition, "El lock síncrono precede al estado visual y al await");
assert.ok(finallyPosition >= 0 && releasePosition > finallyPosition, "El lock se libera dentro de finally");

const clearStateStart = client.indexOf("const clearQaSessionState");
const clearStateEnd = client.indexOf("const pushLog", clearStateStart);
assert.doesNotMatch(
  client.slice(clearStateStart, clearStateEnd),
  /mutationLockRef|releaseQaMutationLock/,
  "El cierre de sesión no libera anticipadamente una mutación pendiente",
);

assert.equal(existsSync("public/diagramas/index.html"), false);
assert.equal(existsSync("public/limpiar-cache.html"), false);
assert.equal(existsSync("docs/internal/diagramas/index.html"), true);
assert.equal(existsSync("docs/internal/limpiar-cache.html"), true);
assert.equal(
  readdirSync("docs/internal/diagramas").filter((name) => name.endsWith(".svg")).length,
  9,
  "Se preservaron los nueve diagramas internos",
);

assert.match(environmentContract, /Production[\s\S]*`404` siempre/);
assert.match(environmentContract, /Deployment Protection/);
assert.match(environmentContract, /no reemplaza RLS/i);

console.log("qa-tools route contract tests passed");
