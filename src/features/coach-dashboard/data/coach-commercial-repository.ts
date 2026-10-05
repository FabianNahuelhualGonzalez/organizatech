import { CoachInvitationsError } from "@/features/coach-clients/data/coach-invitations-contract";
import { withCoachInvitationsDeadline } from "@/features/coach-clients/data/coach-invitations-deadline";
import { captureCoachInvitationsOperation } from "@/features/coach-clients/data/coach-invitations-operation";
import { createPinnedCoachRpcPort, snapshotCoachPublicRpcRuntime,
  type CoachPublicRpcRuntimeInput } from "@/features/coach-clients/data/coach-public-rpc-runtime";
import { paidRpcEnvelope, paidUuid } from "@/features/coach-clients/data/coach-paid-periods-validation";
import { CoachCommercialError, type CoachCommercialCommand, type CoachCommercialErrorCode } from "./coach-commercial-contract";
import { mapCoachCommercialCommand, mapCoachCommercialOverview, mapCoachCommercialPage,
  mapCoachCommercialPortfolio, mapCoachCommercialReceipt } from "./coach-commercial-validation";

function sanitize(error: unknown): CoachCommercialError {
  if (error instanceof CoachCommercialError) return new CoachCommercialError(error.code);
  if (error instanceof CoachInvitationsError) return new CoachCommercialError(error.code as CoachCommercialErrorCode);
  try {
    const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
    const message = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : null;
    if (code === "42501") return new CoachCommercialError("forbidden");
    if (code === "PGRST202") return new CoachCommercialError("migration_pending");
    if (code === "P0002") return new CoachCommercialError("not_found");
    if (code === "55000") return new CoachCommercialError("inactive_relationship");
    if (code === "22023") return new CoachCommercialError(message === "coach_commercial_request_conflict"
      ? "request_conflict" : "invalid_input");
    if (code === "40001") return new CoachCommercialError(message === "coach_commercial_version_conflict"
      ? "version_conflict" : "conflict");
  } catch { /* Hostile error getters never reach UI. */ }
  return new CoachCommercialError("unavailable");
}

/** Isolated three-RPC client. A verified session is pinned for each operation;
 * the server derives Coach ownership and never accepts user IDs from this client.
 */
export function createCoachCommercialRepository(input: CoachPublicRpcRuntimeInput) {
  const configuration = snapshotCoachPublicRpcRuntime(input);
  const timeout = input.timeoutMilliseconds ?? 8_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new CoachCommercialError("invalid_input");

  async function call(name: "read_own_coach_commercial" | "read_own_coach_commercial_overview"
    | "read_own_coach_commercial_page" | "read_own_coach_commercial_operation" | "write_own_coach_commercial",
    args: Readonly<Record<string, string | number | null>>, signal?: AbortSignal): Promise<unknown> {
    try {
      return await withCoachInvitationsDeadline(async (deadlineSignal, assertActive) => {
        const captured = await captureCoachInvitationsOperation({
          principal: input.principal, identity: configuration.identity, isCurrent: input.isCurrent,
          signal: deadlineSignal, createPinnedClient: (accessToken) =>
            createPinnedCoachRpcPort(configuration, accessToken, input.fetch),
        });
        const assertCurrent = () => {
          assertActive();
          if (!captured.isCurrent(configuration.identity)) throw new CoachCommercialError("operation_stale");
        };
        assertCurrent();
        const response = await captured.client.rpc(name, args, { get: false, head: false }).abortSignal(deadlineSignal);
        assertCurrent();
        const envelope = paidRpcEnvelope(response);
        if (envelope.error !== null) throw envelope.error;
        return envelope.data;
      }, timeout, signal);
    } catch (error) { throw sanitize(error); }
  }

  return Object.freeze({
    async read(signal?: AbortSignal) {
      try { return mapCoachCommercialOverview(await call("read_own_coach_commercial_overview", {}, signal)); }
      catch (error) {
        if (!(error instanceof CoachCommercialError) || error.code !== "migration_pending") throw error;
        return mapCoachCommercialPortfolio(await call("read_own_coach_commercial", {}, signal));
      }
    },
    async readPage(kind: "items" | "periods" | "months", cursor: string | null,
      episodeId: string | null = null, signal?: AbortSignal) {
      if (cursor !== null && (typeof cursor !== "string" || cursor.length > 100)) throw new CoachCommercialError("invalid_input");
      const id = episodeId === null ? null : paidUuid(episodeId, "invalid_input");
      if ((kind === "periods") !== (id !== null)) throw new CoachCommercialError("invalid_input");
      const value = await call("read_own_coach_commercial_page", {
        p_kind: kind, p_episode_id: id, p_cursor: cursor, p_limit: 20,
      }, signal);
      if (kind === "items") return { kind, ...mapCoachCommercialPage(value, "items") } as const;
      if (kind === "months") return { kind, ...mapCoachCommercialPage(value, "months") } as const;
      return { kind, ...mapCoachCommercialPage(value, "periods") } as const;
    },
    async readStudent(episodeId: string, signal?: AbortSignal) {
      const id = paidUuid(episodeId, "invalid_input");
      const page = mapCoachCommercialPage(await call("read_own_coach_commercial_page", {
        p_kind: "student", p_episode_id: id, p_cursor: null, p_limit: 1,
      }, signal), "student");
      return page.rows[0];
    },
    async readOperation(requestId: string, signal?: AbortSignal) {
      let id: string;
      try { id = paidUuid(requestId, "invalid_input"); }
      catch { throw new CoachCommercialError("invalid_input"); }
      const value = await call("read_own_coach_commercial_operation", { p_request_id: id }, signal);
      return value === null ? null : mapCoachCommercialReceipt(value, { requestId: id });
    },
    async write(command: CoachCommercialCommand, signal?: AbortSignal) {
      const mapped = mapCoachCommercialCommand(command);
      const value = await call("write_own_coach_commercial", mapped.args, signal);
      return mapCoachCommercialReceipt(value, mapped.command);
    },
  });
}
