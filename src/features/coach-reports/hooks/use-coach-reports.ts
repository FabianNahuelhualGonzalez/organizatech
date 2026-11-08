"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { CoachPublicRpcRuntimeInput } from "@/features/coach-clients/data/coach-public-rpc-runtime";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CoachReportsError,
  createCoachReportsRepository,
  type CoachReportDetail,
  type CoachReportItem,
  type CoachReportSummary,
} from "../data/coach-reports-repository";

export interface CoachReportsState {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly reports: readonly CoachReportSummary[];
  readonly detail: CoachReportDetail | null;
  readonly detailPhase: "idle" | "loading" | "ready" | "error";
  readonly issue: string | null;
}

const EMPTY: CoachReportsState = Object.freeze({
  phase: "idle", reports: Object.freeze([]), detail: null, detailPhase: "idle", issue: null,
});

function message(error: unknown) {
  if (error instanceof CoachReportsError && error.code === "forbidden") {
    return "Este reporte ya no está disponible para tu cuenta.";
  }
  return "No pudimos cargar los reportes. Inténtalo nuevamente.";
}

export function useCoachReports(connection: CoachPublicRpcRuntimeInput | null) {
  const repository = useMemo(() => {
    const client = getSupabaseBrowserClient();
    return connection && client ? createCoachReportsRepository(client) : null;
  }, [connection]);
  const [state, setState] = useState<CoachReportsState>(EMPTY);

  const reload = useCallback(async () => {
    if (!repository || !connection?.isCurrent(connection.expectedIdentity)) {
      setState(EMPTY);
      return;
    }
    setState((current) => ({ ...current, phase: "loading", issue: null }));
    try {
      const reports = await repository.list();
      if (!connection.isCurrent(connection.expectedIdentity)) return;
      setState((current) => ({ ...current, phase: "ready", reports, issue: null }));
    } catch (error) {
      if (!connection.isCurrent(connection.expectedIdentity)) return;
      setState((current) => ({ ...current, phase: "error", issue: message(error) }));
    }
  }, [connection, repository]);

  useEffect(() => { void reload(); }, [reload]);

  const open = useCallback(async (reportId: string) => {
    if (!repository || !connection?.isCurrent(connection.expectedIdentity)) return;
    setState((current) => ({ ...current, detailPhase: "loading", issue: null }));
    try {
      const detail = await repository.open(reportId);
      if (!connection.isCurrent(connection.expectedIdentity)) return;
      setState((current) => ({
        ...current,
        detail,
        detailPhase: "ready",
        reports: current.reports.map((report) => report.id === detail.id
          ? { ...report, reviewedAt: detail.reviewedAt } : report),
      }));
    } catch (error) {
      if (!connection.isCurrent(connection.expectedIdentity)) return;
      setState((current) => ({ ...current, detail: null, detailPhase: "error", issue: message(error) }));
    }
  }, [connection, repository]);

  const close = useCallback(() => setState((current) => ({ ...current, detail: null, detailPhase: "idle" })), []);
  const download = useCallback(async (item: CoachReportItem) => {
    if (!repository || !connection?.isCurrent(connection.expectedIdentity)) throw new CoachReportsError("forbidden");
    const file = await repository.download(item);
    if (!connection.isCurrent(connection.expectedIdentity)) throw new CoachReportsError("forbidden");
    return file;
  }, [connection, repository]);

  return { state, reload, open, close, download };
}
