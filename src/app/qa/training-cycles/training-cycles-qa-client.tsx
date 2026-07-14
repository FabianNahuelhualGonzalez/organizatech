"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  cancelTrainingCycle,
  completeTrainingCycle,
  createTrainingCycle,
  getActiveTrainingCycle,
  getTrainingCycleHistory,
  TrainingCycleRepositoryError,
  type TrainingCycle,
} from "@/lib/training/training-cycles-repository";

import {
  canMutateQaCycle,
  canRunQaAction,
  getQaActionErrorMessage,
  releaseQaMutationLock,
  rememberCreatedQaCycle,
  tryAcquireQaMutationLock,
  type QaActionKind,
  type QaAuthStatus,
} from "./training-cycles-qa-policy";

export function TrainingCyclesQaClient() {
  const [activeCycle, setActiveCycle] = useState<TrainingCycle | null>(null);
  const [history, setHistory] = useState<TrainingCycle[]>([]);
  const [authStatus, setAuthStatus] = useState<QaAuthStatus>("checking");
  const [createdCycleIds, setCreatedCycleIds] = useState<Set<string>>(() => new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [logs, setLogs] = useState<QaLog[]>([]);
  const mutationLockRef = useRef(false);

  const clearQaSessionState = useCallback(() => {
    setAuthStatus("unauthenticated");
    setActiveCycle(null);
    setHistory([]);
    setCreatedCycleIds(new Set());
    setLogs([]);
    setIsBusy(false);
  }, []);

  const pushLog = useCallback((type: QaLog["type"], action: string, message: string) => {
    setLogs((current) => [
      {
        id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
        type,
        action,
        message,
        at: new Date().toLocaleString(),
      },
      ...current.slice(0, 19),
    ]);
  }, []);

  const loadCycles = useCallback(async () => {
    const [nextActive, nextHistory] = await Promise.all([
      getActiveTrainingCycle(),
      getTrainingCycleHistory(),
    ]);
    setActiveCycle(nextActive);
    setHistory(nextHistory);
  }, []);

  const handleActionFailure = useCallback((action: QaActionKind, error: unknown) => {
    if (isSessionRepositoryError(error)) {
      clearQaSessionState();
      return;
    }
    pushLog("error", actionLabel(action), getQaActionErrorMessage(action));
  }, [clearQaSessionState, pushLog]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      clearQaSessionState();
      return;
    }
    const supabaseClient = supabase;

    let mounted = true;

    async function validateSession() {
      const { data, error } = await supabaseClient.auth.getUser();
      if (!mounted) return;
      if (error || !data.user) {
        clearQaSessionState();
        return;
      }

      setAuthStatus("authenticated");
      try {
        await loadCycles();
      } catch (loadError) {
        if (!mounted) return;
        handleActionFailure("load", loadError);
      }
    }

    const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT" || !session?.user) {
        clearQaSessionState();
        return;
      }

      if (event === "SIGNED_IN") {
        setAuthStatus("authenticated");
        void loadCycles().catch((loadError: unknown) => {
          if (mounted) handleActionFailure("load", loadError);
        });
      }
    });

    void validateSession().catch(() => {
      if (mounted) clearQaSessionState();
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [clearQaSessionState, handleActionFailure, loadCycles]);

  async function runAction(
    action: QaActionKind,
    successMessage: string,
    operation: () => Promise<void>,
  ) {
    if (
      !canRunQaAction(authStatus, isBusy) ||
      mutationLockRef.current ||
      !tryAcquireQaMutationLock(mutationLockRef)
    ) {
      return;
    }

    setIsBusy(true);
    try {
      await operation();
      pushLog("success", actionLabel(action), successMessage);
    } catch (error) {
      handleActionFailure(action, error);
    } finally {
      releaseQaMutationLock(mutationLockRef);
      setIsBusy(false);
    }
  }

  async function handleCreateCycle() {
    const createdCycle = await createTrainingCycle({
      name: `QA ciclo temporal ${new Date().toISOString()}`,
      cycleNumber: getNextQaCycleNumber(activeCycle, history),
      cycleType: "qa",
      goal: "Validacion QA",
      planSnapshot: {
        source: "qa-helper",
        createdBy: "authenticated-user",
      },
    });
    setCreatedCycleIds((current) => rememberCreatedQaCycle(current, createdCycle.id));
    await loadCycles();
  }

  async function handleCompleteCycle() {
    if (!canChangeActiveCycle) return;
    if (!window.confirm("¿Completar el ciclo de prueba creado en esta sesión?")) return;

    await completeTrainingCycle({
      summarySnapshot: {
        source: "qa-helper",
        result: "completed",
        volumeTotal: 0,
        totalReps: 0,
      },
    });
    await loadCycles();
  }

  async function handleCancelCycle() {
    if (!canChangeActiveCycle) return;
    if (!window.confirm("¿Cancelar el ciclo de prueba creado en esta sesión?")) return;

    await cancelTrainingCycle({
      summarySnapshot: {
        source: "qa-helper",
        result: "cancelled",
      },
    });
    await loadCycles();
  }

  if (authStatus === "checking") {
    return <QaMessage title="Validando sesión" body="Espera mientras verificamos el acceso." />;
  }

  if (authStatus === "unauthenticated") {
    return (
      <QaMessage
        title="Sesión requerida"
        body="Inicia sesión para usar esta herramienta de prueba."
        link={{ href: "/", label: "Volver al inicio" }}
      />
    );
  }

  const controlsDisabled = isBusy;
  const canChangeActiveCycle = canMutateQaCycle(
    authStatus,
    isBusy,
    activeCycle?.id,
    createdCycleIds,
  );

  return (
    <main style={styles.shell}>
      <section style={styles.panel}>
        <p style={styles.eyebrow}>Herramienta QA temporal</p>
        <h1 style={styles.title}>Training cycles QA</h1>
        <p style={styles.text}>Valida ciclos de prueba con una sesión autenticada.</p>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.subtitle}>Acciones</h2>
        <div style={styles.actions}>
          <button
            style={styles.button}
            type="button"
            disabled={controlsDisabled}
            onClick={() => void runAction("load", "Ciclos cargados.", loadCycles)}
          >
            Cargar ciclos
          </button>
          <button
            style={styles.button}
            type="button"
            disabled={controlsDisabled || Boolean(activeCycle)}
            onClick={() => void runAction("create", "Ciclo de prueba creado.", handleCreateCycle)}
          >
            Crear ciclo de prueba
          </button>
          {canChangeActiveCycle ? (
            <>
              <button
                style={styles.button}
                type="button"
                disabled={controlsDisabled}
                onClick={() => void runAction("update", "Ciclo de prueba completado.", handleCompleteCycle)}
              >
                Completar ciclo creado aquí
              </button>
              <button
                style={styles.button}
                type="button"
                disabled={controlsDisabled}
                onClick={() => void runAction("update", "Ciclo de prueba cancelado.", handleCancelCycle)}
              >
                Cancelar ciclo creado aquí
              </button>
            </>
          ) : null}
        </div>
        {activeCycle && !createdCycleIds.has(activeCycle.id) ? (
          <p style={styles.notice}>El ciclo activo preexistente se muestra en modo de solo lectura.</p>
        ) : null}
      </section>

      <section style={styles.grid}>
        <div style={styles.panel}>
          <h2 style={styles.subtitle}>Ciclo activo</h2>
          {activeCycle ? <CycleView cycle={activeCycle} /> : <p style={styles.text}>Sin ciclo activo.</p>}
        </div>
        <div style={styles.panel}>
          <h2 style={styles.subtitle}>Historial</h2>
          <p style={styles.text}>Total completados o cancelados: {history.length}</p>
          <div style={styles.list}>
            {history.map((cycle) => <CycleView key={cycle.id} cycle={cycle} />)}
          </div>
        </div>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.subtitle}>Actividad</h2>
        <div style={styles.list}>
          {logs.map((log) => (
            <article key={log.id} style={styles.log}>
              <strong>{log.type === "success" ? "OK" : "ERROR"} - {log.action}</strong>
              <span>{log.message}</span>
              <small>{log.at}</small>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function QaMessage({
  title,
  body,
  link,
}: {
  title: string;
  body: string;
  link?: { href: string; label: string };
}) {
  return (
    <main style={styles.shell}>
      <section style={styles.panel}>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.text}>{body}</p>
        {link ? <a href={link.href}>{link.label}</a> : null}
      </section>
    </main>
  );
}

function CycleView({ cycle }: { cycle: TrainingCycle }) {
  return (
    <article style={styles.cycle}>
      <strong>{cycle.name}</strong>
      <span>Estado: {cycle.status}</span>
      <span>Número: {cycle.cycleNumber}</span>
      <span>Inicio: {formatDate(cycle.startedAt)}</span>
      <span>Término: {cycle.endedAt ? formatDate(cycle.endedAt) : "Pendiente"}</span>
      <span>Plan: {Object.keys(cycle.planSnapshot).length} campos</span>
      <span>Resumen: {cycle.summarySnapshot ? Object.keys(cycle.summarySnapshot).length : 0} campos</span>
    </article>
  );
}

function isSessionRepositoryError(error: unknown): boolean {
  return error instanceof TrainingCycleRepositoryError &&
    (error.code === "session_required" || error.code === "session_expired");
}

function actionLabel(action: QaActionKind): string {
  if (action === "create") return "Crear";
  if (action === "update") return "Actualizar";
  return "Cargar";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getNextQaCycleNumber(activeCycle: TrainingCycle | null, history: TrainingCycle[]) {
  const numbers = [
    activeCycle?.cycleNumber,
    ...history.map((cycle) => cycle.cycleNumber),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return Math.max(0, ...numbers) + 1;
}

interface QaLog {
  id: string;
  type: "success" | "error";
  action: string;
  message: string;
  at: string;
}

const styles = {
  shell: {
    minHeight: "100vh",
    padding: 24,
    background: "#f6f7f9",
    color: "#18202f",
    fontFamily: "Arial, sans-serif",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #d9dee8",
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  },
  eyebrow: {
    margin: "0 0 8px",
    color: "#a16000",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase" as const,
  },
  title: {
    margin: "0 0 8px",
    fontSize: 28,
  },
  subtitle: {
    margin: "0 0 12px",
    fontSize: 20,
  },
  text: {
    margin: "0 0 12px",
    color: "#4a5568",
  },
  notice: {
    margin: "12px 0 0",
    color: "#4a5568",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
  },
  button: {
    border: "1px solid #1f4fd8",
    borderRadius: 6,
    background: "#1f4fd8",
    color: "#ffffff",
    padding: "10px 12px",
    cursor: "pointer",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 16,
  },
  list: {
    display: "grid",
    gap: 10,
  },
  cycle: {
    display: "grid",
    gap: 4,
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: 12,
    background: "#fbfcfe",
  },
  log: {
    display: "grid",
    gap: 4,
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: 12,
  },
} satisfies Record<string, React.CSSProperties>;
