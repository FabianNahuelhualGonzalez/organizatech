"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CoachPublicRpcRuntimeInput } from "@/features/coach-clients/data/coach-public-rpc-runtime";
import { createCoachCommercialRepository } from "../data/coach-commercial-repository";
import type { CoachCommercialCommand } from "../data/coach-commercial-contract";
import type { CoachCommercialPortfolio } from "../model/coach-commercial-portfolio";

type Phase = "loading" | "ready" | "error";
interface Snapshot {
  readonly phase: Phase;
  readonly portfolio: CoachCommercialPortfolio | null;
  readonly issue: string | null;
  readonly busy: boolean;
  readonly uncertain: boolean;
  readonly needsRefresh: boolean;
}

const EMPTY: Snapshot = { phase: "loading", portfolio: null, issue: null, busy: false, uncertain: false, needsRefresh: false };

/** An uncertain RPC result keeps its request id until the server confirms its outcome. */
export function useCoachCommercialPortfolio(connection: CoachPublicRpcRuntimeInput | null) {
  const repository = useMemo(() => connection ? createCoachCommercialRepository(connection) : null, [connection]);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const operation = useRef<CoachCommercialCommand | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const readSequence = useRef(0);

  const reload = useCallback(async (): Promise<boolean> => {
    if (!repository) return false;
    const current = generation.current;
    const sequence = ++readSequence.current;
    try {
      const portfolio = await repository.read();
      if (current === generation.current && sequence === readSequence.current) setSnapshot((prior) => ({
        ...prior, phase: "ready", portfolio, issue: null, needsRefresh: false,
      }));
      return current === generation.current && sequence === readSequence.current;
    } catch {
      if (current === generation.current && sequence === readSequence.current) setSnapshot((prior) => ({
        ...prior, phase: prior.portfolio ? "ready" : "error", needsRefresh: true,
        issue: "No pudimos cargar la información comercial.",
      }));
      return false;
    }
  }, [repository]);

  useEffect(() => {
    generation.current += 1;
    readSequence.current += 1;
    operation.current = null;
    busy.current = false;
    setSnapshot(repository ? EMPTY : { ...EMPTY, phase: "error", issue: "Información comercial no disponible en esta sesión." });
    if (repository) void reload();
    return () => { generation.current += 1; };
  }, [reload, repository]);

  const reconcile = useCallback(async () => {
    const pending = operation.current;
    if (!repository || !pending || busy.current) return;
    const current = generation.current;
    busy.current = true;
    setSnapshot((prior) => ({ ...prior, busy: true }));
    try {
      const receipt = await repository.readOperation(pending.requestId);
      if (current !== generation.current) return;
      if (receipt === null) {
        setSnapshot((prior) => ({ ...prior, busy: false, uncertain: true,
          issue: "La operación aún no figura en el servidor. Vuelve a revisar su estado antes de otra acción." }));
        return;
      }
      operation.current = null;
      await reload();
      if (current !== generation.current) return;
      setSnapshot((prior) => ({ ...prior, busy: false, uncertain: false }));
    } catch {
      if (current === generation.current) setSnapshot((prior) => ({ ...prior, busy: false, uncertain: true,
        issue: "El resultado sigue sin confirmarse. Revisa el estado antes de otra acción." }));
    } finally { if (current === generation.current) busy.current = false; }
  }, [reload, repository]);

  const submit = useCallback(async (command: CoachCommercialCommand) => {
    if (!repository || busy.current || operation.current) return;
    const current = generation.current;
    busy.current = true;
    operation.current = command;
    setSnapshot((prior) => ({ ...prior, busy: true, issue: null }));
    try {
      await repository.write(command);
      if (current !== generation.current) return;
      operation.current = null;
      await reload();
      if (current !== generation.current) return;
      setSnapshot((prior) => ({ ...prior, busy: false, uncertain: false }));
    } catch {
      if (current === generation.current) setSnapshot((prior) => ({ ...prior, busy: false, uncertain: true,
        issue: "No pudimos confirmar el resultado. Revisa el estado antes de intentar de nuevo." }));
    } finally { if (current === generation.current) busy.current = false; }
  }, [reload, repository]);

  return { available: repository !== null, snapshot, reload, submit, reconcile };
}
