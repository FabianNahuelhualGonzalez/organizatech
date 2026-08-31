import { createClient, type Session, type User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import {
  assertNonAdvancingCursor,
  assertResultMatchesOperation,
  isUuid,
  parseAcceptedOperation,
  parseCatalogCursor,
  parseCatalogPage,
  parseCycleListPage,
  parseCycleSnapshot,
  parseDraftCreateOrigin,
  parseDraftSnapshot,
  parseGoal,
  parseListCursor,
  parseLifecycleRefresh,
  parseNotificationPage,
  parseNotificationCursor,
  parsePortalScope,
  parseRpcMuscle,
  parseVersionCursor,
  parseVersionPage,
  parseVersionSnapshot,
} from "./training-cycle-rpc-parsers";
import {
  assertRpcPlanActivable,
  isBackendCompatibleYoutubeUrl,
  mapUiExecutionToRpc,
} from "./training-cycle-rpc-mappers";
import {
  TrainingCycleTransportError,
  type TrainingCycleAcceptedOperation,
  type TrainingCycleCatalogCursor,
  type TrainingCycleCatalogPage,
  type TrainingCycleDraftSnapshot,
  type TrainingCycleExerciseSource,
  type TrainingCycleListCursor,
  type TrainingCycleListPage,
  type TrainingCycleLifecycleRefresh,
  type TrainingCycleNotificationCursor,
  type TrainingCycleNotificationPage,
  type TrainingCycleOperationKind,
  type TrainingCyclePortalScope,
  type TrainingCycleRpcGoal,
  type TrainingCycleRpcMuscle,
  type TrainingCycleRpcPlan,
  type TrainingCycleRpcSnapshot,
  type TrainingCycleUiExecution,
  type TrainingCycleVersionCursor,
  type TrainingCycleVersionPage,
  type TrainingCycleVersionSnapshot,
} from "./training-cycle-rpc-types";

type RpcError = { readonly code?: string; readonly message?: string } | null;

export interface TrainingCycleRpcDataClient {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: RpcError }>;
}

export interface TrainingCycleRpcPrincipalClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: RpcError }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: RpcError }>;
  };
}

interface PinnedOperation {
  readonly dataClient: TrainingCycleRpcDataClient;
  readonly verifyExpectedUser: () => Promise<void>;
}

export interface CreateTrainingCycleRpcGatewayInput {
  readonly expectedUserId: string;
  readonly portalScope: TrainingCyclePortalScope;
  readonly isCurrent: () => boolean;
  readonly principal?: TrainingCycleRpcPrincipalClient;
  readonly createPinnedClient?: (accessToken: string) => TrainingCycleRpcDataClient;
  readonly createRequestId?: () => string;
}

export interface CreateTrainingCycleDraftInput {
  readonly origin: "manual" | "suggested";
  readonly goal: TrainingCycleRpcGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly plan: TrainingCycleRpcPlan;
}

export interface SaveTrainingCycleDraftInput {
  readonly draftId: string;
  readonly expectedVersion: number;
  readonly goal: TrainingCycleRpcGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly plan: TrainingCycleRpcPlan;
}

export interface TrainingCycleListInput {
  readonly limit?: number;
  readonly cursor?: TrainingCycleListCursor | null;
}

export interface TrainingCycleNotificationListInput {
  readonly limit?: number;
  readonly cursor?: TrainingCycleNotificationCursor | null;
}

function stale(): never {
  throw new TrainingCycleTransportError("stale_operation", "La operación ya no está vigente.");
}

function assertCurrent(isCurrent: () => boolean) {
  if (!isCurrent()) stale();
}

async function guardedAwait<T>(promise: Promise<T>, isCurrent: () => boolean): Promise<T> {
  assertCurrent(isCurrent);
  const result = await promise;
  assertCurrent(isCurrent);
  return result;
}

function defaultPinnedClient(accessToken: string): TrainingCycleRpcDataClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new TrainingCycleTransportError("service_unavailable", "El servicio no está disponible.");
  }
  return createClient(url, anonKey, {
    accessToken: async () => accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as TrainingCycleRpcDataClient;
}

function defaultRequestId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value || !isUuid(value)) {
    throw new TrainingCycleTransportError("service_unavailable", "No fue posible iniciar la operación.");
  }
  return value;
}

function getDefaultPrincipal(): TrainingCycleRpcPrincipalClient {
  const principal = getSupabaseBrowserClient() as unknown as TrainingCycleRpcPrincipalClient | null;
  if (!principal) throw new TrainingCycleTransportError("session_required", "Inicia sesión para continuar.");
  return principal;
}

async function verifyTokenOwner(input: {
  readonly principal: TrainingCycleRpcPrincipalClient;
  readonly accessToken: string;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
}) {
  const result = await guardedAwait(input.principal.auth.getUser(input.accessToken), input.isCurrent);
  if (result.error || result.data.user?.id !== input.expectedUserId) {
    throw new TrainingCycleTransportError("session_mismatch", "La sesión cambió. Vuelve a intentarlo.");
  }
}

async function verifyCurrentSessionOwner(input: {
  readonly principal: TrainingCycleRpcPrincipalClient;
  readonly accessToken: string;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
}) {
  const result = await guardedAwait(input.principal.auth.getSession(), input.isCurrent);
  if (
    result.error
    || !result.data.session?.access_token
    || result.data.session.user.id !== input.expectedUserId
    || result.data.session.access_token !== input.accessToken
  ) {
    throw new TrainingCycleTransportError("session_mismatch", "La sesión cambió. Vuelve a intentarlo.");
  }
}

export async function captureTrainingCycleRpcOperation(input: {
  readonly principal: TrainingCycleRpcPrincipalClient;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly createPinnedClient?: (accessToken: string) => TrainingCycleRpcDataClient;
}): Promise<PinnedOperation> {
  assertCurrent(input.isCurrent);
  const sessionResult = await guardedAwait(input.principal.auth.getSession(), input.isCurrent);
  const session = sessionResult.data.session;
  if (
    sessionResult.error
    || !session?.access_token
    || session.user.id !== input.expectedUserId
  ) {
    throw new TrainingCycleTransportError("session_mismatch", "La sesión cambió. Vuelve a intentarlo.");
  }
  const accessToken = session.access_token;
  await guardedAwait(verifyTokenOwner({ ...input, accessToken }), input.isCurrent);
  return {
    dataClient: (input.createPinnedClient ?? defaultPinnedClient)(accessToken),
    // El token capturado ya fue validado contra Auth antes de construir el
    // cliente pinned. Después del RPC sólo comprobamos que la sesión visible
    // continúa perteneciendo al mismo owner; repetir GET /user aquí convierte
    // un commit válido en un falso fallo si Auth sufre un error transitorio.
    verifyExpectedUser: () => verifyCurrentSessionOwner({ ...input, accessToken }),
  };
}

function sanitizeRpcError(error: RpcError): TrainingCycleTransportError {
  switch (error?.code) {
    case "40001":
      return new TrainingCycleTransportError("conflict", "El ciclo cambió en otra operación. Recarga antes de continuar.");
    case "42501":
      return new TrainingCycleTransportError("forbidden", "No tienes autorización para realizar esta acción.");
    case "22023":
      return new TrainingCycleTransportError("invalid_input", "Los datos enviados no son válidos.");
    case "P0002":
      return new TrainingCycleTransportError("not_found", "No encontramos el ciclo solicitado.");
    case "54000":
      return new TrainingCycleTransportError("quota_reached", "Alcanzaste el límite permitido para esta operación.");
    case "55000":
      return new TrainingCycleTransportError("invalid_state", "El ciclo ya no permite esta operación.");
    case "PGRST202":
      return new TrainingCycleTransportError("not_supported", "Esta versión del backend aún no está disponible.");
    default:
      return new TrainingCycleTransportError("service_unavailable", "No fue posible completar la operación.");
  }
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TrainingCycleTransportError("invalid_input", "La fecha no es válida.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TrainingCycleTransportError("invalid_input", "La fecha no es válida.");
  }
  return value;
}

function assertDateRange(startDate: string, endDate: string) {
  assertDate(startDate);
  assertDate(endDate);
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  const spanDays = (end - start) / 86_400_000;
  if (spanDays < 1 || spanDays > 730) {
    throw new TrainingCycleTransportError("invalid_input", "El rango de fechas no es válido.");
  }
}

function assertInstant(value: string): string {
  if (value.length > 40 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TrainingCycleTransportError("invalid_input", "La fecha y hora no son válidas.");
  }
  return value;
}

function assertUuid(value: string): string {
  if (!isUuid(value)) throw new TrainingCycleTransportError("invalid_input", "El identificador no es válido.");
  return value;
}

function assertVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) {
    throw new TrainingCycleTransportError("invalid_input", "La revisión no es válida.");
  }
  return value;
}

function parseCallerInput<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof TrainingCycleTransportError && error.code === "invalid_response") {
      throw new TrainingCycleTransportError("invalid_input", "Los datos enviados no son válidos.");
    }
    throw error;
  }
}

function assertLimit(value: number, max = 100): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TrainingCycleTransportError("invalid_input", "El límite de resultados no es válido.");
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TrainingCycleTransportError("invalid_input", "El contenido no es válido.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  throw new TrainingCycleTransportError("invalid_input", "El contenido no es válido.");
}

export class StableTrainingCycleRequestIds {
  private readonly ids = new Map<string, string>();

  constructor(
    private readonly createId: () => string = defaultRequestId,
    private readonly maxEntries = 256,
  ) {}

  get(operationKind: TrainingCycleOperationKind, portalScope: TrainingCyclePortalScope, payload: unknown): string {
    const fingerprint = this.fingerprint(operationKind, portalScope, payload);
    const existing = this.ids.get(fingerprint);
    if (existing) return existing;
    const requestId = assertUuid(this.createId());
    if (this.ids.size >= this.maxEntries) {
      const oldest = this.ids.keys().next().value as string | undefined;
      if (oldest) this.ids.delete(oldest);
    }
    this.ids.set(fingerprint, requestId);
    return requestId;
  }

  acknowledge(
    operationKind: TrainingCycleOperationKind,
    portalScope: TrainingCyclePortalScope,
    payload: unknown,
    requestId: string,
  ) {
    const fingerprint = this.fingerprint(operationKind, portalScope, payload);
    if (this.ids.get(fingerprint) === requestId) this.ids.delete(fingerprint);
  }

  private fingerprint(
    operationKind: TrainingCycleOperationKind,
    portalScope: TrainingCyclePortalScope,
    payload: unknown,
  ) {
    return stableJson({ operationKind, portalScope, payload });
  }
}

function isDefinitiveMutationFailure(error: unknown) {
  if (!(error instanceof TrainingCycleTransportError)) return false;
  return [
    "invalid_input",
    "incomplete_plan",
    "session_required",
    "conflict",
    "forbidden",
    "not_found",
    "quota_reached",
    "invalid_state",
    "not_supported",
  ].includes(error.code);
}

class MutationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class TrainingCycleRpcGateway {
  private readonly principal: TrainingCycleRpcPrincipalClient;
  private readonly requestIds: StableTrainingCycleRequestIds;
  private readonly mutations = new MutationQueue();

  constructor(private readonly input: CreateTrainingCycleRpcGatewayInput) {
    this.principal = input.principal ?? getDefaultPrincipal();
    this.requestIds = new StableTrainingCycleRequestIds(input.createRequestId ?? defaultRequestId);
    assertUuid(input.expectedUserId);
    parseCallerInput(() => parsePortalScope(input.portalScope));
  }

  private async call(name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const operation = await guardedAwait(captureTrainingCycleRpcOperation({
      principal: this.principal,
      expectedUserId: this.input.expectedUserId,
      isCurrent: this.input.isCurrent,
      createPinnedClient: this.input.createPinnedClient,
    }), this.input.isCurrent);
    await guardedAwait(operation.verifyExpectedUser(), this.input.isCurrent);
    const result = await guardedAwait(operation.dataClient.rpc(name, args), this.input.isCurrent);
    await guardedAwait(operation.verifyExpectedUser(), this.input.isCurrent);
    if (result.error) throw sanitizeRpcError(result.error);
    return result.data;
  }

  private mutate(
    operationKind: TrainingCycleOperationKind,
    name: string,
    payload: Readonly<Record<string, unknown>>,
    args: (requestId: string) => Readonly<Record<string, unknown>>,
    expectedAggregateId?: string,
  ): Promise<TrainingCycleAcceptedOperation> {
    return this.mutations.run(async () => {
      const requestId = this.requestIds.get(operationKind, this.input.portalScope, payload);
      try {
        const result = parseAcceptedOperation(await this.call(name, args(requestId)));
        assertResultMatchesOperation(result, { requestId, operationKind });
        const isUnversioned = operationKind === "custom_exercise_create" || operationKind === "notifications_mark_read";
        if (isUnversioned !== (result.resultVersion === null)) {
          throw new TrainingCycleTransportError("invalid_response", "El servidor devolvió una respuesta inválida.");
        }
        if (operationKind === "notifications_mark_read" && result.aggregateId !== requestId) {
          throw new TrainingCycleTransportError("invalid_response", "El servidor devolvió una respuesta inválida.");
        }
        if (expectedAggregateId && result.aggregateId !== expectedAggregateId) {
          throw new TrainingCycleTransportError("invalid_response", "El servidor devolvió una respuesta inválida.");
        }
        this.requestIds.acknowledge(operationKind, this.input.portalScope, payload, requestId);
        return result;
      } catch (error) {
        if (isDefinitiveMutationFailure(error)) {
          this.requestIds.acknowledge(operationKind, this.input.portalScope, payload, requestId);
        }
        throw error;
      }
    });
  }

  async listCatalog(input: {
    readonly query?: string;
    readonly limit?: number;
    readonly cursor?: TrainingCycleCatalogCursor | null;
  } = {}): Promise<TrainingCycleCatalogPage> {
    const query = input.query?.trim().toLowerCase() ?? "";
    if (query.length > 120 || /[\u0000-\u001f\u007f]/.test(query)) {
      throw new TrainingCycleTransportError("invalid_input", "La búsqueda no es válida.");
    }
    const cursor = input.cursor == null ? null : parseCallerInput(() => parseCatalogCursor(input.cursor));
    const result = parseCatalogPage(await this.call("list_own_training_exercise_catalog", {
      p_portal_scope: this.input.portalScope,
      p_query: query,
      p_limit: assertLimit(input.limit ?? 100),
      p_after_source_kind: cursor?.afterSourceKind ?? null,
      p_after_sort_order: cursor?.afterSortOrder ?? null,
      p_after_name: cursor?.afterName ?? null,
      p_after_source_id: cursor?.afterSourceId ?? null,
    }));
    assertNonAdvancingCursor(cursor, result.nextCursor);
    return result;
  }

  createCustomExercise(input: {
    readonly name: string;
    readonly muscleGroup: TrainingCycleRpcMuscle;
    readonly videoUrl: string | null;
  }): Promise<TrainingCycleExerciseSource> {
    const name = input.name.trim();
    const videoUrl = input.videoUrl?.trim() || null;
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
      return Promise.reject(new TrainingCycleTransportError("invalid_input", "El nombre del ejercicio no es válido."));
    }
    if (!isBackendCompatibleYoutubeUrl(videoUrl)) {
      return Promise.reject(new TrainingCycleTransportError("invalid_input", "El enlace de YouTube no es válido."));
    }
    const muscleGroup = parseCallerInput(() => parseRpcMuscle(input.muscleGroup));
    const payload = { name, muscleGroup, videoUrl };
    return this.mutate("custom_exercise_create", "create_own_training_custom_exercise", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_name: name,
      p_muscle_group: muscleGroup,
      p_video_url: videoUrl,
    })).then((result) => ({ kind: "custom", id: result.aggregateId }));
  }

  createDraft(input: CreateTrainingCycleDraftInput): Promise<TrainingCycleAcceptedOperation> {
    const plan = parseCallerInput(() => assertRpcPlanActivable(input.plan));
    const origin = parseCallerInput(() => parseDraftCreateOrigin(input.origin));
    const goal = parseCallerInput(() => parseGoal(input.goal));
    assertDateRange(input.startDate, input.endDate);
    const payload = {
      origin,
      goal,
      startDate: assertDate(input.startDate),
      endDate: assertDate(input.endDate),
      plan,
    };
    return this.mutate("draft_create", "create_own_training_cycle_draft", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_origin: origin,
      p_goal: goal,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_plan: plan,
    }));
  }

  async getDraft(draftId: string | null = null): Promise<TrainingCycleDraftSnapshot | null> {
    const data = await this.call("get_own_training_cycle_draft", {
      p_portal_scope: this.input.portalScope,
      p_draft_id: draftId === null ? null : assertUuid(draftId),
    });
    return data === null ? null : parseDraftSnapshot(data);
  }

  saveDraft(input: SaveTrainingCycleDraftInput): Promise<TrainingCycleAcceptedOperation> {
    const plan = parseCallerInput(() => assertRpcPlanActivable(input.plan));
    const goal = parseCallerInput(() => parseGoal(input.goal));
    assertDateRange(input.startDate, input.endDate);
    const payload = {
      draftId: assertUuid(input.draftId),
      expectedVersion: assertVersion(input.expectedVersion),
      goal,
      startDate: assertDate(input.startDate),
      endDate: assertDate(input.endDate),
      plan,
    };
    return this.mutate("draft_save", "save_own_training_cycle_draft", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_draft_id: input.draftId,
      p_expected_version: input.expectedVersion,
      p_goal: goal,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_plan: plan,
    }), input.draftId);
  }

  discardDraft(draftId: string, expectedVersion: number): Promise<TrainingCycleAcceptedOperation> {
    const payload = { draftId: assertUuid(draftId), expectedVersion: assertVersion(expectedVersion) };
    return this.mutate("draft_discard", "discard_own_training_cycle_draft", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_draft_id: draftId,
      p_expected_version: expectedVersion,
    }), draftId);
  }

  duplicateCycle(input: {
    readonly sourceCycleId: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly renewal?: boolean;
  }): Promise<TrainingCycleAcceptedOperation> {
    const operationKind = input.renewal ? "draft_renewal" : "draft_duplicate";
    assertDateRange(input.startDate, input.endDate);
    const payload = {
      sourceCycleId: assertUuid(input.sourceCycleId),
      startDate: assertDate(input.startDate),
      endDate: assertDate(input.endDate),
    };
    return this.mutate(
      operationKind,
      input.renewal ? "renew_own_closed_training_cycle_to_draft" : "duplicate_own_training_cycle_to_draft",
      payload,
      (requestId) => ({
        p_request_id: requestId,
        p_portal_scope: this.input.portalScope,
        p_source_cycle_id: input.sourceCycleId,
        p_start_date: input.startDate,
        p_end_date: input.endDate,
      }),
    );
  }

  activateDraft(draftId: string, expectedVersion: number): Promise<TrainingCycleAcceptedOperation> {
    const payload = { draftId: assertUuid(draftId), expectedVersion: assertVersion(expectedVersion) };
    return this.mutate("cycle_activate", "activate_own_training_cycle_draft", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_draft_id: draftId,
      p_expected_version: expectedVersion,
    }));
  }

  editActiveCycle(input: {
    readonly cycleId: string;
    readonly expectedVersion: number;
    readonly goal: TrainingCycleRpcGoal;
    readonly plan: TrainingCycleRpcPlan;
  }): Promise<TrainingCycleAcceptedOperation> {
    const plan = parseCallerInput(() => assertRpcPlanActivable(input.plan));
    const goal = parseCallerInput(() => parseGoal(input.goal));
    const payload = {
      cycleId: assertUuid(input.cycleId),
      expectedVersion: assertVersion(input.expectedVersion),
      goal,
      plan,
    };
    return this.mutate("cycle_edit", "edit_own_active_training_cycle", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_cycle_id: input.cycleId,
      p_expected_version: input.expectedVersion,
      p_goal: goal,
      p_plan: plan,
    }), input.cycleId);
  }

  extendActiveCycle(input: {
    readonly cycleId: string;
    readonly expectedVersion: number;
    readonly newEndDate: string;
  }): Promise<TrainingCycleAcceptedOperation> {
    const payload = {
      cycleId: assertUuid(input.cycleId),
      expectedVersion: assertVersion(input.expectedVersion),
      newEndDate: assertDate(input.newEndDate),
    };
    return this.mutate("cycle_extend", "extend_own_active_training_cycle", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_cycle_id: input.cycleId,
      p_expected_version: input.expectedVersion,
      p_new_end_date: input.newEndDate,
    }), input.cycleId);
  }

  recordExecution(input: {
    readonly cycleId: string;
    readonly expectedVersion: number;
    readonly performedAt: string;
    readonly execution: TrainingCycleUiExecution;
  }): Promise<TrainingCycleAcceptedOperation> {
    const execution = mapUiExecutionToRpc(input.execution);
    const payload = {
      cycleId: assertUuid(input.cycleId),
      expectedVersion: assertVersion(input.expectedVersion),
      performedAt: assertInstant(input.performedAt),
      execution,
    };
    return this.mutate("cycle_execution_record", "record_own_training_cycle_execution", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_cycle_id: input.cycleId,
      p_expected_version: input.expectedVersion,
      p_performed_at: input.performedAt,
      p_execution: execution,
    }));
  }

  async getCycle(cycleId: string): Promise<TrainingCycleRpcSnapshot> {
    return parseCycleSnapshot(await this.call("get_own_training_cycle", {
      p_portal_scope: this.input.portalScope,
      p_cycle_id: assertUuid(cycleId),
    }));
  }

  refreshLifecycle(): Promise<TrainingCycleLifecycleRefresh> {
    return this.mutations.run(async () => parseLifecycleRefresh(await this.call(
      "refresh_own_training_cycle_lifecycle",
      { p_portal_scope: this.input.portalScope },
    )));
  }

  async getActiveCycle(): Promise<TrainingCycleRpcSnapshot | null> {
    const data = await this.call("get_own_active_training_cycle", { p_portal_scope: this.input.portalScope });
    return data === null ? null : parseCycleSnapshot(data);
  }

  async listCycles(input: TrainingCycleListInput = {}): Promise<TrainingCycleListPage> {
    const cursor = input.cursor == null ? null : parseCallerInput(() => parseListCursor(input.cursor));
    const result = parseCycleListPage(await this.call("list_own_training_cycles", {
      p_portal_scope: this.input.portalScope,
      p_limit: assertLimit(input.limit ?? 50),
      p_before_created_at: cursor?.beforeCreatedAt ?? null,
      p_before_id: cursor?.beforeId ?? null,
    }));
    assertNonAdvancingCursor(cursor, result.nextCursor);
    return result;
  }

  async listVersions(input: {
    readonly cycleId: string;
    readonly limit?: number;
    readonly cursor?: TrainingCycleVersionCursor | null;
  }): Promise<TrainingCycleVersionPage> {
    const cursor = input.cursor == null ? null : parseCallerInput(() => parseVersionCursor(input.cursor));
    const result = parseVersionPage(await this.call("list_own_training_cycle_versions", {
      p_portal_scope: this.input.portalScope,
      p_cycle_id: assertUuid(input.cycleId),
      p_limit: assertLimit(input.limit ?? 100),
      p_before_version: cursor?.beforeVersion ?? null,
    }));
    assertNonAdvancingCursor(cursor, result.nextCursor);
    return result;
  }

  async getVersion(cycleId: string, version: number): Promise<TrainingCycleVersionSnapshot> {
    return parseVersionSnapshot(await this.call("get_own_training_cycle_version", {
      p_portal_scope: this.input.portalScope,
      p_cycle_id: assertUuid(cycleId),
      p_version: assertVersion(version),
    }));
  }

  async listNotifications(input: TrainingCycleNotificationListInput = {}): Promise<TrainingCycleNotificationPage> {
    const cursor = input.cursor == null ? null : parseCallerInput(() => parseNotificationCursor(input.cursor));
    const result = parseNotificationPage(await this.call("list_own_training_cycle_notifications", {
      p_portal_scope: this.input.portalScope,
      p_limit: assertLimit(input.limit ?? 50),
      p_before_materialized_at: cursor?.beforeMaterializedAt ?? null,
      p_before_id: cursor?.beforeId ?? null,
    }));
    assertNonAdvancingCursor(cursor, result.nextCursor);
    return result;
  }

  markNotificationsRead(notificationIds: readonly string[]): Promise<TrainingCycleAcceptedOperation> {
    const ids = [...notificationIds].map(assertUuid).sort();
    if (ids.length < 1 || ids.length > 50 || new Set(ids).size !== ids.length) {
      return Promise.reject(new TrainingCycleTransportError("invalid_input", "La selección de notificaciones no es válida."));
    }
    const payload = { notificationIds: ids };
    return this.mutate("notifications_mark_read", "mark_own_training_cycle_notifications_read", payload, (requestId) => ({
      p_request_id: requestId,
      p_portal_scope: this.input.portalScope,
      p_notification_ids: ids,
    }));
  }
}

export function createTrainingCycleRpcGateway(input: CreateTrainingCycleRpcGatewayInput): TrainingCycleRpcGateway {
  return new TrainingCycleRpcGateway(input);
}
