import {
  TRAINING_CYCLE_OPERATION_KINDS,
  TRAINING_CYCLE_PORTAL_SCOPES,
  TRAINING_CYCLE_RPC_GOALS,
  TRAINING_CYCLE_RPC_MUSCLES,
  TRAINING_CYCLE_RPC_TECHNIQUES,
  TRAINING_CYCLE_RPC_WEEKDAYS,
  TrainingCycleTransportError,
  type TrainingCycleAcceptedOperation,
  type TrainingCycleCatalogCursor,
  type TrainingCycleCatalogItem,
  type TrainingCycleCatalogPage,
  type TrainingCycleChangeKind,
  type TrainingCycleDraftOrigin,
  type TrainingCycleDraftSnapshot,
  type TrainingCycleDraftState,
  type TrainingCycleExerciseSource,
  type TrainingCycleListCursor,
  type TrainingCycleListItem,
  type TrainingCycleListPage,
  type TrainingCycleLifecycleRefresh,
  type TrainingCycleNotificationCursor,
  type TrainingCycleNotificationEvent,
  type TrainingCycleNotificationItem,
  type TrainingCycleNotificationPage,
  type TrainingCyclePublicStatus,
  type TrainingCycleRpcDayPlan,
  type TrainingCycleRpcDropPlan,
  type TrainingCycleRpcExecution,
  type TrainingCycleRpcExecutionDrop,
  type TrainingCycleRpcExecutionExercise,
  type TrainingCycleRpcExecutionSet,
  type TrainingCycleRpcExercisePlan,
  type TrainingCycleRpcGoal,
  type TrainingCycleRpcPlan,
  type TrainingCycleRpcSetPlan,
  type TrainingCycleRpcSnapshot,
  type TrainingCycleSnapshotDay,
  type TrainingCycleSnapshotDrop,
  type TrainingCycleSnapshotExercise,
  type TrainingCycleSnapshotPlan,
  type TrainingCycleSnapshotSet,
  type TrainingCycleVersionCursor,
  type TrainingCycleVersionItem,
  type TrainingCycleVersionPage,
  type TrainingCycleVersionSnapshot,
} from "./training-cycle-rpc-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const YOUTUBE = /^https:\/\/((www\.|m\.)?youtube\.com\/(watch\?[^\s]*v=[A-Za-z0-9_-]{6,64}[^\s]*|shorts\/[A-Za-z0-9_-]{6,64}[^\s]*|embed\/[A-Za-z0-9_-]{6,64}[^\s]*)|youtu\.be\/[A-Za-z0-9_-]{6,64}[^\s]*)$/;

const DRAFT_ORIGINS = ["manual", "suggested", "duplicate", "renewal"] as const;
const DRAFT_STATES = ["draft", "activated", "discarded"] as const;
const PUBLIC_STATUSES = ["active", "expiring", "closed"] as const;
const CHANGE_KINDS = ["activation", "edit", "extension"] as const;
const NOTIFICATION_EVENTS = ["expires_t3", "expires_t2", "expires_t1", "expires_t0", "closed_t1"] as const;

function invalidResponse(): never {
  throw new TrainingCycleTransportError(
    "invalid_response",
    "El servidor devolvió una respuesta inválida.",
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) invalidResponse();
  if (Object.keys(record).some((key) => !allowed.has(key))) invalidResponse();
}

function array(value: unknown, min: number, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalidResponse();
  return value;
}

function enumeration<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) invalidResponse();
  return value as T[number];
}

function string(value: unknown, min: number, max: number, allowControl = false): string {
  if (
    typeof value !== "string"
    || value.length < min
    || value.length > max
    || (!allowControl && CONTROL.test(value))
  ) invalidResponse();
  return value;
}

function nullableString(value: unknown, max: number): string | null {
  if (value === null) return null;
  return string(value, 1, max);
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalidResponse();
  return value;
}

function nullableUuid(value: unknown): string | null {
  return value === null ? null : uuid(value);
}

function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalidResponse();
  return value as number;
}

function finiteDecimal(value: unknown, min: number, max: number, scale = 2): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalidResponse();
  const scaled = value * 10 ** scale;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-7) invalidResponse();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalidResponse();
  return value;
}

function isoDate(value: unknown): string {
  const result = string(value, 10, 10);
  if (!DATE.test(result)) invalidResponse();
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) invalidResponse();
  return result;
}

function isoInstant(value: unknown): string {
  const result = string(value, 20, 40);
  if (!Number.isFinite(Date.parse(result)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(result)) invalidResponse();
  return result;
}

function nullableInstant(value: unknown): string | null {
  return value === null ? null : isoInstant(value);
}

function youtubeUrl(value: unknown): string {
  const result = string(value, 19, 500);
  if (/\s/.test(result) || !YOUTUBE.test(result)) invalidResponse();
  return result;
}

function assertJsonSize(value: unknown) {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string" || serialized.length > 262_144) invalidResponse();
  } catch {
    invalidResponse();
  }
}

function uniqueNumbers(values: readonly number[]) {
  if (new Set(values).size !== values.length) invalidResponse();
}

function uniqueStrings(values: readonly string[]) {
  if (new Set(values).size !== values.length) invalidResponse();
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseAcceptedOperation(value: unknown): TrainingCycleAcceptedOperation {
  const record = object(value);
  exactKeys(record, ["responseKind", "requestId", "operationKind", "aggregateId", "resultVersion"]);
  if (record.responseKind !== "accepted_operation") invalidResponse();
  return {
    responseKind: "accepted_operation",
    requestId: uuid(record.requestId),
    operationKind: enumeration(record.operationKind, TRAINING_CYCLE_OPERATION_KINDS),
    aggregateId: uuid(record.aggregateId),
    resultVersion: record.resultVersion === null ? null : integer(record.resultVersion, 1, 256),
  };
}

function parseSource(record: Record<string, unknown>): TrainingCycleExerciseSource {
  const catalog = record.catalogExerciseId;
  const custom = record.customExerciseId;
  if ((catalog === undefined || catalog === null) === (custom === undefined || custom === null)) invalidResponse();
  return catalog !== undefined && catalog !== null
    ? { kind: "catalog", id: uuid(catalog) }
    : { kind: "custom", id: uuid(custom) };
}

interface PlanCounters {
  exercises: number;
  sets: number;
  drops: number;
}

function parseDropPlan(value: unknown, counters: PlanCounters): TrainingCycleRpcDropPlan {
  const record = object(value);
  exactKeys(record, ["order", "kg", "reps"]);
  counters.drops += 1;
  if (counters.drops > 4_000) invalidResponse();
  return {
    order: integer(record.order, 0, 7),
    kg: finiteDecimal(record.kg, 0, 99_999.99),
    reps: integer(record.reps, 1, 1_000),
  };
}

function parseSetPlan(value: unknown, counters: PlanCounters): TrainingCycleRpcSetPlan {
  const record = object(value);
  exactKeys(record, ["order", "targetReps", "targetKg", "toFailure", "drops"]);
  counters.sets += 1;
  if (counters.sets > 2_000) invalidResponse();
  const drops = array(record.drops, 0, 8).map((candidate) => parseDropPlan(candidate, counters));
  uniqueNumbers(drops.map((drop) => drop.order));
  return {
    order: integer(record.order, 0, 19),
    targetReps: integer(record.targetReps, 1, 1_000),
    targetKg: finiteDecimal(record.targetKg, 0, 99_999.99),
    toFailure: bool(record.toFailure),
    drops,
  };
}

function parseExercisePlan(value: unknown, counters: PlanCounters): TrainingCycleRpcExercisePlan {
  const record = object(value);
  exactKeys(
    record,
    ["order", "technique", "sets"],
    ["catalogExerciseId", "customExerciseId", "videoUrl"],
  );
  counters.exercises += 1;
  if (counters.exercises > 200) invalidResponse();
  const source = parseSource(record);
  const technique = enumeration(record.technique, TRAINING_CYCLE_RPC_TECHNIQUES);
  const sets = array(record.sets, 1, 20).map((candidate) => parseSetPlan(candidate, counters));
  uniqueNumbers(sets.map((set) => set.order));
  const dropCount = sets.reduce((total, set) => total + set.drops.length, 0);
  if ((technique === "drop_set") !== (dropCount > 0)) invalidResponse();
  const common = {
    order: integer(record.order, 0, 199),
    technique,
    videoUrl: record.videoUrl === undefined || record.videoUrl === null ? null : youtubeUrl(record.videoUrl),
    sets,
  };
  return source.kind === "catalog"
    ? { ...common, catalogExerciseId: source.id }
    : { ...common, customExerciseId: source.id };
}

function parseDayPlan(value: unknown, counters: PlanCounters): TrainingCycleRpcDayPlan {
  const record = object(value);
  exactKeys(record, ["day", "name", "order", "exercises"]);
  const exercises = array(record.exercises, 0, 50).map((candidate) => parseExercisePlan(candidate, counters));
  uniqueNumbers(exercises.map((exercise) => exercise.order));
  return {
    day: enumeration(record.day, TRAINING_CYCLE_RPC_WEEKDAYS),
    name: string(record.name, 0, 120),
    order: integer(record.order, 0, 6),
    exercises,
  };
}

export function parseTrainingCycleRpcPlan(value: unknown): TrainingCycleRpcPlan {
  const record = object(value);
  exactKeys(record, ["days"]);
  assertJsonSize(value);
  const counters: PlanCounters = { exercises: 0, sets: 0, drops: 0 };
  const days = array(record.days, 1, 7).map((candidate) => parseDayPlan(candidate, counters));
  uniqueNumbers(days.map((day) => day.order));
  uniqueStrings(days.map((day) => day.day));
  return { days };
}

export function parseCatalogCursor(value: unknown): TrainingCycleCatalogCursor {
  const record = object(value);
  exactKeys(record, ["afterSourceKind", "afterSortOrder", "afterName", "afterSourceId"]);
  const sourceKind = enumeration(record.afterSourceKind, ["catalog", "custom"] as const);
  const sortOrder = integer(record.afterSortOrder, 0, 32_767);
  if (sourceKind === "custom" && sortOrder !== 0) invalidResponse();
  const afterName = string(record.afterName, 1, 120);
  if (afterName !== afterName.trim().toLowerCase()) invalidResponse();
  return {
    afterSourceKind: sourceKind,
    afterSortOrder: sortOrder,
    afterName,
    afterSourceId: uuid(record.afterSourceId),
  };
}

function parseCatalogItem(value: unknown): TrainingCycleCatalogItem {
  const record = object(value);
  exactKeys(record, ["sourceKind", "sourceId", "name", "muscleGroup", "videoUrl"]);
  const kind = enumeration(record.sourceKind, ["catalog", "custom"] as const);
  return {
    source: { kind, id: uuid(record.sourceId) },
    name: string(record.name, 1, 120),
    muscleGroup: enumeration(record.muscleGroup, TRAINING_CYCLE_RPC_MUSCLES),
    videoUrl: record.videoUrl === null ? null : youtubeUrl(record.videoUrl),
  };
}

export function parseCatalogPage(value: unknown): TrainingCycleCatalogPage {
  const record = object(value);
  exactKeys(record, ["items", "nextCursor"]);
  const items = array(record.items, 0, 100).map(parseCatalogItem);
  uniqueStrings(items.map((item) => `${item.source.kind}:${item.source.id}`));
  return {
    items,
    nextCursor: record.nextCursor === null ? null : parseCatalogCursor(record.nextCursor),
  };
}

export function parseDraftSnapshot(value: unknown): TrainingCycleDraftSnapshot {
  const record = object(value);
  exactKeys(record, [
    "draftId", "origin", "sourceCycleId", "state", "version", "goal", "startDate", "endDate",
    "plan", "activatedCycleId", "createdAt", "updatedAt",
  ]);
  return {
    draftId: uuid(record.draftId),
    origin: enumeration(record.origin, DRAFT_ORIGINS) as TrainingCycleDraftOrigin,
    sourceCycleId: nullableUuid(record.sourceCycleId),
    state: enumeration(record.state, DRAFT_STATES) as TrainingCycleDraftState,
    version: integer(record.version, 1, 256),
    goal: enumeration(record.goal, TRAINING_CYCLE_RPC_GOALS),
    startDate: isoDate(record.startDate),
    endDate: isoDate(record.endDate),
    plan: parseTrainingCycleRpcPlan(record.plan),
    activatedCycleId: nullableUuid(record.activatedCycleId),
    createdAt: isoInstant(record.createdAt),
    updatedAt: isoInstant(record.updatedAt),
  };
}

function parseSnapshotDrop(value: unknown): TrainingCycleSnapshotDrop {
  const record = object(value);
  exactKeys(record, ["snapshotId", "order", "kg", "reps"]);
  return { snapshotId: uuid(record.snapshotId), ...parseDropPlan({ order: record.order, kg: record.kg, reps: record.reps }, { exercises: 0, sets: 0, drops: 0 }) };
}

function parseSnapshotSet(value: unknown): TrainingCycleSnapshotSet {
  const record = object(value);
  exactKeys(record, ["snapshotId", "order", "targetReps", "targetKg", "toFailure", "drops"]);
  const drops = array(record.drops, 0, 8).map(parseSnapshotDrop);
  uniqueNumbers(drops.map((drop) => drop.order));
  return {
    snapshotId: uuid(record.snapshotId),
    order: integer(record.order, 0, 19),
    targetReps: integer(record.targetReps, 1, 1_000),
    targetKg: finiteDecimal(record.targetKg, 0, 99_999.99),
    toFailure: bool(record.toFailure),
    drops,
  };
}

function parseSnapshotExercise(value: unknown): TrainingCycleSnapshotExercise {
  const record = object(value);
  exactKeys(record, [
    "snapshotId", "catalogExerciseId", "customExerciseId", "exerciseLineageId", "name", "muscleGroup",
    "order", "technique", "videoUrl", "legacyCycleExerciseId", "sets",
  ]);
  const source = parseSource(record);
  const sets = array(record.sets, 1, 20).map(parseSnapshotSet);
  uniqueNumbers(sets.map((set) => set.order));
  return {
    snapshotId: uuid(record.snapshotId),
    source,
    exerciseLineageId: uuid(record.exerciseLineageId),
    name: string(record.name, 1, 120),
    muscleGroup: enumeration(record.muscleGroup, TRAINING_CYCLE_RPC_MUSCLES),
    order: integer(record.order, 0, 199),
    technique: enumeration(record.technique, TRAINING_CYCLE_RPC_TECHNIQUES),
    videoUrl: record.videoUrl === null ? null : youtubeUrl(record.videoUrl),
    legacyCycleExerciseId: nullableUuid(record.legacyCycleExerciseId),
    sets,
  };
}

function parseSnapshotDay(value: unknown): TrainingCycleSnapshotDay {
  const record = object(value);
  exactKeys(record, ["snapshotId", "day", "name", "order", "legacyCycleDayId", "exercises"]);
  const exercises = array(record.exercises, 0, 50).map(parseSnapshotExercise);
  uniqueNumbers(exercises.map((exercise) => exercise.order));
  return {
    snapshotId: uuid(record.snapshotId),
    day: enumeration(record.day, TRAINING_CYCLE_RPC_WEEKDAYS),
    name: string(record.name, 0, 120),
    order: integer(record.order, 0, 6),
    legacyCycleDayId: nullableUuid(record.legacyCycleDayId),
    exercises,
  };
}

export function parseSnapshotPlan(value: unknown): TrainingCycleSnapshotPlan {
  const record = object(value);
  exactKeys(record, ["days"]);
  const days = array(record.days, 1, 7).map(parseSnapshotDay);
  uniqueNumbers(days.map((day) => day.order));
  uniqueStrings(days.map((day) => day.day));
  return { days };
}

export function parseCycleSnapshot(value: unknown): TrainingCycleRpcSnapshot {
  const record = object(value);
  exactKeys(record, [
    "cycleId", "portalScope", "cycleNumber", "goal", "startDate", "endDate", "status", "daysUntilEnd",
    "version", "snapshotId", "extensionCount", "sourceDraftId", "sourceCycleId", "closedAt", "closedReason",
    "createdAt", "updatedAt", "plan",
  ]);
  return {
    cycleId: uuid(record.cycleId),
    portalScope: enumeration(record.portalScope, TRAINING_CYCLE_PORTAL_SCOPES),
    cycleNumber: integer(record.cycleNumber, 1, 32_767),
    goal: enumeration(record.goal, TRAINING_CYCLE_RPC_GOALS),
    startDate: isoDate(record.startDate),
    endDate: isoDate(record.endDate),
    status: enumeration(record.status, PUBLIC_STATUSES) as TrainingCyclePublicStatus,
    daysUntilEnd: integer(record.daysUntilEnd, -36_500, 730),
    version: integer(record.version, 1, 256),
    snapshotId: uuid(record.snapshotId),
    extensionCount: integer(record.extensionCount, 0, 32_767),
    sourceDraftId: nullableUuid(record.sourceDraftId),
    sourceCycleId: nullableUuid(record.sourceCycleId),
    closedAt: nullableInstant(record.closedAt),
    closedReason: nullableString(record.closedReason, 120),
    createdAt: isoInstant(record.createdAt),
    updatedAt: isoInstant(record.updatedAt),
    plan: parseSnapshotPlan(record.plan),
  };
}

export function parseLifecycleRefresh(value: unknown): TrainingCycleLifecycleRefresh {
  const record = object(value);
  exactKeys(record, ["closedCycleId", "refreshedAt"]);
  return {
    closedCycleId: nullableUuid(record.closedCycleId),
    refreshedAt: isoInstant(record.refreshedAt),
  };
}

export function parseListCursor(value: unknown): TrainingCycleListCursor {
  const record = object(value);
  exactKeys(record, ["beforeCreatedAt", "beforeId"]);
  return { beforeCreatedAt: isoInstant(record.beforeCreatedAt), beforeId: uuid(record.beforeId) };
}

function parseListItem(value: unknown): TrainingCycleListItem {
  const record = object(value);
  exactKeys(record, [
    "cycleId", "cycleNumber", "goal", "startDate", "endDate", "status", "version", "snapshotId",
    "extensionCount", "closedAt", "updatedAt",
  ]);
  return {
    cycleId: uuid(record.cycleId),
    cycleNumber: integer(record.cycleNumber, 1, 32_767),
    goal: enumeration(record.goal, TRAINING_CYCLE_RPC_GOALS),
    startDate: isoDate(record.startDate),
    endDate: isoDate(record.endDate),
    status: enumeration(record.status, PUBLIC_STATUSES) as TrainingCyclePublicStatus,
    version: integer(record.version, 1, 256),
    snapshotId: uuid(record.snapshotId),
    extensionCount: integer(record.extensionCount, 0, 32_767),
    closedAt: nullableInstant(record.closedAt),
    updatedAt: isoInstant(record.updatedAt),
  };
}

export function parseCycleListPage(value: unknown): TrainingCycleListPage {
  const record = object(value);
  exactKeys(record, ["items", "nextCursor"]);
  const items = array(record.items, 0, 100).map(parseListItem);
  uniqueStrings(items.map((item) => item.cycleId));
  return { items, nextCursor: record.nextCursor === null ? null : parseListCursor(record.nextCursor) };
}

export function parseVersionCursor(value: unknown): TrainingCycleVersionCursor {
  const record = object(value);
  exactKeys(record, ["beforeVersion"]);
  return { beforeVersion: integer(record.beforeVersion, 1, 256) };
}

function parseVersionItem(value: unknown): TrainingCycleVersionItem {
  const record = object(value);
  exactKeys(record, [
    "snapshotId", "version", "changeKind", "goal", "startDate", "endDate", "sourceSnapshotId", "createdAt",
  ]);
  return {
    snapshotId: uuid(record.snapshotId),
    version: integer(record.version, 1, 256),
    changeKind: enumeration(record.changeKind, CHANGE_KINDS) as TrainingCycleChangeKind,
    goal: enumeration(record.goal, TRAINING_CYCLE_RPC_GOALS),
    startDate: isoDate(record.startDate),
    endDate: isoDate(record.endDate),
    sourceSnapshotId: nullableUuid(record.sourceSnapshotId),
    createdAt: isoInstant(record.createdAt),
  };
}

export function parseVersionPage(value: unknown): TrainingCycleVersionPage {
  const record = object(value);
  exactKeys(record, ["items", "nextCursor"]);
  const items = array(record.items, 0, 100).map(parseVersionItem);
  uniqueNumbers(items.map((item) => item.version));
  return { items, nextCursor: record.nextCursor === null ? null : parseVersionCursor(record.nextCursor) };
}

export function parseVersionSnapshot(value: unknown): TrainingCycleVersionSnapshot {
  const record = object(value);
  exactKeys(record, [
    "cycleId", "snapshotId", "version", "changeKind", "goal", "startDate", "endDate", "sourceSnapshotId",
    "createdAt", "plan",
  ]);
  return {
    cycleId: uuid(record.cycleId),
    ...parseVersionItem({
      snapshotId: record.snapshotId,
      version: record.version,
      changeKind: record.changeKind,
      goal: record.goal,
      startDate: record.startDate,
      endDate: record.endDate,
      sourceSnapshotId: record.sourceSnapshotId,
      createdAt: record.createdAt,
    }),
    plan: parseSnapshotPlan(record.plan),
  };
}

export function parseNotificationCursor(value: unknown): TrainingCycleNotificationCursor {
  const record = object(value);
  exactKeys(record, ["beforeMaterializedAt", "beforeId"]);
  return { beforeMaterializedAt: isoInstant(record.beforeMaterializedAt), beforeId: uuid(record.beforeId) };
}

function parseNotificationItem(value: unknown): TrainingCycleNotificationItem {
  const record = object(value);
  exactKeys(record, [
    "notificationId", "cycleId", "eventKind", "scheduledOn", "title", "body", "materializedAt", "readAt",
  ]);
  return {
    notificationId: uuid(record.notificationId),
    cycleId: uuid(record.cycleId),
    eventKind: enumeration(record.eventKind, NOTIFICATION_EVENTS) as TrainingCycleNotificationEvent,
    scheduledOn: isoDate(record.scheduledOn),
    title: string(record.title, 1, 120),
    body: string(record.body, 1, 1_100),
    materializedAt: isoInstant(record.materializedAt),
    readAt: nullableInstant(record.readAt),
  };
}

export function parseNotificationPage(value: unknown): TrainingCycleNotificationPage {
  const record = object(value);
  exactKeys(record, ["items", "nextCursor"]);
  const items = array(record.items, 0, 100).map(parseNotificationItem);
  uniqueStrings(items.map((item) => item.notificationId));
  return {
    items,
    nextCursor: record.nextCursor === null ? null : parseNotificationCursor(record.nextCursor),
  };
}

interface ExecutionCounters {
  sets: number;
  drops: number;
}

function parseExecutionDrop(value: unknown, counters: ExecutionCounters): TrainingCycleRpcExecutionDrop {
  const record = object(value);
  exactKeys(record, ["planDropId", "order", "completed", "reps", "kg"]);
  counters.drops += 1;
  if (counters.drops > 4_000) invalidResponse();
  const completed = bool(record.completed);
  return {
    planDropId: uuid(record.planDropId),
    order: integer(record.order, 0, 7),
    completed,
    reps: completed ? integer(record.reps, 1, 1_000) : record.reps === null ? null : invalidResponse(),
    kg: completed ? finiteDecimal(record.kg, 0, 99_999.99) : record.kg === null ? null : invalidResponse(),
  };
}

function parseExecutionSet(value: unknown, counters: ExecutionCounters): TrainingCycleRpcExecutionSet {
  const record = object(value);
  exactKeys(record, ["planSetId", "order", "completed", "reps", "kg", "reachedFailure", "drops"]);
  counters.sets += 1;
  if (counters.sets > 2_000) invalidResponse();
  const completed = bool(record.completed);
  const reachedFailure = bool(record.reachedFailure);
  if (!completed && reachedFailure) invalidResponse();
  const drops = array(record.drops, 0, 8).map((candidate) => parseExecutionDrop(candidate, counters));
  uniqueStrings(drops.map((drop) => drop.planDropId));
  uniqueNumbers(drops.map((drop) => drop.order));
  if (!completed && drops.some((drop) => drop.completed)) invalidResponse();
  return {
    planSetId: uuid(record.planSetId),
    order: integer(record.order, 0, 19),
    completed,
    reps: completed ? integer(record.reps, 1, 1_000) : record.reps === null ? null : invalidResponse(),
    kg: completed ? finiteDecimal(record.kg, 0, 99_999.99) : record.kg === null ? null : invalidResponse(),
    reachedFailure,
    drops,
  };
}

function parseExecutionExercise(value: unknown, counters: ExecutionCounters): TrainingCycleRpcExecutionExercise {
  const record = object(value);
  exactKeys(record, ["planExerciseId", "order", "sets"]);
  const sets = array(record.sets, 1, 20).map((candidate) => parseExecutionSet(candidate, counters));
  uniqueStrings(sets.map((set) => set.planSetId));
  uniqueNumbers(sets.map((set) => set.order));
  return {
    planExerciseId: uuid(record.planExerciseId),
    order: integer(record.order, 0, 199),
    sets,
  };
}

export function parseRpcExecution(value: unknown): TrainingCycleRpcExecution {
  const record = object(value);
  exactKeys(record, ["dayId", "exercises"]);
  assertJsonSize(value);
  const counters: ExecutionCounters = { sets: 0, drops: 0 };
  const exercises = array(record.exercises, 1, 200).map((candidate) => parseExecutionExercise(candidate, counters));
  uniqueStrings(exercises.map((exercise) => exercise.planExerciseId));
  uniqueNumbers(exercises.map((exercise) => exercise.order));
  return { dayId: uuid(record.dayId), exercises };
}

export function assertResultMatchesOperation(
  result: TrainingCycleAcceptedOperation,
  expected: { readonly requestId: string; readonly operationKind: TrainingCycleAcceptedOperation["operationKind"] },
) {
  if (result.requestId !== expected.requestId || result.operationKind !== expected.operationKind) invalidResponse();
}

export function assertNonAdvancingCursor(
  previous: TrainingCycleCatalogCursor | TrainingCycleListCursor | TrainingCycleVersionCursor | TrainingCycleNotificationCursor | null,
  next: TrainingCycleCatalogCursor | TrainingCycleListCursor | TrainingCycleVersionCursor | TrainingCycleNotificationCursor | null,
) {
  if (previous !== null && next !== null && JSON.stringify(previous) === JSON.stringify(next)) invalidResponse();
}

export function parseGoal(value: unknown): TrainingCycleRpcGoal {
  return enumeration(value, TRAINING_CYCLE_RPC_GOALS);
}

export function parsePortalScope(value: unknown) {
  return enumeration(value, TRAINING_CYCLE_PORTAL_SCOPES);
}

export function parseRpcMuscle(value: unknown) {
  return enumeration(value, TRAINING_CYCLE_RPC_MUSCLES);
}

export function parseDraftCreateOrigin(value: unknown): "manual" | "suggested" {
  return enumeration(value, ["manual", "suggested"] as const);
}
