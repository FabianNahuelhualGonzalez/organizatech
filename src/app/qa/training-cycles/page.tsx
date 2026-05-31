"use client";

import { useMemo, useState } from "react";

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

const isQaToolsEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa";

export default function TrainingCyclesQaPage() {
  const [activeCycle, setActiveCycle] = useState<TrainingCycle | null>(null);
  const [history, setHistory] = useState<TrainingCycle[]>([]);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [logs, setLogs] = useState<QaLog[]>([]);

  const accessState = useMemo(() => ({
    vercelEnv: process.env.VERCEL_ENV || "not-set",
    qaToolsEnabled: process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true",
    supabaseEnv: process.env.NEXT_PUBLIC_SUPABASE_ENV || "not-set",
    allowed: isQaToolsEnabled,
  }), []);

  if (!accessState.allowed) {
    return (
      <main style={styles.shell}>
        <section style={styles.panel}>
          <p style={styles.eyebrow}>Herramienta QA temporal</p>
          <h1 style={styles.title}>Acceso bloqueado</h1>
          <p style={styles.text}>Esta pagina solo funciona en QA con herramientas QA habilitadas.</p>
          <AccessStateView accessState={accessState} />
        </section>
      </main>
    );
  }

  async function runAction(label: string, action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await action();
      pushLog("success", label, "OK");
    } catch (error) {
      pushLog("error", label, describeRepositoryError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshCycles() {
    const supabase = getSupabaseBrowserClient();
    const sessionResult = await supabase?.auth.getSession();
    setHasSession(Boolean(sessionResult?.data.session));

    const [nextActive, nextHistory] = await Promise.all([
      getActiveTrainingCycle(),
      getTrainingCycleHistory(),
    ]);

    setActiveCycle(nextActive);
    setHistory(nextHistory);
  }

  async function handleCreateCycle() {
    await createTrainingCycle({
      name: `QA ciclo temporal ${new Date().toISOString()}`,
      cycleNumber: getNextQaCycleNumber(activeCycle, history),
      cycleType: "qa",
      goal: "Validacion QA",
      planSnapshot: {
        source: "qa-helper",
        createdBy: "authenticated-user",
      },
    });
    await refreshCycles();
  }

  async function handleCompleteCycle() {
    await completeTrainingCycle({
      summarySnapshot: {
        source: "qa-helper",
        result: "completed",
        volumeTotal: 0,
        totalReps: 0,
      },
    });
    await refreshCycles();
  }

  async function handleCancelCycle() {
    await cancelTrainingCycle({
      summarySnapshot: {
        source: "qa-helper",
        result: "cancelled",
      },
    });
    await refreshCycles();
  }

  function pushLog(type: QaLog["type"], action: string, message: string) {
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
  }

  return (
    <main style={styles.shell}>
      <section style={styles.panel}>
        <p style={styles.eyebrow}>Herramienta QA temporal - no usar en produccion</p>
        <h1 style={styles.title}>Training cycles QA</h1>
        <p style={styles.text}>
          Valida el repository de ciclos usando la sesion Supabase real del navegador, anon key y RLS.
        </p>
        <AccessStateView accessState={accessState} />
        <p style={styles.session}>Sesion activa: {hasSession === null ? "No validada" : hasSession ? "Si" : "No"}</p>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.subtitle}>Acciones</h2>
        <div style={styles.actions}>
          <button style={styles.button} type="button" disabled={isBusy} onClick={() => runAction("Cargar ciclos", refreshCycles)}>
            Cargar ciclos
          </button>
          <button style={styles.button} type="button" disabled={isBusy} onClick={() => runAction("Crear ciclo QA active", handleCreateCycle)}>
            Crear ciclo QA active
          </button>
          <button style={styles.button} type="button" disabled={isBusy} onClick={() => runAction("Intentar segundo ciclo active", handleCreateCycle)}>
            Intentar segundo ciclo active
          </button>
          <button style={styles.button} type="button" disabled={isBusy} onClick={() => runAction("Completar ciclo active", handleCompleteCycle)}>
            Completar ciclo active
          </button>
          <button style={styles.button} type="button" disabled={isBusy} onClick={() => runAction("Cancelar ciclo active", handleCancelCycle)}>
            Cancelar ciclo active
          </button>
        </div>
      </section>

      <section style={styles.grid}>
        <div style={styles.panel}>
          <h2 style={styles.subtitle}>Ciclo active</h2>
          {activeCycle ? <CycleView cycle={activeCycle} /> : <p style={styles.text}>Sin ciclo active.</p>}
        </div>
        <div style={styles.panel}>
          <h2 style={styles.subtitle}>Historial</h2>
          <p style={styles.text}>Total completed/cancelled: {history.length}</p>
          <div style={styles.list}>
            {history.map((cycle) => <CycleView key={cycle.id} cycle={cycle} />)}
          </div>
        </div>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.subtitle}>Logs sanitizados</h2>
        <div style={styles.list}>
          {logs.map((log) => (
            <article key={log.id} style={styles.log}>
              <strong>{log.type.toUpperCase()} - {log.action}</strong>
              <span>{log.message}</span>
              <small>{log.at}</small>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function AccessStateView({ accessState }: { accessState: { vercelEnv: string; qaToolsEnabled: boolean; supabaseEnv: string; allowed: boolean } }) {
  return (
    <dl style={styles.stateGrid}>
      <div>
        <dt>VERCEL_ENV</dt>
        <dd>{accessState.vercelEnv}</dd>
      </div>
      <div>
        <dt>QA tools</dt>
        <dd>{accessState.qaToolsEnabled ? "enabled" : "disabled"}</dd>
      </div>
      <div>
        <dt>Supabase env</dt>
        <dd>{accessState.supabaseEnv}</dd>
      </div>
      <div>
        <dt>Acceso</dt>
        <dd>{accessState.allowed ? "permitido" : "bloqueado"}</dd>
      </div>
    </dl>
  );
}

function CycleView({ cycle }: { cycle: TrainingCycle }) {
  return (
    <article style={styles.cycle}>
      <strong>{cycle.name}</strong>
      <span>Status: {cycle.status}</span>
      <span>Numero: {cycle.cycleNumber}</span>
      <span>Inicio: {formatDate(cycle.startedAt)}</span>
      <span>Termino: {cycle.endedAt ? formatDate(cycle.endedAt) : "Pendiente"}</span>
      <span>Snapshot plan: {Object.keys(cycle.planSnapshot).length} campos</span>
      <span>Snapshot resumen: {cycle.summarySnapshot ? Object.keys(cycle.summarySnapshot).length : 0} campos</span>
    </article>
  );
}

function describeRepositoryError(error: unknown) {
  if (error instanceof TrainingCycleRepositoryError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return "Error inesperado";
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
  session: {
    margin: "12px 0 0",
    fontWeight: 700,
  },
  stateGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    margin: "16px 0 0",
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
