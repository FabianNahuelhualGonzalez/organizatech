"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CoachPublicRpcRuntimeInput } from "@/features/coach-clients/data/coach-public-rpc-runtime";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  CoachReportsError,
  createCoachReportsRepository,
  type CoachReportDetail,
  type CoachReportFilters,
  type CoachReportItem,
  type CoachReportSummary,
} from "../data/coach-reports-repository";

export interface CoachReportsState {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly reports: readonly CoachReportSummary[];
  readonly detail: CoachReportDetail | null;
  readonly previous: CoachReportDetail | null;
  readonly saving: boolean;
  readonly pendingCount: number;
  readonly reviewedCount: number;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly nextOffset: number;
  readonly detailPhase: "idle" | "loading" | "ready" | "error";
  readonly issue: string | null;
}

const EMPTY: CoachReportsState = Object.freeze({
  phase: "idle", reports: Object.freeze([]), detail: null, previous: null,
  saving: false, pendingCount: 0, reviewedCount: 0, hasMore: false,
  loadingMore: false, nextOffset: 0, detailPhase: "idle", issue: null,
});
const DEFAULT_FILTERS: CoachReportFilters = { status: "pending", kind: null, query: "" };

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
  const [filters, setFiltersState] = useState<CoachReportFilters>(DEFAULT_FILTERS);
  const openSequence = useRef(0);
  const listSequence = useRef(0);
  const setFilters = useCallback((next: CoachReportFilters) => {
    if (filters.status === next.status && filters.kind === next.kind && filters.query === next.query) return;
    listSequence.current += 1;
    setState((current) => ({ ...current, phase: "loading", reports: [], hasMore: false,
      loadingMore: false, nextOffset: 0, issue: null }));
    setFiltersState(next);
  }, [filters]);

  const reload = useCallback(async () => {
    const sequence = ++listSequence.current;
    if (!repository || !connection?.isCurrent(connection.expectedIdentity)) {
      setState(EMPTY);
      return;
    }
    setState((current) => ({ ...current, phase: "loading", reports: [], issue: null, hasMore: false, nextOffset: 0 }));
    try {
      const page = await repository.list(filters);
      if (!connection.isCurrent(connection.expectedIdentity) || sequence !== listSequence.current) return;
      setState((current) => ({ ...current, phase: "ready", reports: page.items,
        pendingCount: page.pending, reviewedCount: page.reviewed, hasMore: page.hasMore,
        nextOffset: page.items.length, issue: null }));
    } catch (error) {
      if (!connection.isCurrent(connection.expectedIdentity) || sequence !== listSequence.current) return;
      setState((current) => ({ ...current, phase: "error", issue: message(error) }));
    }
  }, [connection, repository, filters]);

  useEffect(() => { void reload(); }, [reload]);

  const loadMore = useCallback(async () => {
    if (!repository || !connection?.isCurrent(connection.expectedIdentity)
      || state.phase !== "ready" || !state.hasMore || state.loadingMore) return;
    const sequence = listSequence.current;
    const offset = state.nextOffset;
    setState((current) => ({ ...current, loadingMore: true }));
    try {
      const page = await repository.list(filters, offset);
      if (!connection.isCurrent(connection.expectedIdentity) || sequence !== listSequence.current) return;
      setState((current) => ({ ...current, loadingMore: false,
        reports: [...current.reports, ...page.items.filter((item) => !current.reports.some((old) => old.id === item.id))],
        pendingCount: page.pending, reviewedCount: page.reviewed, hasMore: page.hasMore,
        nextOffset: offset + page.items.length }));
    } catch (error) {
      if (!connection.isCurrent(connection.expectedIdentity) || sequence !== listSequence.current) return;
      setState((current) => ({ ...current, loadingMore: false, issue: message(error) }));
    }
  }, [connection, repository, filters, state.phase, state.hasMore, state.loadingMore, state.nextOffset]);

  const open = useCallback(async (reportId: string) => {
    if (!repository || !connection?.isCurrent(connection.expectedIdentity)) return;
    const sequence = ++openSequence.current;
    setState((current) => ({ ...current, detail: null, previous: null, detailPhase: "loading", issue: null }));
    try {
      const detail = await repository.open(reportId);
      if (!connection.isCurrent(connection.expectedIdentity) || sequence !== openSequence.current) return;
      setState((current) => ({
        ...current, detail, detailPhase: "ready",
      }));
      if (detail.kind === "photos" && detail.items.some((item) => item.assetKind === "photo")) {
        try {
          const previous = await repository.previous(reportId);
          if (connection.isCurrent(connection.expectedIdentity) && sequence === openSequence.current) {
            setState((current) => ({ ...current, previous }));
          }
        } catch { /* The current report remains usable when comparison cannot load. */ }
      }
    } catch (error) {
      if (!connection.isCurrent(connection.expectedIdentity) || sequence !== openSequence.current) return;
      setState((current) => ({ ...current, detail: null, detailPhase: "error", issue: message(error) }));
    }
  }, [connection, repository]);

  const close = useCallback(() => {
    openSequence.current += 1;
    setState((current) => ({ ...current, detail: null, previous: null, detailPhase: "idle", issue: null }));
  }, []);
  const review = useCallback(async (reviewed: boolean) => {
    const detailId = state.detail?.id;
    if (!detailId || state.saving || !repository || !connection?.isCurrent(connection.expectedIdentity)) return false;
    setState((current) => ({ ...current, saving: true, issue: null }));
    try {
      const detail = await repository.review(detailId, reviewed);
      if (!connection.isCurrent(connection.expectedIdentity)) return false;
      setState((current) => ({ ...current, saving: false,
        detail: current.detail?.id === detail.id ? detail : current.detail,
        pendingCount: Math.max(0, current.pendingCount + (reviewed ? -1 : 1)),
        reviewedCount: Math.max(0, current.reviewedCount + (reviewed ? 1 : -1)),
        reports: current.reports.map((report) => report.id === detail.id
          ? { ...report, reviewedAt: detail.reviewedAt } : report),
      }));
      return true;
    } catch (error) {
      if (!connection.isCurrent(connection.expectedIdentity)) return false;
      setState((current) => ({ ...current, saving: false, issue: message(error) }));
      return false;
    }
  }, [connection, repository, state.detail?.id, state.saving]);
  const download = useCallback(async (item: CoachReportItem) => {
    if (!repository || !connection?.isCurrent(connection.expectedIdentity)) throw new CoachReportsError("forbidden");
    const file = await repository.download(item);
    if (!connection.isCurrent(connection.expectedIdentity)) throw new CoachReportsError("forbidden");
    return file;
  }, [connection, repository]);

  return { state, filters, setFilters, reload, loadMore, open, close, review, download };
}
