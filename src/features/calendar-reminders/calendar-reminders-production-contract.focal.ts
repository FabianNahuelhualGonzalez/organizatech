import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const migration = read("../../../supabase/migrations/20260826213606_calendar_reminders_shared_portal.sql");
const repository = read("./data/supabase-calendar-reminders-repository.ts");
const boundary = read("./components/calendar-reminders-productive-boundary.tsx");
const root = read("../../components/organizatech-app.tsx");
const coach = read("../coach-portal/components/coach-portal.tsx");
const packageJson = read("../../../package.json");

function hasTotalMonthlyGuards(source: string): boolean {
  return /calendar_reminders_monthly_shape check \([\s\S]*?monthly_mode is not null[\s\S]*?monthly_day is not null[\s\S]*?\) is true/i.test(source)
    && /if p_recurrence_frequency = 'monthly'[\s\S]*?p_monthly_mode is not null[\s\S]*?p_monthly_day is not null/i.test(source);
}

function hasPinnedWriteGuards(repositorySource: string, boundarySource: string): boolean {
  return repositorySource.includes("accessToken: async () => accessToken")
    && repositorySource.includes("persistSession: false")
    && (repositorySource.match(/if \(!input\.isCurrent\(\)\) throw new Error\("calendar-reminders-operation-stale"\);/g) ?? []).length >= 6
    && /principal\.auth\.getUser\(accessToken\)/.test(repositorySource)
    && /createPinnedCalendarRemindersClient\(accessToken: string\): CalendarRemindersDataClient/.test(repositorySource)
    && /input\.operation\.verifyExpectedUser\(\)/.test(repositorySource)
    && !repositorySource.includes("input.operation.dataClient.auth")
    && /const operation = await captureCalendarRemindersOperationClient/.test(boundarySource)
    && /createOwnCalendarReminder\(\{[\s\S]*?operation,/.test(boundarySource)
    && /<CalendarRemindersFeature[\s\S]*?key=\{identityKey\}/.test(boundarySource);
}

test("migración local aplica RLS/FORCE RLS, ownership Auth y grants mínimos", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /to authenticated[\s\S]*?auth\.uid\(\)[\s\S]*?user_id/i);
  assert.match(migration, /revoke all privileges on table public\.calendar_reminders from authenticated/i);
  assert.match(migration, /grant select on table public\.calendar_reminders to authenticated/i);
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|all).*calendar_reminders.*authenticated/i);
});

test("RPC SECURITY DEFINER está cerrada, calificada, allowlisted e idempotente", () => {
  assert.match(migration, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /p_(?:user|owner|profile)_id/i);
  assert.match(migration, /unique \(user_id, request_id\)/i);
  assert.match(migration, /on conflict \(user_id, request_id\) do nothing/i);
  assert.match(migration, /request_id payload mismatch/i);
  assert.match(migration, /revoke all on function public\.create_own_calendar_reminder[\s\S]*?from public/i);
  assert.match(migration, /grant execute on function public\.create_own_calendar_reminder[\s\S]*?to authenticated/i);
  assert.match(migration, /America\/Santiago/);
  assert.equal(hasTotalMonthlyGuards(migration), true);
  const monthlyMutants = [
    migration.replace("monthly_mode is not null", "monthly_mode is null"),
    migration.replace("monthly_day is not null", "monthly_day is null"),
    migration.replace(") is true\n  ),", ")\n  ),"),
  ];
  assert.equal(monthlyMutants.every((mutant) => !hasTotalMonthlyGuards(mutant)), true);
});

test("repository no hace writes directos y protege sesión antes y después de cada await remoto", () => {
  assert.doesNotMatch(repository, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.match(repository, /rpc\("create_own_calendar_reminder"/);
  assert.ok((repository.match(/await assertExpectedUser/g) ?? []).length >= 2);
  assert.ok((repository.match(/await input\.operation\.verifyExpectedUser/g) ?? []).length >= 2);
  assert.match(repository, /principal\.auth\.getUser\(accessToken\)/);
  assert.match(boundary, /generationRef\.current === generation/);
  assert.match(boundary, /globalThis\.crypto\.randomUUID\(\)/);
  assert.match(repository, /accessToken: async \(\) => accessToken/);
  assert.match(repository, /persistSession: false/);
  assert.match(repository, /if \(!input\.isCurrent\(\)\) throw new Error\("calendar-reminders-operation-stale"\)/);
  assert.equal(hasPinnedWriteGuards(repository, boundary), true);
  const freshnessMutants = [
    [repository.replace(/if \(!input\.isCurrent\(\)\) throw new Error\("calendar-reminders-operation-stale"\);/, ""), boundary],
    [repository, boundary.replace("operation,", "operation: client,")],
    [repository.replace(
      "input.operation.dataClient.rpc",
      "input.operation.dataClient.auth.getUser(); input.operation.dataClient.rpc",
    ), boundary],
  ] as const;
  assert.equal(freshnessMutants.every(([mutantRepository, mutantBoundary]) => (
    !hasPinnedWriteGuards(mutantRepository, mutantBoundary)
  )), true);
});

test("ambos portales conectan la misma boundary con su auth identity efectiva", () => {
  assert.match(root, /screen === "calendario"[\s\S]*?<CalendarRemindersProductiveBoundary[\s\S]*?identityKey=\{supabaseUser\.id\}/);
  assert.match(coach, /<CalendarRemindersProductiveBoundary[\s\S]*?identityKey=\{session\.userId\}/);
  assert.doesNotMatch(`${root}\n${coach}`, /service_role|SUPABASE_SERVICE/i);
  assert.match(coach, /aria-current=\{!isCalendarOpen && activeScreen === "profile" \? "page" : undefined\}/);
  assert.match(coach, /aria-current=\{isCalendarOpen \? "page" : undefined\}/);
});

test("gate oficial referencia una sola vez cada focal presente en disco", () => {
  const featureRoot = fileURLToPath(new URL("./", import.meta.url));
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
  const disk = walk(featureRoot)
    .filter((path) => path.endsWith(".focal.ts"))
    .map((path) => `src/features/calendar-reminders/${path.slice(featureRoot.length).replace(/^\/+/, "")}`)
    .sort();
  const refs = [...packageJson.matchAll(/src\/features\/calendar-reminders\/[\w/-]+\.focal\.ts/g)]
    .map(([path]) => path)
    .sort();
  assert.deepEqual(refs, disk);
  assert.equal(new Set(refs).size, refs.length);
});
