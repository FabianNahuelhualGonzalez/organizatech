import { TrainingCyclesQaClient, type TrainingCyclesQaAccessState } from "./training-cycles-qa-client";

const accessState: TrainingCyclesQaAccessState = {
  vercelEnv: process.env.VERCEL_ENV || "not-set",
  qaToolsEnabled: process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true",
  supabaseEnv: process.env.NEXT_PUBLIC_SUPABASE_ENV || "not-set",
  allowed:
    process.env.VERCEL_ENV === "preview" &&
    process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
    process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa",
};

export default function TrainingCyclesQaPage() {
  if (!accessState.allowed) {
    return (
      <main style={styles.shell}>
        <section style={styles.panel}>
          <p style={styles.eyebrow}>Herramienta QA temporal</p>
          <h1 style={styles.title}>Acceso bloqueado</h1>
          <p style={styles.text}>Esta pagina solo funciona en Vercel Preview con herramientas QA habilitadas.</p>
          <AccessStateView accessState={accessState} />
        </section>
      </main>
    );
  }

  return <TrainingCyclesQaClient accessState={accessState} />;
}

function AccessStateView({ accessState }: { accessState: TrainingCyclesQaAccessState }) {
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
  text: {
    margin: "0 0 12px",
    color: "#4a5568",
  },
  stateGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    margin: "16px 0 0",
  },
} satisfies Record<string, React.CSSProperties>;
