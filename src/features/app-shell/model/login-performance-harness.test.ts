import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  auditLoginPerformancePlan,
  createCurrentScopedAuditContract,
  createLoginPerformancePlan,
  createLoginSessionPerformanceHarness,
  createOptimizedScopedAuditContract,
  CURRENT_SCOPED_LOGIN_BASELINE,
  LOGIN_TO_DASHBOARD_BUDGET,
  measureLoginPerformancePlan,
  OPTIMIZED_SCOPED_LOGIN_TARGET,
  OPTIMIZED_SCOPED_REQUIRED_CANONICAL_DEPENDENCY_IDS,
  type LoginPerformanceOperation,
  type LoginPerformancePlan,
  type LoginPerformanceViolationCode,
  type LoginSessionTrigger,
} from "@/features/app-shell/model/login-performance-harness";

function replaceOperation(
  plan: LoginPerformancePlan,
  operationId: string,
  update: (item: LoginPerformanceOperation) => LoginPerformanceOperation,
): LoginPerformancePlan {
  return {
    ...plan,
    operations: plan.operations.map((item) => item.id === operationId ? update(item) : item),
  };
}

function addDashboardDependency(plan: LoginPerformancePlan, dependency: string) {
  return replaceOperation(plan, plan.dashboardMilestoneId, (item) => ({
    ...item,
    dependsOn: [...item.dependsOn, dependency],
  }));
}

function violationCodes(plan: LoginPerformancePlan) {
  return auditLoginPerformancePlan(plan, createCurrentScopedAuditContract())
    .map((violation) => violation.code);
}

function assertProbeCaught(
  plan: LoginPerformancePlan,
  expectedCode: LoginPerformanceViolationCode,
) {
  assert.equal(
    violationCodes(plan).includes(expectedCode),
    true,
    `probe must be rejected with ${expectedCode}`,
  );
}

function completedCriticalRequests(plan: LoginPerformancePlan) {
  return new Set(plan.operations
    .filter((item) => item.kind === "request" && item.workClass === "critical")
    .map((item) => item.id));
}

function createScopedPlan(includeProfileBackground = false) {
  return createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground,
    profileHasAvatar: includeProfileBackground,
  });
}

test("mide escenarios Login→Dashboard sin red, reloj ni navegador", () => {
  const measurements = {
    legacy: measureLoginPerformancePlan(createLoginPerformancePlan({
      dataScenario: "legacy",
      includeProfileBackground: false,
    })),
    activeCycleLegacy: measureLoginPerformancePlan(createLoginPerformancePlan({
      dataScenario: "active-cycle-legacy",
      includeProfileBackground: false,
    })),
    scopedWithoutSessions: measureLoginPerformancePlan(createLoginPerformancePlan({
      dataScenario: "scoped-without-sessions",
      includeProfileBackground: false,
    })),
    scopedWithSessions: measureLoginPerformancePlan(createLoginPerformancePlan({
      dataScenario: "scoped-with-sessions",
      includeProfileBackground: false,
    })),
    optimizedScoped: measureLoginPerformancePlan(createLoginPerformancePlan({
      dataScenario: "optimized-scoped-with-sessions",
      includeProfileBackground: false,
    })),
  };

  assert.deepEqual(measurements.legacy.critical, { requests: 6, waves: 6 });
  assert.deepEqual(measurements.activeCycleLegacy.critical, { requests: 10, waves: 6 });
  assert.deepEqual(measurements.scopedWithoutSessions.critical, { requests: 16, waves: 9 });
  assert.deepEqual(measurements.scopedWithSessions.critical, CURRENT_SCOPED_LOGIN_BASELINE);
  assert.deepEqual(measurements.optimizedScoped.critical, OPTIMIZED_SCOPED_LOGIN_TARGET);
  assert.equal(measurements.legacy.withinBudget, true);
  assert.equal(measurements.activeCycleLegacy.withinBudget, true);
  assert.equal(measurements.scopedWithoutSessions.withinBudget, false);
  assert.equal(measurements.scopedWithSessions.withinBudget, false);
  assert.equal(measurements.optimizedScoped.withinBudget, true);
  assert.deepEqual(LOGIN_TO_DASHBOARD_BUDGET, { requests: 12, waves: 6 });
});

test("representa la topología productiva optimizada como 10 solicitudes y 6 ondas", () => {
  const plan = createLoginPerformancePlan({
    dataScenario: "optimized-scoped-with-sessions",
    includeProfileBackground: false,
  });
  const measurement = measureLoginPerformancePlan(plan);

  assert.deepEqual(measurement.critical, { requests: 10, waves: 6 });
  assert.equal(measurement.dashboardWave, 6);
  assert.equal(plan.operations.some((item) => item.id.startsWith("legacy.")), false);
  assert.deepEqual(createOptimizedScopedAuditContract().requiredCanonicalDependencyIds, [
    ...OPTIMIZED_SCOPED_REQUIRED_CANONICAL_DEPENDENCY_IDS,
  ]);
  assert.deepEqual(auditLoginPerformancePlan(plan, createOptimizedScopedAuditContract()), []);
  assert.deepEqual(
    measurement.waves.map((wave) => [wave.wave, wave.critical]),
    [
      [1, ["auth.sign-in"]],
      [2, ["cycles.active.auth"]],
      [3, ["cycles.active.read"]],
      [4, ["scoped.plan.auth"]],
      [5, [
        "scoped.sessions.auth",
        "scoped.plan.routines",
        "scoped.plan.days",
        "scoped.plan.exercises",
      ]],
      [6, ["scoped.sessions.read", "scoped.entries.read"]],
    ],
  );
});

test("probes optimizados derivan el gate del DAG sin legacy", () => {
  const baseline = createLoginPerformancePlan({
    dataScenario: "optimized-scoped-with-sessions",
    includeProfileBackground: false,
  });
  const withoutLogin = replaceOperation(baseline, "cycles.active.auth", (item) => ({
    ...item,
    dependsOn: [],
  }));
  const authWithoutRealSerialization = replaceOperation(
    baseline,
    "scoped.sessions.auth",
    (item) => ({ ...item, dependsOn: ["cycles.active.read"] }),
  );
  const reintroducedLegacy: LoginPerformancePlan = {
    ...baseline,
    operations: [...baseline.operations, {
      id: "legacy.reintroduced",
      label: "Legacy reintroducido",
      kind: "request",
      workClass: "critical",
      dependsOn: ["auth.sign-in"],
    }],
  };
  const legacyBlocking = replaceOperation(
    reintroducedLegacy,
    baseline.canonicalMilestoneId,
    (item) => ({ ...item, dependsOn: [...item.dependsOn, "legacy.reintroduced"] }),
  );

  assert.deepEqual(measureLoginPerformancePlan(withoutLogin).critical, { requests: 9, waves: 5 });
  assert.ok(auditLoginPerformancePlan(withoutLogin, createOptimizedScopedAuditContract()).length > 0);
  assert.deepEqual(measureLoginPerformancePlan(authWithoutRealSerialization).critical, { requests: 10, waves: 5 });
  assert.ok(auditLoginPerformancePlan(authWithoutRealSerialization, createOptimizedScopedAuditContract()).length > 0);
  assert.equal(
    auditLoginPerformancePlan(legacyBlocking, createOptimizedScopedAuditContract())
      .some((violation) => violation.code === "REQUEST_COUNT_CHANGED"),
    true,
  );
});

test("Profile/history background no pueden volver al await de Dashboard", () => {
  const plan = createLoginPerformancePlan({
    dataScenario: "optimized-scoped-with-sessions",
    includeProfileBackground: true,
  });
  const blocked = addDashboardDependency(plan, "background.profile.auth");
  assert.equal(
    auditLoginPerformancePlan(blocked, createOptimizedScopedAuditContract())
      .some((violation) => violation.code === "BACKGROUND_BLOCKS_DASHBOARD"),
    true,
  );
});

test("documenta el baseline scoped actual como 17 solicitudes y 10 ondas", () => {
  const plan = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const measurement = measureLoginPerformancePlan(plan);

  assert.deepEqual(measurement.critical, { requests: 17, waves: 10 });
  assert.equal(measurement.dashboardWave, 10);
  assert.deepEqual(auditLoginPerformancePlan(plan, createCurrentScopedAuditContract()), []);
});

test("fija externamente todas las dependencias obligatorias del canon scoped", () => {
  assert.deepEqual(createCurrentScopedAuditContract().requiredCanonicalDependencyIds, [
    "legacy.sessions",
    "cycles.active.read",
    "scoped.plan.exercises",
    "scoped.sessions.read",
    "scoped.entries.read",
  ]);
});

test("distingue solicitudes paralelas de cadenas secuenciales", () => {
  const plan = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const measurement = measureLoginPerformancePlan(plan);

  assert.equal(measurement.operationWaves["legacy.auth"], 2);
  assert.equal(measurement.operationWaves["cycles.active.auth"], 2);
  assert.equal(measurement.operationWaves["cycles.history.auth"], 2);
  assert.equal(measurement.operationWaves["cycles.active.read"], 3);
  assert.equal(measurement.operationWaves["cycles.history.read"], 3);
  assert.deepEqual(
    measurement.waves.find((wave) => wave.wave === 2)?.critical,
    ["legacy.auth", "cycles.active.auth", "cycles.history.auth"],
  );
  assert.deepEqual(
    [
      measurement.operationWaves["scoped.plan.auth"],
      measurement.operationWaves["scoped.plan.routines"],
      measurement.operationWaves["scoped.plan.days"],
      measurement.operationWaves["scoped.plan.exercises"],
    ],
    [4, 5, 6, 7],
  );
});

for (const order of [
  ["handler", "SIGNED_IN"],
  ["SIGNED_IN", "handler"],
] as const satisfies readonly (readonly LoginSessionTrigger[])[]) {
  test(`handler/SIGNED_IN coalescen un refresh: ${order.join(" → ")}`, () => {
    const lifecycle = createLoginSessionPerformanceHarness();
    const first = lifecycle.observe("user-a", order[0]);
    const second = lifecycle.observe("user-a", order[1]);

    assert.equal(first.runId, second.runId);
    assert.deepEqual(lifecycle.getRun(first), {
      ...first,
      triggers: [...order],
      refreshes: 1,
      dashboardPublications: 0,
    });
  });
}

test("INITIAL_SESSION/bootstrap comparten una ejecución y mantienen 17/10", () => {
  const lifecycle = createLoginSessionPerformanceHarness();
  const fromInitialSession = lifecycle.observe("user-a", "INITIAL_SESSION");
  const fromBootstrap = lifecycle.observe("user-a", "bootstrap");
  const plan = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    entryPoint: "initial-session-bootstrap",
    includeProfileBackground: false,
  });

  assert.equal(fromInitialSession.runId, fromBootstrap.runId);
  assert.equal(lifecycle.getRun(fromInitialSession)?.refreshes, 1);
  assert.deepEqual(measureLoginPerformancePlan(plan).critical, { requests: 17, waves: 10 });
});

test("A → SIGNED_OUT → B invalida A y sólo B puede publicar Dashboard", () => {
  const lifecycle = createLoginSessionPerformanceHarness();
  const plan = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const completed = completedCriticalRequests(plan);
  const runA = lifecycle.observe("user-a", "handler");
  lifecycle.signedOut();
  const runB = lifecycle.observe("user-b", "SIGNED_IN");

  assert.equal(lifecycle.publishDashboard(runA, plan, completed), "stale");
  assert.equal(lifecycle.publishDashboard(runB, plan, completed), "published");
  assert.equal(lifecycle.publishDashboard(runB, plan, completed), "already-published");
  assert.equal(lifecycle.getRun(runA)?.dashboardPublications, 0);
  assert.equal(lifecycle.getRun(runB)?.dashboardPublications, 1);
});

test("Dashboard espera el canon scoped completo", () => {
  const lifecycle = createLoginSessionPerformanceHarness();
  const plan = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const run = lifecycle.observe("user-a", "handler");
  const incomplete = completedCriticalRequests(plan);
  incomplete.delete("scoped.entries.read");

  assert.equal(lifecycle.publishDashboard(run, plan, incomplete), "canon-incomplete");
  assert.equal(lifecycle.publishDashboard(run, plan, completedCriticalRequests(plan)), "published");
});

test("probe mutante: quitar entries del canon reduce la clausura y viola la dependencia requerida", () => {
  const mutant = replaceOperation(createScopedPlan(), "canonical.scoped-ready", (item) => ({
    ...item,
    dependsOn: item.dependsOn.filter((dependency) => dependency !== "scoped.entries.read"),
  }));

  assert.deepEqual(measureLoginPerformancePlan(mutant).critical, { requests: 14, waves: 7 });
  assertProbeCaught(mutant, "REQUEST_COUNT_CHANGED");
  assertProbeCaught(mutant, "WAVE_COUNT_CHANGED");
  assertProbeCaught(mutant, "DASHBOARD_BEFORE_CANON");
});

test("probe mutante: quitar sesiones de la cadena canónica es rechazado", () => {
  const mutant = replaceOperation(createScopedPlan(), "scoped.entries.read", (item) => ({
    ...item,
    dependsOn: ["scoped.plan.exercises"],
  }));

  assert.deepEqual(measureLoginPerformancePlan(mutant).critical, { requests: 15, waves: 8 });
  assertProbeCaught(mutant, "REQUEST_COUNT_CHANGED");
  assertProbeCaught(mutant, "WAVE_COUNT_CHANGED");
  assertProbeCaught(mutant, "DASHBOARD_BEFORE_CANON");
});

test("una operación critical huérfana no altera solicitudes ni ondas protegidas", () => {
  const plan = createScopedPlan();
  const mutant: LoginPerformancePlan = {
    ...plan,
    operations: [...plan.operations, {
      id: "mutation.orphan-critical",
      label: "Mutation: critical huérfana",
      kind: "request",
      workClass: "critical",
      dependsOn: ["scoped.entries.read"],
    }],
  };

  const measurement = measureLoginPerformancePlan(mutant);
  assert.deepEqual(measurement.critical, { requests: 17, waves: 10 });
  assert.equal(
    measurement.waves.some((wave) => wave.critical.includes("mutation.orphan-critical")),
    false,
  );
  assert.deepEqual(violationCodes(mutant), []);
});

test("marcar background como critical sin conectarlo no altera el milestone", () => {
  const mutant = replaceOperation(createScopedPlan(true), "background.profile.auth", (item) => ({
    ...item,
    workClass: "critical",
  }));

  assert.deepEqual(measureLoginPerformancePlan(mutant).critical, { requests: 17, waves: 10 });
  assert.deepEqual(violationCodes(mutant), []);
});

test("quitar el edge canónico no puede compensarse con trabajo critical huérfano", () => {
  const planWithoutEntries = replaceOperation(
    createScopedPlan(),
    "canonical.scoped-ready",
    (item) => ({
      ...item,
      dependsOn: item.dependsOn.filter((dependency) => dependency !== "scoped.entries.read"),
    }),
  );
  const mutant: LoginPerformancePlan = {
    ...planWithoutEntries,
    operations: [...planWithoutEntries.operations, {
      id: "mutation.compensating-orphan",
      label: "Mutation: compensación huérfana",
      kind: "request",
      workClass: "critical",
      dependsOn: ["scoped.entries.read"],
    }],
  };

  assert.deepEqual(measureLoginPerformancePlan(mutant).critical, { requests: 14, waves: 7 });
  assertProbeCaught(mutant, "DASHBOARD_BEFORE_CANON");
});

test("separa el milestone crítico del trabajo Profile/avatar en background", () => {
  const plan = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: true,
    profileHasAvatar: true,
  });
  const measurement = measureLoginPerformancePlan(plan);
  const audit = auditLoginPerformancePlan(plan, createCurrentScopedAuditContract());

  assert.deepEqual(measurement.critical, { requests: 17, waves: 10 });
  assert.deepEqual(measurement.background, { requests: 8, waves: 8 });
  assert.deepEqual(measurement.total, { requests: 25, waves: 14 });
  assert.equal(measurement.dashboardWave, 10);
  assert.equal(audit.some((violation) => violation.code === "BACKGROUND_BLOCKS_DASHBOARD"), false);
});

test("probe mutante: una solicitud crítica adicional cambia el conteo", () => {
  const baseline = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const extraRequest: LoginPerformanceOperation = {
    id: "mutation.extra-request",
    label: "Mutation: request extra",
    kind: "request",
    workClass: "critical",
    dependsOn: [baseline.entryRequestId],
  };
  const mutant = addDashboardDependency({
    ...baseline,
    operations: [...baseline.operations, extraRequest],
  }, extraRequest.id);

  assert.deepEqual(measureLoginPerformancePlan(mutant).critical, { requests: 18, waves: 10 });
  assertProbeCaught(mutant, "REQUEST_COUNT_CHANGED");
});

test("probe mutante: una dependencia extra agrega una onda sin agregar solicitudes", () => {
  const baseline = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const mutant = replaceOperation(baseline, "scoped.plan.auth", (item) => ({
    ...item,
    dependsOn: [...item.dependsOn, "legacy.exercises"],
  }));

  assert.deepEqual(measureLoginPerformancePlan(mutant).critical, { requests: 17, waves: 11 });
  assertProbeCaught(mutant, "WAVE_COUNT_CHANGED");
});

test("probe mutante: serializar lecturas paralelas rompe el contrato", () => {
  const baseline = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const mutant = replaceOperation(baseline, "cycles.history.auth", (item) => ({
    ...item,
    dependsOn: ["cycles.active.read"],
  }));

  assert.notEqual(
    measureLoginPerformancePlan(mutant).operationWaves["cycles.active.auth"],
    measureLoginPerformancePlan(mutant).operationWaves["cycles.history.auth"],
  );
  assertProbeCaught(mutant, "REQUIRED_PARALLEL_GROUP_BROKEN");
});

test("probe mutante: Dashboard adelantado antes del canon es rechazado", () => {
  const baseline = createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground: false,
  });
  const mutant = replaceOperation(baseline, baseline.dashboardMilestoneId, (item) => ({
    ...item,
    dependsOn: ["scoped.plan.exercises"],
  }));

  assert.equal(
    measureLoginPerformancePlan(mutant).dashboardWave <
      measureLoginPerformancePlan(baseline).dashboardWave,
    true,
  );
  assertProbeCaught(mutant, "DASHBOARD_BEFORE_CANON");
});

const HARNESS_SOURCE_PATH = "src/features/app-shell/model/login-performance-harness.ts";
const EXTERNAL_PROBE_SOURCE = `
import assert from "node:assert/strict";
import {
  auditLoginPerformancePlan,
  createCurrentScopedAuditContract,
  createLoginPerformancePlan,
  createOptimizedScopedAuditContract,
  measureLoginPerformancePlan,
} from "./login-performance-harness.ts";

function replaceOperation(plan, id, update) {
  return {
    ...plan,
    operations: plan.operations.map((operation) => operation.id === id ? update(operation) : operation),
  };
}

function scoped(includeProfileBackground = false) {
  return createLoginPerformancePlan({
    dataScenario: "scoped-with-sessions",
    includeProfileBackground,
    profileHasAvatar: includeProfileBackground,
  });
}

function codes(plan) {
  return auditLoginPerformancePlan(plan, createCurrentScopedAuditContract())
    .map((violation) => violation.code);
}

const scenarios = [
  ["legacy", { requests: 6, waves: 6 }],
  ["active-cycle-legacy", { requests: 10, waves: 6 }],
  ["scoped-without-sessions", { requests: 16, waves: 9 }],
  ["scoped-with-sessions", { requests: 17, waves: 10 }],
  ["optimized-scoped-with-sessions", { requests: 10, waves: 6 }],
];
for (const [dataScenario, expected] of scenarios) {
  const measurement = measureLoginPerformancePlan(createLoginPerformancePlan({
    dataScenario,
    includeProfileBackground: false,
  }));
  assert.deepEqual(measurement.critical, expected, "PERF05_SEMANTIC: baseline " + dataScenario);
}

const optimized = createLoginPerformancePlan({
  dataScenario: "optimized-scoped-with-sessions",
  includeProfileBackground: false,
});
assert.deepEqual(
  auditLoginPerformancePlan(optimized, createOptimizedScopedAuditContract()),
  [],
  "PERF05_SEMANTIC: optimized audit",
);
assert.equal(
  optimized.operations.some((operation) => operation.id.startsWith("legacy.")),
  false,
  "PERF05_SEMANTIC: optimized has no legacy",
);

const baseline = scoped(true);
assert.deepEqual(codes(baseline), [], "PERF05_SEMANTIC: baseline audit");
assert.equal(
  baseline.operations
    .filter((operation) => operation.id.startsWith("background."))
    .every((operation) => operation.workClass === "background"),
  true,
  "PERF05_SEMANTIC: background classification",
);

const orphan = {
  ...baseline,
  operations: [...baseline.operations, {
    id: "external.orphan-critical",
    label: "External orphan critical",
    kind: "request",
    workClass: "critical",
    dependsOn: ["scoped.entries.read"],
  }],
};
assert.deepEqual(
  measureLoginPerformancePlan(orphan).critical,
  { requests: 17, waves: 10 },
  "PERF05_SEMANTIC: orphan critical excluded",
);

const withoutEntries = replaceOperation(baseline, "canonical.scoped-ready", (operation) => ({
  ...operation,
  dependsOn: operation.dependsOn.filter((dependency) => dependency !== "scoped.entries.read"),
}));
assert.equal(
  codes(withoutEntries).includes("DASHBOARD_BEFORE_CANON"),
  true,
  "PERF05_SEMANTIC: entries required by canon",
);

const withoutSessions = replaceOperation(baseline, "scoped.entries.read", (operation) => ({
  ...operation,
  dependsOn: ["scoped.plan.exercises"],
}));
assert.equal(
  codes(withoutSessions).includes("DASHBOARD_BEFORE_CANON"),
  true,
  "PERF05_SEMANTIC: sessions required by canon",
);

const earlyDashboard = replaceOperation(baseline, "ui.dashboard", (operation) => ({
  ...operation,
  dependsOn: ["scoped.plan.exercises"],
}));
assert.equal(
  codes(earlyDashboard).includes("DASHBOARD_BEFORE_CANON"),
  true,
  "PERF05_SEMANTIC: Dashboard cannot advance",
);

const compensated = {
  ...withoutEntries,
  operations: [...withoutEntries.operations, {
    id: "external.compensating-orphan",
    label: "External compensating orphan",
    kind: "request",
    workClass: "critical",
    dependsOn: ["scoped.entries.read"],
  }],
};
assert.deepEqual(
  measureLoginPerformancePlan(compensated).critical,
  { requests: 14, waves: 7 },
  "PERF05_SEMANTIC: orphan cannot compensate a removed dependency",
);
assert.equal(
  codes(compensated).includes("DASHBOARD_BEFORE_CANON"),
  true,
  "PERF05_SEMANTIC: compensated dependency remains invalid",
);

console.log("PERF05_EXTERNAL_PROBE_PASS");
`;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceExactlyOnce(source: string, before: string, after: string) {
  const firstIndex = source.indexOf(before);
  assert.notEqual(firstIndex, -1, `mutation target not found: ${before}`);
  assert.equal(source.indexOf(before, firstIndex + before.length), -1, `mutation target duplicated: ${before}`);
  return source.slice(0, firstIndex) + after + source.slice(firstIndex + before.length);
}

function runTemporaryExternalProbe(input: {
  original: string;
  candidate: string;
  expectKilled: boolean;
}) {
  const sourceSha = sha256(input.original);
  const directory = mkdtempSync(join(tmpdir(), "organizatech-perf-05a-"));
  const temporaryHarness = join(directory, "login-performance-harness.ts");
  const temporaryProbe = join(directory, "probe.ts");
  try {
    writeFileSync(temporaryHarness, input.candidate, "utf8");
    writeFileSync(temporaryProbe, EXTERNAL_PROBE_SOURCE, "utf8");
    const result = spawnSync(resolve("node_modules/.bin/tsx"), [temporaryProbe], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (input.expectKilled) {
      assert.notEqual(result.status, 0, "el mutante debe morir");
      assert.match(output, /PERF05_SEMANTIC:/, "el mutante debe morir por causa semántica");
      assert.doesNotMatch(output, /Transform failed|SyntaxError/, "el mutante debe conservar sintaxis válida");
    } else {
      assert.equal(result.status, 0, output);
      assert.match(output, /PERF05_EXTERNAL_PROBE_PASS/);
    }

    writeFileSync(temporaryHarness, input.original, "utf8");
    assert.equal(readFileSync(temporaryHarness, "utf8"), input.original);
    assert.equal(sha256(readFileSync(temporaryHarness, "utf8")), sourceSha);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    assert.equal(existsSync(directory), false, "el temporal debe eliminarse");
    assert.equal(sha256(readFileSync(HARNESS_SOURCE_PATH, "utf8")), sourceSha);
  }
}

test("probe externo baseline ejecuta el contrato semántico independiente", () => {
  const original = readFileSync(HARNESS_SOURCE_PATH, "utf8");
  runTemporaryExternalProbe({ original, candidate: original, expectKilled: false });
});

for (const mutation of [
  {
    name: "eliminar scoped.entries.read del canon",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '["legacy.sessions", "scoped.plan.exercises", scopedDataDependency],',
      '["legacy.sessions", "scoped.plan.exercises"],',
    ),
  },
  {
    name: "eliminar sesiones de la cadena canónica",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '["scoped.sessions.read"],\n        ));',
      '["scoped.plan.exercises"],\n        ));',
    ),
  },
  {
    name: "volver a contar una operación critical huérfana",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'const criticalRequests = requestOperations.filter((item) => (\n    item.workClass === "critical" && dashboardAncestorIds.has(item.id)\n  ));',
      'const criticalRequests = requestOperations.filter((item) => item.workClass === "critical");',
    ),
  },
  {
    name: "marcar background como critical sin conectarlo",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'operation("background.profile.auth", "Profile: validar usuario", "request", "background", [dependencyId]),',
      'operation("background.profile.auth", "Profile: validar usuario", "request", "critical", [dependencyId]),',
    ),
  },
  {
    name: "adelantar Dashboard",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    [canonicalMilestoneId],\n  ));',
      '    [dataScenario === "scoped-with-sessions" ? "scoped.plan.exercises" : canonicalMilestoneId],\n  ));',
    ),
  },
  {
    name: "hardcodear el resultado sin derivarlo del DAG",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '  const critical = {\n    requests: criticalRequests.length,\n    waves: measureClassWaves(plan, "critical", dashboardAncestorIds),\n  };',
      '  const critical = { requests: 17, waves: 10 };',
    ),
  },
  {
    name: "eliminar dependencia y agregar compensación huérfana",
    apply: (source: string) => {
      const withoutDependency = replaceExactlyOnce(
        source,
        '["legacy.sessions", "scoped.plan.exercises", scopedDataDependency],',
        '["legacy.sessions", "scoped.plan.exercises"],',
      );
      return replaceExactlyOnce(
        withoutDependency,
        '      canonicalMilestoneId = "canonical.scoped-ready";',
        '      if (dataScenario === "scoped-with-sessions") {\n        operations.push(operation("mutation.compensating-orphan", "Mutation: compensación huérfana", "request", "critical", ["scoped.entries.read"]));\n      }\n      canonicalMilestoneId = "canonical.scoped-ready";',
      );
    },
  },
] as const) {
  test(`probe externo SHA-256: ${mutation.name}`, () => {
    const original = readFileSync(HARNESS_SOURCE_PATH, "utf8");
    const mutated = mutation.apply(original);
    assert.notEqual(mutated, original);
    runTemporaryExternalProbe({ original, candidate: mutated, expectKilled: true });
  });
}
