"use client";

import { Check, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  EvaluationRepositoryError,
  getOwnStudentEvaluation,
  listOwnStudentEvaluations,
  saveOwnEvaluationDraft,
  submitOwnEvaluation,
} from "@/features/evaluations/data/evaluations-repository";
import {
  EVALUATION_CONSENT_COPY,
  createEvaluationId,
  formatEvaluationDate,
  validateEvaluationForSubmit,
  type EvaluationAnswers,
  type EvaluationQuestion,
  type EvaluationTableRow,
  type StudentEvaluationAssignment,
} from "@/features/evaluations/model/evaluation-types";
import type { EvaluationOpenRequest } from "@/features/evaluations/model/evaluation-navigation";
import { AppBackButton } from "@/ui/navigation/app-back-button";

import { StatusBadge } from "./coach-evaluations";
import styles from "./evaluations.module.css";

type StudentTab = "pending" | "expired" | "completed";
type StudentView = "list" | "form" | "success";
type RowEditor = { readonly questionId: string; readonly rowId: string | null; readonly values: Record<string, string> };

export function StudentEvaluations({
  expectedUserId,
  notificationOpenRequest,
  onNotificationOpenRequestConsumed,
  onBack,
}: {
  readonly expectedUserId: string;
  readonly notificationOpenRequest: EvaluationOpenRequest | null;
  readonly onNotificationOpenRequestConsumed: (request: EvaluationOpenRequest) => void;
  readonly onBack: () => void;
}) {
  const [assignments, setAssignments] = useState<readonly StudentEvaluationAssignment[]>([]);
  const [view, setView] = useState<StudentView>("list");
  const [tab, setTab] = useState<StudentTab>("pending");
  const [active, setActive] = useState<StudentEvaluationAssignment | null>(null);
  const [answers, setAnswers] = useState<EvaluationAnswers>({});
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const [editor, setEditor] = useState<RowEditor | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const submitOperationRef = useRef<{ readonly fingerprint: string; readonly requestId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setAssignments(await listOwnStudentEvaluations(expectedUserId)); }
    catch { setLoadError("No pudimos cargar tus evaluaciones"); }
    finally { setLoading(false); }
  }, [expectedUserId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const counts = useMemo(() => ({
    pending: assignments.filter((assignment) => assignment.status === "pending" || assignment.status === "draft").length,
    expired: assignments.filter((assignment) => assignment.status === "expired").length,
    completed: assignments.filter((assignment) => assignment.status === "completed").length,
  }), [assignments]);
  const filtered = assignments.filter((assignment) => tab === "pending"
    ? assignment.status === "pending" || assignment.status === "draft"
    : assignment.status === tab);
  const readOnly = active?.status === "expired" || active?.status === "completed";

  const openAssignment = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const assignment = await getOwnStudentEvaluation(expectedUserId, id);
      setActive(assignment);
      setAnswers(assignment.answers);
      setConsent(assignment.consentConfirmed);
      setErrors(new Set());
      setEditor(null);
      setView("form");
      setAssignments((current) => current.map((item) => item.id === id ? assignment : item));
    } catch {
      setToast("No pudimos abrir la evaluación");
      await load();
    } finally {
      setBusy(false);
    }
  }, [expectedUserId, load]);

  useEffect(() => {
    if (
      loading
      || loadError
      || notificationOpenRequest?.ownerUserId !== expectedUserId
    ) return;

    onNotificationOpenRequestConsumed(notificationOpenRequest);
    if (notificationOpenRequest.assignmentId) {
      void openAssignment(notificationOpenRequest.assignmentId);
    }
  }, [
    expectedUserId,
    loadError,
    loading,
    notificationOpenRequest,
    onNotificationOpenRequestConsumed,
    openAssignment,
  ]);

  async function saveDraft() {
    if (!active || readOnly) return;
    setBusy(true);
    try {
      await saveOwnEvaluationDraft(expectedUserId, {
        assignmentId: active.id, answers, consentConfirmed: consent, requestId: createEvaluationId(),
      });
      await load();
      setView("list");
      setToast("Borrador guardado");
    } catch (caught) {
      if (caught instanceof EvaluationRepositoryError && caught.code === "expired") {
        setToast("El plazo venció mientras respondías. Conservamos el borrador en solo lectura.");
        await openAssignment(active.id);
      } else setToast("No pudimos guardar el borrador");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!active || readOnly) return;
    const nextErrors = validateEvaluationForSubmit(active.snapshot, answers, consent);
    setErrors(nextErrors);
    if (nextErrors.size > 0) return setToast("Completa los campos obligatorios antes de enviar");
    const fingerprint = JSON.stringify({
      assignmentId: active.id,
      answers,
      consentConfirmed: consent,
    });
    if (submitOperationRef.current?.fingerprint !== fingerprint) {
      submitOperationRef.current = { fingerprint, requestId: createEvaluationId() };
    }
    setBusy(true);
    try {
      await submitOwnEvaluation(expectedUserId, {
        assignmentId: active.id,
        answers,
        consentConfirmed: consent,
        requestId: submitOperationRef.current.requestId,
      });
      submitOperationRef.current = null;
      setActive({ ...active, status: "completed", answers, consentConfirmed: consent, completedAt: new Date().toISOString() });
      setView("success");
      await load();
    } catch (caught) {
      if (caught instanceof EvaluationRepositoryError && caught.code === "expired") {
        setToast("El plazo venció. Ya no puedes enviar esta evaluación.");
        await openAssignment(active.id);
      } else if (caught instanceof EvaluationRepositoryError && caught.code === "conflict") {
        setToast("Esta evaluación ya fue enviada y no admite cambios.");
        await openAssignment(active.id);
      } else if (caught instanceof EvaluationRepositoryError && caught.code === "email_pending") {
        setToast("La evaluación fue enviada, pero el correo al coach está pendiente de reintento.");
      } else setToast("No se pudo enviar. Lo escrito permanece en pantalla para reintentar.");
    } finally {
      setBusy(false);
    }
  }

  function saveRow() {
    if (!editor) return;
    const current = answers[editor.questionId];
    const rows = current && typeof current !== "string" ? [...current.rows] : [];
    const nextRow: EvaluationTableRow = { id: editor.rowId ?? createEvaluationId(), values: editor.values };
    const nextRows = editor.rowId ? rows.map((row) => row.id === editor.rowId ? nextRow : row) : [...rows, nextRow];
    setAnswers({ ...answers, [editor.questionId]: { rows: nextRows } });
    setEditor(null);
  }

  function removeRow(questionId: string, rowId: string) {
    const current = answers[questionId];
    if (!current || typeof current === "string") return;
    setAnswers({ ...answers, [questionId]: { rows: current.rows.filter((row) => row.id !== rowId) } });
  }

  function returnToPreviousEvaluationView() {
    if (view === "list") onBack();
    else { setView("list"); setActive(null); setEditor(null); }
  }

  return (
    <section className={styles.screen} aria-labelledby="student-evaluations-title">
      <div><AppBackButton onBack={returnToPreviousEvaluationView} /></div>
      {loading ? <div className={styles.loading} role="status">Cargando tus evaluaciones…</div> : null}
      {!loading && loadError ? <div className={styles.error} role="alert"><div><p>{loadError}</p><button className={styles.button} type="button" onClick={() => void load()}>Reintentar</button></div></div> : null}
      {!loading && !loadError && view === "list" ? (
        <>
          <header className={styles.stack}><h2 id="student-evaluations-title" className={styles.title}>Mis evaluaciones</h2><p className={styles.subtitle}>Responde los formularios de tu coach. Puedes guardar un borrador y continuar después.</p></header>
          <div className={styles.tabs} role="tablist" aria-label="Estados de evaluaciones">
            {(["pending", "expired", "completed"] as StudentTab[]).map((item) => <button className={styles.tab} data-active={tab === item} type="button" role="tab" aria-selected={tab === item} key={item} onClick={() => setTab(item)}>{item === "pending" ? "Pendientes" : item === "expired" ? "Vencidas" : "Completadas"} ({counts[item]})</button>)}
          </div>
          {filtered.length === 0 ? <div className={styles.empty}>{tab === "pending" ? "No tienes evaluaciones pendientes" : tab === "expired" ? "No tienes evaluaciones vencidas" : "Aún no has completado evaluaciones"}</div> : <div className={styles.stack}>{filtered.map((assignment) => <button className={styles.listButton} type="button" disabled={busy} key={assignment.id} onClick={() => void openAssignment(assignment.id)}><div className={styles.studentHeading}><strong>{assignment.snapshot.name}</strong><StatusBadge status={assignment.status} /></div><p className={styles.meta}>{assignment.coachName} · {assignment.dueAt ? `Vence: ${formatEvaluationDate(assignment.dueAt)}` : "Sin fecha límite"}</p></button>)}</div>}
        </>
      ) : null}

      {!loading && !loadError && view === "form" && active ? (
        <>
          <div className={`${styles.card} ${styles.stack}`}><h2 id="student-evaluations-title" className={styles.title}>{active.snapshot.name}</h2><p className={styles.meta}>{active.coachName} · {active.dueAt ? `Vence: ${formatEvaluationDate(active.dueAt)}` : "Sin fecha límite"}</p><p className={styles.bannerInfo}>Tus respuestas serán visibles para {active.coachName}, tu coach vinculado, para ajustar tu plan.</p></div>
          {active.status === "expired" ? <div className={styles.bannerError}>El plazo para responder venció. Tu borrador quedó guardado en modo solo lectura. Pide a tu coach que extienda la fecha si necesitas responder.</div> : null}
          {active.status === "completed" ? <div className={styles.bannerInfo}>Ya enviaste esta evaluación. Tus respuestas quedan como registro y no pueden editarse.</div> : null}
          {active.snapshot.questions.map((question) => <StudentQuestion key={question.id} question={question} answer={answers[question.id]} readOnly={Boolean(readOnly)} hasError={errors.has(question.id)} editor={editor?.questionId === question.id ? editor : null} onText={(value) => setAnswers({ ...answers, [question.id]: value })} onAdd={() => setEditor({ questionId: question.id, rowId: null, values: Object.fromEntries((question.columns ?? []).map((column) => [column.id, ""])) })} onEdit={(row) => setEditor({ questionId: question.id, rowId: row.id, values: { ...row.values } })} onRemove={(rowId) => removeRow(question.id, rowId)} onEditorChange={(columnId, value) => editor && setEditor({ ...editor, values: { ...editor.values, [columnId]: value } })} onSaveRow={saveRow} onCancelRow={() => setEditor(null)} />)}
          {active.snapshot.sensitive ? <div className={styles.stack}><label className={`${styles.checkboxLine} ${styles.card}`}><input type="checkbox" checked={consent} disabled={readOnly} onChange={(event) => setConsent(event.target.checked)} /><span>{EVALUATION_CONSENT_COPY}</span></label>{errors.has("consent") ? <span className={styles.fieldError}>Debes confirmar el consentimiento para enviar</span> : null}</div> : null}
          {!readOnly ? <div className={styles.actions}><button className={styles.button} type="button" disabled={busy} onClick={() => void submit()}>Enviar</button><button className={styles.buttonWarning} type="button" disabled={busy} onClick={() => void saveDraft()}>Guardar borrador</button></div> : <button className={styles.button} type="button" onClick={returnToPreviousEvaluationView}>Volver</button>}
        </>
      ) : null}

      {!loading && !loadError && view === "success" && active ? <div className={styles.success}><Check size={42} color="#4ade80" /><h2 id="student-evaluations-title" className={styles.title}>Evaluación enviada</h2><p className={styles.muted}>Enviaste «{active.snapshot.name}» a {active.coachName}. Tu coach recibirá una notificación.</p><button className={styles.button} type="button" onClick={() => { setView("list"); setActive(null); }}>Volver a mis evaluaciones</button></div> : null}
      {toast ? <div className={styles.toast} role="status">{toast}</div> : null}
    </section>
  );
}

function StudentQuestion({ question, answer, readOnly, hasError, editor, onText, onAdd, onEdit, onRemove, onEditorChange, onSaveRow, onCancelRow }: {
  readonly question: EvaluationQuestion;
  readonly answer: EvaluationAnswers[string];
  readonly readOnly: boolean;
  readonly hasError: boolean;
  readonly editor: RowEditor | null;
  readonly onText: (value: string) => void;
  readonly onAdd: () => void;
  readonly onEdit: (row: EvaluationTableRow) => void;
  readonly onRemove: (rowId: string) => void;
  readonly onEditorChange: (columnId: string, value: string) => void;
  readonly onSaveRow: () => void;
  readonly onCancelRow: () => void;
}) {
  const rows = answer && typeof answer !== "string" ? answer.rows : [];
  return <article className={`${styles.questionCard} ${styles.stack}`}><div className={styles.questionHeading}><strong>{question.text}</strong>{question.required ? <span className={styles.required}>OBLIGATORIA</span> : null}</div>{question.mode === "text" ? <textarea className={styles.textarea} value={typeof answer === "string" ? answer : ""} disabled={readOnly} onChange={(event) => onText(event.target.value)} placeholder="Escribe tu respuesta…" /> : <>{question.guidance ? <p className={styles.guidance}>{question.guidance}</p> : null}<div className={styles.stack}>{rows.map((row) => <div className={styles.answerRow} key={row.id}><dl>{(question.columns ?? []).map((column) => <div key={column.id}><dt>{column.label}:</dt><dd>{row.values[column.id] || "—"}</dd></div>)}</dl>{!readOnly ? <div className={styles.inlineActions}><button className={styles.iconButton} type="button" aria-label="Editar fila" onClick={() => onEdit(row)}><Pencil size={15} /></button><button className={`${styles.iconButton} ${styles.iconDanger}`} type="button" aria-label="Eliminar fila" onClick={() => onRemove(row.id)}><Trash2 size={15} /></button></div> : null}</div>)}</div>{editor ? <div className={styles.rowEditor}>{(question.columns ?? []).map((column) => <label className={styles.label} key={column.id}>{column.label}<input className={styles.field} value={editor.values[column.id] ?? ""} onChange={(event) => onEditorChange(column.id, event.target.value)} /></label>)}<div className={styles.inlineActions}><button className={styles.button} type="button" onClick={onSaveRow}>Guardar fila</button><button className={styles.buttonSecondary} type="button" onClick={onCancelRow}>Cancelar</button></div></div> : null}{!readOnly && !editor ? <button className={styles.buttonSecondary} type="button" onClick={onAdd}>+ Agregar fila</button> : null}</>}{hasError ? <span className={styles.fieldError}>Este campo es obligatorio</span> : null}</article>;
}
