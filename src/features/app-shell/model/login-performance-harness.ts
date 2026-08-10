export type LoginPerformanceWorkClass = "critical" | "background";
export type LoginPerformanceOperationKind = "request" | "milestone";

export interface LoginPerformanceOperation {
  readonly id: string;
  readonly label: string;
  readonly kind: LoginPerformanceOperationKind;
  readonly workClass: LoginPerformanceWorkClass;
  readonly dependsOn: readonly string[];
}

export type LoginPerformanceDataScenario =
  | "legacy"
  | "active-cycle-legacy"
  | "scoped-without-sessions"
  | "scoped-with-sessions"
  | "optimized-scoped-with-sessions";

export type LoginPerformanceEntryPoint = "interactive-login" | "initial-session-bootstrap";

export interface LoginPerformanceScenarioInput {
  readonly dataScenario: LoginPerformanceDataScenario;
  readonly entryPoint?: LoginPerformanceEntryPoint;
  readonly includeProfileBackground?: boolean;
  readonly profileHasAvatar?: boolean;
}

export interface LoginPerformancePlan {
  readonly name: string;
  readonly operations: readonly LoginPerformanceOperation[];
  readonly entryRequestId: string;
  readonly canonicalMilestoneId: string;
  readonly dashboardMilestoneId: string;
  readonly requiredParallelGroups: readonly (readonly string[])[];
}

export interface LoginPerformanceWorkMeasurement {
  readonly requests: number;
  readonly waves: number;
}

export interface LoginPerformanceWave {
  readonly wave: number;
  readonly critical: readonly string[];
  readonly background: readonly string[];
}

export interface LoginPerformanceMeasurement {
  readonly critical: LoginPerformanceWorkMeasurement;
  readonly background: LoginPerformanceWorkMeasurement;
  readonly total: LoginPerformanceWorkMeasurement;
  readonly dashboardWave: number;
  readonly completionWave: number;
  readonly withinBudget: boolean;
  readonly waves: readonly LoginPerformanceWave[];
  readonly operationWaves: Readonly<Record<string, number>>;
}

export interface LoginPerformanceAuditContract {
  readonly expectedCritical: LoginPerformanceWorkMeasurement;
  readonly canonicalMilestoneId: string;
  readonly dashboardMilestoneId: string;
  readonly requiredCanonicalDependencyIds: readonly string[];
  readonly requiredParallelGroups: readonly (readonly string[])[];
}

export type LoginPerformanceViolationCode =
  | "REQUEST_COUNT_CHANGED"
  | "WAVE_COUNT_CHANGED"
  | "REQUIRED_PARALLEL_GROUP_BROKEN"
  | "DASHBOARD_BEFORE_CANON"
  | "BACKGROUND_BLOCKS_DASHBOARD";

export interface LoginPerformanceViolation {
  readonly code: LoginPerformanceViolationCode;
  readonly detail: string;
}

export const LOGIN_TO_DASHBOARD_BUDGET: LoginPerformanceWorkMeasurement = {
  requests: 12,
  waves: 6,
};

/**
 * Code-derived baseline at 014095ed96c5f6eb43a8cfc91819a4eb962448ef.
 * It assumes an existing profile, legacy exercises with lineage, a scoped cycle,
 * scoped sessions with entries, and no historical scoped exercise lookup.
 */
export const CURRENT_SCOPED_LOGIN_BASELINE: LoginPerformanceWorkMeasurement = {
  requests: 17,
  waves: 10,
};

export const OPTIMIZED_SCOPED_LOGIN_TARGET: LoginPerformanceWorkMeasurement = {
  requests: 10,
  waves: 6,
};

export const CURRENT_SCOPED_REQUIRED_CANONICAL_DEPENDENCY_IDS = [
  "legacy.sessions",
  "cycles.active.read",
  "scoped.plan.exercises",
  "scoped.sessions.read",
  "scoped.entries.read",
] as const;

const CURRENT_SCOPED_REQUIRED_PARALLEL_GROUPS = [
  ["cycles.active.auth", "cycles.history.auth"],
  ["cycles.active.read", "cycles.history.read"],
] as const;

export const OPTIMIZED_SCOPED_REQUIRED_CANONICAL_DEPENDENCY_IDS = [
  "auth.sign-in",
  "cycles.active.read",
  "scoped.plan.routines",
  "scoped.plan.days",
  "scoped.plan.exercises",
  "scoped.sessions.read",
  "scoped.entries.read",
] as const;

const OPTIMIZED_SCOPED_REQUIRED_PARALLEL_GROUPS = [
  ["scoped.plan.routines", "scoped.plan.days", "scoped.plan.exercises"],
  ["scoped.sessions.read", "scoped.entries.read"],
] as const;

const operation = (
  id: string,
  label: string,
  kind: LoginPerformanceOperationKind,
  workClass: LoginPerformanceWorkClass,
  dependsOn: readonly string[],
): LoginPerformanceOperation => ({ id, label, kind, workClass, dependsOn });

function appendProfileBackground(
  operations: LoginPerformanceOperation[],
  profileHasAvatar: boolean,
  dependencyId = "legacy.sessions",
) {
  operations.push(
    operation("background.profile.auth", "Profile: validar usuario", "request", "background", [dependencyId]),
    operation("background.profile.row", "Profile: leer fila", "request", "background", ["background.profile.auth"]),
    operation("background.profile.post-auth", "Profile: revalidar usuario", "request", "background", ["background.profile.row"]),
  );
  if (!profileHasAvatar) return;
  operations.push(
    operation("background.avatar.auth", "Avatar: validar usuario", "request", "background", ["background.profile.post-auth"]),
    operation("background.avatar.row", "Avatar: leer metadata", "request", "background", ["background.avatar.auth"]),
    operation("background.avatar.post-row-auth", "Avatar: revalidar metadata", "request", "background", ["background.avatar.row"]),
    operation("background.avatar.signed-url", "Avatar: crear URL firmada", "request", "background", ["background.avatar.post-row-auth"]),
    operation("background.avatar.post-url-auth", "Avatar: revalidar URL", "request", "background", ["background.avatar.signed-url"]),
  );
}

function createOptimizedScopedLoginPerformancePlan(
  entryPoint: LoginPerformanceEntryPoint,
  includeProfileBackground: boolean,
  profileHasAvatar: boolean,
): LoginPerformancePlan {
  const entryRequestId = entryPoint === "interactive-login"
    ? "auth.sign-in"
    : "auth.initial-session";
  const operations: LoginPerformanceOperation[] = [
    operation(
      entryRequestId,
      entryPoint === "interactive-login" ? "Login: signInWithPassword" : "Bootstrap: getSession",
      "request",
      "critical",
      [],
    ),
    operation("cycles.active.auth", "Ciclo activo: getUser", "request", "critical", [entryRequestId]),
    operation("cycles.active.read", "Ciclo activo: leer", "request", "critical", ["cycles.active.auth"]),
    operation("scoped.plan.auth", "Plan: getUser", "request", "critical", ["cycles.active.read"]),
    // @supabase/auth-js serializa ambos getUser bajo su lock. El segundo auth
    // comparte onda con las queries que libera el primero, pero no con el primero.
    operation("scoped.sessions.auth", "Sesiones: getUser serializado", "request", "critical", ["scoped.plan.auth"]),
    operation("scoped.plan.routines", "Plan: routines", "request", "critical", ["scoped.plan.auth"]),
    operation("scoped.plan.days", "Plan: days", "request", "critical", ["scoped.plan.auth"]),
    operation("scoped.plan.exercises", "Plan: exercises", "request", "critical", ["scoped.plan.auth"]),
    operation("scoped.sessions.read", "Sesiones: sessions", "request", "critical", ["scoped.sessions.auth"]),
    operation("scoped.entries.read", "Sesiones: entries + ejercicio histórico", "request", "critical", ["scoped.sessions.auth"]),
    operation("canonical.optimized-scoped-ready", "Canon scoped productivo completo", "milestone", "critical", [
      "cycles.active.read",
      "scoped.plan.routines",
      "scoped.plan.days",
      "scoped.plan.exercises",
      "scoped.sessions.read",
      "scoped.entries.read",
    ]),
    operation("ui.dashboard", "Dashboard publicado", "milestone", "critical", [
      "canonical.optimized-scoped-ready",
    ]),
  ];
  if (includeProfileBackground) {
    appendProfileBackground(operations, profileHasAvatar, "canonical.optimized-scoped-ready");
  }
  return {
    name: `${entryPoint}:optimized-scoped-with-sessions`,
    operations,
    entryRequestId,
    canonicalMilestoneId: "canonical.optimized-scoped-ready",
    dashboardMilestoneId: "ui.dashboard",
    requiredParallelGroups: OPTIMIZED_SCOPED_REQUIRED_PARALLEL_GROUPS,
  };
}

export function createLoginPerformancePlan({
  dataScenario,
  entryPoint = "interactive-login",
  includeProfileBackground = true,
  profileHasAvatar = true,
}: LoginPerformanceScenarioInput): LoginPerformancePlan {
  if (dataScenario === "optimized-scoped-with-sessions") {
    return createOptimizedScopedLoginPerformancePlan(
      entryPoint,
      includeProfileBackground,
      profileHasAvatar,
    );
  }
  const entryRequestId = entryPoint === "interactive-login"
    ? "auth.sign-in"
    : "auth.initial-session";
  const operations: LoginPerformanceOperation[] = [
    operation(
      entryRequestId,
      entryPoint === "interactive-login" ? "Login: signInWithPassword" : "Bootstrap: getSession",
      "request",
      "critical",
      [],
    ),
    operation("legacy.auth", "Legacy: validar usuario", "request", "critical", [entryRequestId]),
    operation("legacy.ensure-profile", "Legacy: asegurar perfil", "request", "critical", ["legacy.auth"]),
    operation("legacy.exercises", "Legacy: leer ejercicios", "request", "critical", ["legacy.ensure-profile"]),
    operation("legacy.lineages", "Legacy: hidratar lineages", "request", "critical", ["legacy.exercises"]),
    operation("legacy.sessions", "Legacy: leer sesiones con entries", "request", "critical", ["legacy.lineages"]),
  ];

  const requiredParallelGroups: string[][] = [];
  let canonicalMilestoneId = "canonical.legacy-ready";

  if (dataScenario === "legacy") {
    operations.push(operation(
      canonicalMilestoneId,
      "Canon legacy completo",
      "milestone",
      "critical",
      ["legacy.sessions"],
    ));
  } else {
    operations.push(
      operation("cycles.active.auth", "Ciclos: validar usuario activo", "request", "critical", [entryRequestId]),
      operation("cycles.history.auth", "Ciclos: validar usuario histórico", "request", "critical", [entryRequestId]),
      operation("cycles.active.read", "Ciclos: leer activo", "request", "critical", ["cycles.active.auth"]),
      operation("cycles.history.read", "Ciclos: leer historial", "request", "critical", ["cycles.history.auth"]),
      operation("cycles.resolved", "Ciclo activo e historial resueltos", "milestone", "critical", [
        "cycles.active.read",
        "cycles.history.read",
      ]),
    );
    requiredParallelGroups.push(
      ["cycles.active.auth", "cycles.history.auth"],
      ["cycles.active.read", "cycles.history.read"],
    );

    if (dataScenario === "active-cycle-legacy") {
      operations.push(operation(
        canonicalMilestoneId,
        "Ciclo no scoped autoriza canon legacy",
        "milestone",
        "critical",
        ["legacy.sessions", "cycles.resolved"],
      ));
    } else {
      operations.push(
        operation("scoped.plan.auth", "Scoped plan: validar usuario", "request", "critical", ["cycles.resolved"]),
        operation("scoped.plan.routines", "Scoped plan: leer routines", "request", "critical", ["scoped.plan.auth"]),
        operation("scoped.plan.days", "Scoped plan: leer days", "request", "critical", ["scoped.plan.routines"]),
        operation("scoped.plan.exercises", "Scoped plan: leer exercises", "request", "critical", ["scoped.plan.days"]),
        operation("scoped.sessions.auth", "Scoped sessions: validar usuario", "request", "critical", ["scoped.plan.exercises"]),
        operation("scoped.sessions.read", "Scoped sessions: leer sesiones", "request", "critical", ["scoped.sessions.auth"]),
      );
      let scopedDataDependency = "scoped.sessions.read";
      if (dataScenario === "scoped-with-sessions") {
        scopedDataDependency = "scoped.entries.read";
        operations.push(operation(
          scopedDataDependency,
          "Scoped sessions: leer entries",
          "request",
          "critical",
          ["scoped.sessions.read"],
        ));
      }
      canonicalMilestoneId = "canonical.scoped-ready";
      operations.push(operation(
        canonicalMilestoneId,
        "Canon scoped completo",
        "milestone",
        "critical",
        ["legacy.sessions", "scoped.plan.exercises", scopedDataDependency],
      ));
    }
  }

  const dashboardMilestoneId = "ui.dashboard";
  operations.push(operation(
    dashboardMilestoneId,
    "Dashboard publicado",
    "milestone",
    "critical",
    [canonicalMilestoneId],
  ));

  if (includeProfileBackground) appendProfileBackground(operations, profileHasAvatar);

  return {
    name: `${entryPoint}:${dataScenario}`,
    operations,
    entryRequestId,
    canonicalMilestoneId,
    dashboardMilestoneId,
    requiredParallelGroups,
  };
}

function indexOperations(plan: LoginPerformancePlan) {
  const byId = new Map<string, LoginPerformanceOperation>();
  for (const item of plan.operations) {
    if (byId.has(item.id)) throw new Error(`Duplicate performance operation: ${item.id}`);
    byId.set(item.id, item);
  }
  for (const item of plan.operations) {
    for (const dependency of item.dependsOn) {
      if (!byId.has(dependency)) {
        throw new Error(`Unknown dependency ${dependency} for ${item.id}`);
      }
    }
  }
  return byId;
}

function resolveOperationWaves(plan: LoginPerformancePlan) {
  const byId = indexOperations(plan);
  const waves = new Map<string, number>();
  const visiting = new Set<string>();

  function visit(id: string): number {
    const cached = waves.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) throw new Error(`Cyclic performance dependency at ${id}`);
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown performance operation: ${id}`);
    visiting.add(id);
    const dependencyWave = item.dependsOn.reduce(
      (maximum, dependency) => Math.max(maximum, visit(dependency)),
      0,
    );
    visiting.delete(id);
    const wave = dependencyWave + (item.kind === "request" ? 1 : 0);
    waves.set(id, wave);
    return wave;
  }

  for (const item of plan.operations) visit(item.id);
  return waves;
}

function measureClassWaves(
  plan: LoginPerformancePlan,
  workClass: LoginPerformanceWorkClass,
  includedOperationIds?: ReadonlySet<string>,
) {
  const byId = indexOperations(plan);
  const depths = new Map<string, number>();

  function visit(id: string): number {
    if (includedOperationIds && !includedOperationIds.has(id)) return 0;
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const item = byId.get(id);
    if (!item) return 0;
    const dependencyDepth = item.dependsOn.reduce(
      (maximum, dependency) => Math.max(maximum, visit(dependency)),
      0,
    );
    const depth = dependencyDepth + (
      item.kind === "request" && item.workClass === workClass ? 1 : 0
    );
    depths.set(id, depth);
    return depth;
  }

  return plan.operations.reduce((maximum, item) => (
    includedOperationIds && !includedOperationIds.has(item.id)
      ? maximum
      : Math.max(maximum, visit(item.id))
  ), 0);
}

function collectAncestorOperationIds(
  plan: LoginPerformancePlan,
  descendantId: string,
) {
  const byId = indexOperations(plan);
  const ancestors = new Set<string>();

  function visit(id: string) {
    if (ancestors.has(id)) return;
    const item = byId.get(id);
    if (!item) throw new Error(`Unknown performance operation: ${id}`);
    ancestors.add(id);
    for (const dependency of item.dependsOn) visit(dependency);
  }

  visit(descendantId);
  return ancestors;
}

export function measureLoginPerformancePlan(
  plan: LoginPerformancePlan,
): LoginPerformanceMeasurement {
  const operationWaveMap = resolveOperationWaves(plan);
  const operationWaves = Object.fromEntries(operationWaveMap);
  const dashboardAncestorIds = collectAncestorOperationIds(plan, plan.dashboardMilestoneId);
  const requestOperations = plan.operations.filter((item) => item.kind === "request");
  const criticalRequests = requestOperations.filter((item) => (
    item.workClass === "critical" && dashboardAncestorIds.has(item.id)
  ));
  const backgroundRequests = requestOperations.filter((item) => item.workClass === "background");
  const completionWave = requestOperations.reduce(
    (maximum, item) => Math.max(maximum, operationWaveMap.get(item.id) ?? 0),
    0,
  );
  const waves: LoginPerformanceWave[] = [];
  for (let wave = 1; wave <= completionWave; wave += 1) {
    const atWave = requestOperations.filter((item) => operationWaveMap.get(item.id) === wave);
    if (atWave.length === 0) continue;
    waves.push({
      wave,
      critical: atWave.filter((item) => (
        item.workClass === "critical" && dashboardAncestorIds.has(item.id)
      )).map((item) => item.id),
      background: atWave.filter((item) => item.workClass === "background").map((item) => item.id),
    });
  }

  const critical = {
    requests: criticalRequests.length,
    waves: measureClassWaves(plan, "critical", dashboardAncestorIds),
  };
  const background = {
    requests: backgroundRequests.length,
    waves: measureClassWaves(plan, "background"),
  };

  return {
    critical,
    background,
    total: {
      requests: requestOperations.length,
      waves: completionWave,
    },
    dashboardWave: operationWaveMap.get(plan.dashboardMilestoneId) ?? 0,
    completionWave,
    withinBudget:
      critical.requests <= LOGIN_TO_DASHBOARD_BUDGET.requests &&
      critical.waves <= LOGIN_TO_DASHBOARD_BUDGET.waves,
    waves,
    operationWaves,
  };
}

function isAncestor(
  plan: LoginPerformancePlan,
  ancestorId: string,
  descendantId: string,
) {
  const byId = indexOperations(plan);
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (id === ancestorId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const item = byId.get(id);
    return Boolean(item?.dependsOn.some(visit));
  }

  return visit(descendantId);
}

export function auditLoginPerformancePlan(
  plan: LoginPerformancePlan,
  contract: LoginPerformanceAuditContract,
): readonly LoginPerformanceViolation[] {
  const measurement = measureLoginPerformancePlan(plan);
  const violations: LoginPerformanceViolation[] = [];

  if (measurement.critical.requests !== contract.expectedCritical.requests) {
    violations.push({
      code: "REQUEST_COUNT_CHANGED",
      detail: `Expected ${contract.expectedCritical.requests}, measured ${measurement.critical.requests}`,
    });
  }
  if (measurement.critical.waves !== contract.expectedCritical.waves) {
    violations.push({
      code: "WAVE_COUNT_CHANGED",
      detail: `Expected ${contract.expectedCritical.waves}, measured ${measurement.critical.waves}`,
    });
  }
  const missingCanonicalDependencies = contract.requiredCanonicalDependencyIds.filter(
    (dependencyId) => !isAncestor(plan, dependencyId, contract.canonicalMilestoneId),
  );
  if (
    !isAncestor(plan, contract.canonicalMilestoneId, contract.dashboardMilestoneId) ||
    missingCanonicalDependencies.length > 0
  ) {
    violations.push({
      code: "DASHBOARD_BEFORE_CANON",
      detail: missingCanonicalDependencies.length > 0
        ? `${contract.canonicalMilestoneId} is missing required dependencies: ${missingCanonicalDependencies.join(", ")}`
        : `${contract.dashboardMilestoneId} does not depend on ${contract.canonicalMilestoneId}`,
    });
  }

  const backgroundBlocker = plan.operations.find((item) => (
    item.kind === "request" &&
    item.workClass === "background" &&
    isAncestor(plan, item.id, contract.dashboardMilestoneId)
  ));
  if (backgroundBlocker) {
    violations.push({
      code: "BACKGROUND_BLOCKS_DASHBOARD",
      detail: `${backgroundBlocker.id} is an ancestor of Dashboard`,
    });
  }

  for (const group of contract.requiredParallelGroups) {
    const groupWaves = group.map((id) => measurement.operationWaves[id]);
    const sameWave = groupWaves.every((wave) => wave !== undefined && wave === groupWaves[0]);
    const hasSequentialDependency = group.some((id, index) => (
      group.some((otherId, otherIndex) => index !== otherIndex && isAncestor(plan, otherId, id))
    ));
    if (!sameWave || hasSequentialDependency) {
      violations.push({
        code: "REQUIRED_PARALLEL_GROUP_BROKEN",
        detail: `${group.join(", ")} are no longer parallel`,
      });
    }
  }

  return violations;
}

export function createCurrentScopedAuditContract(
): LoginPerformanceAuditContract {
  return {
    expectedCritical: CURRENT_SCOPED_LOGIN_BASELINE,
    canonicalMilestoneId: "canonical.scoped-ready",
    dashboardMilestoneId: "ui.dashboard",
    requiredCanonicalDependencyIds: CURRENT_SCOPED_REQUIRED_CANONICAL_DEPENDENCY_IDS,
    requiredParallelGroups: CURRENT_SCOPED_REQUIRED_PARALLEL_GROUPS,
  };
}

export function createOptimizedScopedAuditContract(
): LoginPerformanceAuditContract {
  return {
    expectedCritical: OPTIMIZED_SCOPED_LOGIN_TARGET,
    canonicalMilestoneId: "canonical.optimized-scoped-ready",
    dashboardMilestoneId: "ui.dashboard",
    requiredCanonicalDependencyIds: OPTIMIZED_SCOPED_REQUIRED_CANONICAL_DEPENDENCY_IDS,
    requiredParallelGroups: OPTIMIZED_SCOPED_REQUIRED_PARALLEL_GROUPS,
  };
}

export type LoginSessionTrigger =
  | "handler"
  | "SIGNED_IN"
  | "INITIAL_SESSION"
  | "bootstrap";

export interface LoginPerformanceRunToken {
  readonly runId: number;
  readonly generation: number;
  readonly identity: string;
}

export interface LoginPerformanceRunSnapshot extends LoginPerformanceRunToken {
  readonly triggers: readonly LoginSessionTrigger[];
  readonly refreshes: number;
  readonly dashboardPublications: number;
}

export type DashboardPublicationResult =
  | "published"
  | "already-published"
  | "stale"
  | "canon-incomplete";

export interface LoginSessionPerformanceHarness {
  observe(identity: string, trigger: LoginSessionTrigger): LoginPerformanceRunToken;
  signedOut(): void;
  publishDashboard(
    token: LoginPerformanceRunToken,
    plan: LoginPerformancePlan,
    completedOperationIds: ReadonlySet<string>,
  ): DashboardPublicationResult;
  getRun(token: LoginPerformanceRunToken): LoginPerformanceRunSnapshot | null;
}

interface MutableLoginPerformanceRun {
  readonly token: LoginPerformanceRunToken;
  readonly triggers: LoginSessionTrigger[];
  dashboardPublications: number;
}

export function createLoginSessionPerformanceHarness(): LoginSessionPerformanceHarness {
  let generation = 0;
  let nextRunId = 1;
  let current: MutableLoginPerformanceRun | null = null;
  const runs = new Map<number, MutableLoginPerformanceRun>();

  function isCurrent(token: LoginPerformanceRunToken) {
    return Boolean(
      current &&
      current.token.runId === token.runId &&
      current.token.generation === token.generation &&
      current.token.identity === token.identity &&
      generation === token.generation,
    );
  }

  return {
    observe(identity, trigger) {
      if (current && current.token.identity === identity && current.token.generation === generation) {
        if (!current.triggers.includes(trigger)) current.triggers.push(trigger);
        return current.token;
      }
      if (current) generation += 1;
      const token = { runId: nextRunId, generation, identity };
      nextRunId += 1;
      current = { token, triggers: [trigger], dashboardPublications: 0 };
      runs.set(token.runId, current);
      return token;
    },

    signedOut() {
      generation += 1;
      current = null;
    },

    publishDashboard(token, plan, completedOperationIds) {
      if (!isCurrent(token) || !current) return "stale";
      const byId = indexOperations(plan);
      const requiredRequests = new Set<string>();
      function collectRequiredRequests(id: string) {
        const item = byId.get(id);
        if (!item) return;
        if (item.kind === "request") requiredRequests.add(item.id);
        for (const dependency of item.dependsOn) collectRequiredRequests(dependency);
      }
      collectRequiredRequests(plan.dashboardMilestoneId);
      if ([...requiredRequests].some((id) => !completedOperationIds.has(id))) {
        return "canon-incomplete";
      }
      if (current.dashboardPublications > 0) return "already-published";
      current.dashboardPublications += 1;
      return "published";
    },

    getRun(token) {
      const run = runs.get(token.runId);
      if (!run) return null;
      return {
        ...run.token,
        triggers: [...run.triggers],
        refreshes: 1,
        dashboardPublications: run.dashboardPublications,
      };
    },
  };
}
