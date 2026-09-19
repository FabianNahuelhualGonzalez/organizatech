"use client";

import { Check, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EvaluationRepositoryError,
  extendOwnEvaluationAssignment,
  hideOwnEvaluationTemplates,
  listOwnCoachEvaluationAssignments,
  listOwnEvaluationStudents,
  listOwnEvaluationTemplates,
  remindOwnEvaluationAssignment,
  saveOwnEvaluationTemplate,
  sendOwnEvaluationTemplate,
} from "@/features/evaluations/data/evaluations-repository";
import {
  EVALUATION_TABLE_PRESETS,
  createEvaluationId,
  createEvaluationQuestion,
  formatEvaluationDate,
  formatEvaluationDateInput,
  initialsForEvaluation,
  questionsForSave,
  type CoachEvaluationAssignment,
  type EvaluationQuestion,
  type EvaluationStudent,
  type EvaluationTablePreset,
  type EvaluationTemplate,
} from "@/features/evaluations/model/evaluation-types";
import { AppBackButton } from "@/ui/navigation/app-back-button";

import styles from "./evaluations.module.css";

type CoachView = "library" | "builder" | "send" | "sent" | "review" | "detail";

export function CoachEvaluations({ expectedUserId, onBack }: {
  readonly expectedUserId: string;
  readonly onBack: () => void;
}) {
  const [view, setView] = useState<CoachView>("library");
  const [templates, setTemplates] = useState<readonly EvaluationTemplate[]>([]);
  const [students, setStudents] = useState<readonly EvaluationStudent[]>([]);
  const [assignments, setAssignments] = useState<readonly CoachEvaluationAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftQuestions, setDraftQuestions] = useState<readonly EvaluationQuestion[]>([createEvaluationQuestion()]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [deleteSelection, setDeleteSelection] = useState<ReadonlySet<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sendTemplateId, setSendTemplateId] = useState("");
  const [query, setQuery] = useState("");
  const [recipients, setRecipients] = useState<readonly EvaluationStudent[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [sentRecipients, setSentRecipients] = useState<readonly EvaluationStudent[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [extendTarget, setExtendTarget] = useState<CoachEvaluationAssignment | null>(null);
  const [extendDate, setExtendDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextTemplates, nextStudents, nextAssignments] = await Promise.all([
        listOwnEvaluationTemplates(expectedUserId),
        listOwnEvaluationStudents(expectedUserId),
        listOwnCoachEvaluationAssignments(expectedUserId),
      ]);
      setTemplates(nextTemplates);
      setStudents(nextStudents);
      setAssignments(nextAssignments);
    } catch {
      setError("No pudimos cargar Evaluaciones. Intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  }, [expectedUserId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectedTemplate = templates.find((template) => template.id === sendTemplateId) ?? null;
  const detail = assignments.find((assignment) => assignment.id === detailId) ?? null;
  const filteredStudents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es-CL");
    if (!normalized) return [];
    return students.filter((student) => !recipients.some((item) => item.episodeId === student.episodeId))
      .filter((student) => `${student.name} ${student.email}`.toLocaleLowerCase("es-CL").includes(normalized));
  }, [query, recipients, students]);

  function openBuilder(template?: EvaluationTemplate) {
    setEditingId(template?.id ?? null);
    setDraftName(template?.name ?? "");
    setDraftQuestions(template?.questions.map((question) => ({
      ...question,
      columns: question.columns?.map((column) => ({ ...column })),
    })) ?? [createEvaluationQuestion()]);
    setView("builder");
  }

  function updateQuestion(id: string, patch: Partial<EvaluationQuestion>) {
    setDraftQuestions((current) => current.map((question) => question.id === id ? { ...question, ...patch } : question));
  }

  function choosePreset(questionId: string, preset: EvaluationTablePreset) {
    updateQuestion(questionId, {
      preset,
      columns: EVALUATION_TABLE_PRESETS[preset].columns.map((label) => ({ id: createEvaluationId(), label })),
    });
  }

  async function saveTemplate() {
    const normalizedQuestions = questionsForSave(draftQuestions);
    if (!draftName.trim()) return setToast("Ponle un nombre a tu plantilla");
    if (normalizedQuestions.length === 0) return setToast("Agrega al menos una pregunta válida");
    setBusy(true);
    try {
      await saveOwnEvaluationTemplate(expectedUserId, {
        templateId: editingId,
        name: draftName.trim(),
        questions: normalizedQuestions,
        requestId: createEvaluationId(),
      });
      await load();
      setView("library");
      setToast(editingId ? "Plantilla actualizada" : "Plantilla guardada");
    } catch {
      setToast("No pudimos guardar la plantilla");
    } finally {
      setBusy(false);
    }
  }

  async function hideTemplates() {
    if (deleteSelection.size === 0) return;
    setBusy(true);
    try {
      await hideOwnEvaluationTemplates(expectedUserId, [...deleteSelection]);
      await load();
      setDeleteMode(false);
      setDeleteSelection(new Set());
      setDeleteOpen(false);
      setToast("Plantilla oculta; los envíos se conservaron");
    } catch {
      setToast("No pudimos ocultar la plantilla");
    } finally {
      setBusy(false);
    }
  }

  function openSend(templateId: string) {
    setSendTemplateId(templateId);
    setRecipients([]);
    setQuery("");
    setDueDate("");
    setSensitive(false);
    setView("send");
  }

  async function sendTemplate() {
    if (!selectedTemplate || recipients.length === 0) return;
    setBusy(true);
    try {
      await sendOwnEvaluationTemplate(expectedUserId, {
        templateId: selectedTemplate.id,
        episodeIds: recipients.map((student) => student.episodeId),
        dueDate: dueDate || null,
        sensitive,
        requestId: createEvaluationId(),
      });
      setSentRecipients(recipients);
      await load();
      setView("sent");
    } catch (caught) {
      setToast(caught instanceof EvaluationRepositoryError && caught.code === "forbidden"
        ? "Uno de los alumnos ya no está vinculado"
        : "No pudimos enviar la evaluación");
    } finally {
      setBusy(false);
    }
  }

  async function extendAssignment() {
    if (!extendTarget || !extendDate) return;
    setBusy(true);
    try {
      await extendOwnEvaluationAssignment(expectedUserId, extendTarget.id, extendDate, createEvaluationId());
      await load();
      setExtendTarget(null);
      setToast("Fecha límite actualizada");
    } catch {
      setToast("No pudimos extender la fecha");
    } finally {
      setBusy(false);
    }
  }

  async function remind(assignment: CoachEvaluationAssignment) {
    setBusy(true);
    try {
      await remindOwnEvaluationAssignment(expectedUserId, assignment.id, createEvaluationId());
      setToast(`Recordatorio enviado a ${assignment.studentName}`);
    } catch (caught) {
      setToast(caught instanceof EvaluationRepositoryError && caught.code === "rate_limited"
        ? "Ya enviaste un recordatorio durante las últimas 48 horas"
        : "No pudimos enviar el recordatorio");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (view === "library") onBack();
    else if (view === "detail") setView("review");
    else setView("library");
  }

  return (
    <section className={styles.screen} aria-labelledby="coach-evaluations-title">
      <div><AppBackButton onBack={goBack} /></div>
      {loading ? <div className={styles.loading} role="status">Cargando Evaluaciones…</div> : null}
      {!loading && error ? (
        <div className={styles.error} role="alert"><div><p>{error}</p><button className={styles.button} type="button" onClick={() => void load()}>Reintentar</button></div></div>
      ) : null}
      {!loading && !error && view === "library" ? (
        <>
          <header className={styles.stack}>
            <h2 id="coach-evaluations-title" className={styles.title}>Crea tu plantilla de evaluación</h2>
            <p className={styles.subtitle}>Crea formularios reutilizables, envíalos a tus alumnos vinculados y revisa sus respuestas.</p>
          </header>
          <div className={styles.toolbar}>
            <button className={styles.pillButton} type="button" onClick={() => openBuilder()}><Plus size={16} /> Agregar</button>
            <button className={styles.buttonDanger} type="button" onClick={() => {
              if (deleteMode) {
                if (deleteSelection.size === 0) setToast("Selecciona al menos una plantilla");
                else setDeleteOpen(true);
              } else if (templates.length === 0) setToast("No tienes plantillas para ocultar");
              else setDeleteMode(true);
            }}>Ocultar{deleteMode ? ` (${deleteSelection.size})` : ""}</button>
            {deleteMode ? <button className={styles.buttonSecondary} type="button" onClick={() => { setDeleteMode(false); setDeleteSelection(new Set()); }}>Cancelar</button> : null}
            <button className={styles.buttonSecondary} type="button" onClick={() => setView("review")}>Evaluaciones enviadas</button>
          </div>
          {templates.length === 0 ? <div className={styles.empty}>Sin registro de plantilla</div> : (
            <div className={`${styles.card} ${styles.stack}`}>
              {templates.map((template) => {
                const checked = deleteSelection.has(template.id);
                return (
                  <div className={styles.templateRow} data-selected={checked} key={template.id}>
                    {deleteMode ? (
                      <button className={styles.checkButton} type="button" aria-label={`Seleccionar ${template.name}`} onClick={() => setDeleteSelection((current) => {
                        const next = new Set(current);
                        if (next.has(template.id)) next.delete(template.id); else next.add(template.id);
                        return next;
                      })}>{checked ? <Check size={20} /> : <span aria-hidden="true">○</span>}</button>
                    ) : null}
                    <div className={styles.templateCopy}>
                      <strong>{template.name}</strong>
                      <span>{template.questions.length} {template.questions.length === 1 ? "pregunta" : "preguntas"} · Creada: {formatEvaluationDate(template.createdAt)}</span>
                    </div>
                    {!deleteMode ? <button className={styles.iconButton} type="button" aria-label={`Editar ${template.name}`} onClick={() => openBuilder(template)}><Pencil size={16} /></button> : null}
                    {!deleteMode ? <button className={styles.pillButton} type="button" onClick={() => openSend(template.id)}><Send size={14} /> Enviar</button> : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {!loading && !error && view === "builder" ? (
        <>
          <header className={styles.stack}>
            <h2 id="coach-evaluations-title" className={styles.title}>{editingId ? "Edita tu plantilla" : "Crea tu plantilla de evaluación"}</h2>
            <p className={styles.subtitle}>Las ediciones sólo afectan envíos futuros.</p>
          </header>
          <div className={`${styles.card} ${styles.stack}`}>
            <label className={styles.label}>Nombre plantilla<input className={styles.field} value={draftName} maxLength={120} onChange={(event) => setDraftName(event.target.value)} placeholder="Escribe el nombre para tu plantilla…" /></label>
            {draftQuestions.map((question, index) => (
              <div className={`${styles.questionCard} ${styles.stack}`} key={question.id}>
                <div className={styles.questionHeading}><strong>Pregunta {index + 1}</strong><button className={`${styles.iconButton} ${styles.iconDanger}`} type="button" aria-label={`Eliminar pregunta ${index + 1}`} onClick={() => setDraftQuestions((current) => current.filter((item) => item.id !== question.id))}><Trash2 size={16} /></button></div>
                <div className={styles.inlineActions}>
                  <label className={styles.radioLine}><input type="radio" checked={question.mode === "text"} onChange={() => updateQuestion(question.id, { mode: "text" })} /> Formato casilla</label>
                  <label className={styles.radioLine}><input type="radio" checked={question.mode === "table"} onChange={() => updateQuestion(question.id, { mode: "table" })} /> Formato tabla</label>
                </div>
                <input className={styles.field} value={question.text} maxLength={100} onChange={(event) => updateQuestion(question.id, { text: event.target.value })} placeholder="Escribe la pregunta…" />
                {question.mode === "text" ? <span className={styles.meta}>{question.text.length} de 100 caracteres</span> : null}
                {question.mode === "table" ? (
                  <div className={styles.stack}>
                    <span className={styles.meta}>¿QUÉ TIPO DE REGISTRO ES?</span>
                    <div className={styles.presetRow}>{(Object.keys(EVALUATION_TABLE_PRESETS) as EvaluationTablePreset[]).map((preset) => <button className={styles.preset} data-active={(question.preset ?? "meals") === preset} data-preset={preset} type="button" key={preset} onClick={() => choosePreset(question.id, preset)}>{EVALUATION_TABLE_PRESETS[preset].label}</button>)}</div>
                    <span className={styles.meta}>COLUMNAS DE LA TABLA</span>
                    {(question.columns ?? []).map((column) => (
                      <div className={styles.inlineActions} key={column.id}>
                        <input className={styles.field} value={column.label} maxLength={80} onChange={(event) => updateQuestion(question.id, { columns: (question.columns ?? []).map((item) => item.id === column.id ? { ...item, label: event.target.value } : item) })} placeholder="Nombre de columna" />
                        <button className={styles.iconButton} type="button" disabled={(question.columns?.length ?? 0) <= 1} aria-label="Quitar columna" onClick={() => updateQuestion(question.id, { columns: question.columns?.filter((item) => item.id !== column.id) })}><X size={15} /></button>
                      </div>
                    ))}
                    <button className={styles.buttonSecondary} type="button" onClick={() => updateQuestion(question.id, { columns: [...(question.columns ?? []), { id: createEvaluationId(), label: "" }] })}>+ Agregar columna</button>
                    <input className={styles.field} value={question.guidance ?? ""} maxLength={500} onChange={(event) => updateQuestion(question.id, { guidance: event.target.value })} placeholder="Indicación para el alumno (opcional)" />
                    <div className={styles.preview}><span>ASÍ LA VERÁ TU ALUMNO</span>{(question.columns ?? []).map((column) => <span key={column.id}>{column.label || "Sin nombre"}: — — —</span>)}</div>
                  </div>
                ) : null}
                <label className={styles.checkboxLine}><input type="checkbox" checked={question.required} onChange={(event) => updateQuestion(question.id, { required: event.target.checked })} /> Obligatoria</label>
              </div>
            ))}
            <div className={styles.actions}>
              <button className={styles.buttonWarning} type="button" onClick={() => setDraftQuestions((current) => [...current, createEvaluationQuestion()])}>Agregar más preguntas</button>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void saveTemplate()}>Guardar</button>
            </div>
          </div>
        </>
      ) : null}

      {!loading && !error && view === "send" ? (
        <>
          <h2 id="coach-evaluations-title" className={styles.title}>Selecciona la plantilla que enviarás</h2>
          <div className={`${styles.card} ${styles.stack}`}>
            <label className={styles.label}>Plantilla<select className={styles.select} value={sendTemplateId} onChange={(event) => setSendTemplateId(event.target.value)}>{templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label>
            <label className={styles.label}>Busca a quien se la quieres enviar<input className={styles.field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca a tu alumno vinculado…" /></label>
            {filteredStudents.map((student) => <button className={styles.listButton} type="button" key={student.episodeId} onClick={() => { setRecipients((current) => [...current, student]); setQuery(""); }}><strong>{student.name}</strong><span className={styles.meta}>{student.email}</span></button>)}
            {query.trim() && filteredStudents.length === 0 ? <p className={styles.muted}>Sin alumnos vinculados que coincidan con «{query.trim()}»</p> : null}
            <div className={styles.selectedRecipients}>{recipients.map((student) => <div className={styles.recipientRow} key={student.episodeId}><span className={styles.avatar}>{initialsForEvaluation(student.name)}</span><div className={styles.recipientCopy}><strong>{student.name}</strong><span>{student.email}</span></div><button className={styles.iconButton} type="button" aria-label={`Quitar ${student.name}`} onClick={() => setRecipients((current) => current.filter((item) => item.episodeId !== student.episodeId))}><X size={15} /></button></div>)}</div>
            <label className={styles.label}>Fecha límite para responderla <span className={styles.meta}>(opcional)</span><input className={styles.field} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            <label className={styles.checkboxLine}><input type="checkbox" checked={sensitive} onChange={(event) => setSensitive(event.target.checked)} /><span>Esta evaluación contiene información sensible de salud, lesiones, medicación o alimentación.</span></label>
            <button className={styles.button} type="button" disabled={busy || !selectedTemplate || recipients.length === 0} onClick={() => void sendTemplate()}>Enviar</button>
          </div>
        </>
      ) : null}

      {!loading && !error && view === "sent" ? (
        <div className={styles.success}>
          <Check size={42} color="#4ade80" />
          <h2 id="coach-evaluations-title" className={styles.title}>Formulario enviado exitosamente</h2>
          <p className={styles.muted}>Se envió «{selectedTemplate?.name}» a:</p>
          <div className={`${styles.stack}`} style={{ width: "100%" }}>{sentRecipients.map((student) => <div className={styles.recipientRow} key={student.episodeId}><span className={styles.avatar}>{initialsForEvaluation(student.name)}</span><div className={styles.recipientCopy}><strong>{student.name}</strong><span>{student.email}</span></div></div>)}</div>
          <button className={styles.button} type="button" onClick={() => setView("library")}>Volver a mis plantillas</button>
        </div>
      ) : null}

      {!loading && !error && view === "review" ? (
        <>
          <header className={styles.stack}><h2 id="coach-evaluations-title" className={styles.title}>Evaluaciones enviadas</h2><p className={styles.subtitle}>Revisa estados y respuestas, extiende plazos o envía un recordatorio.</p></header>
          {assignments.length === 0 ? <div className={styles.empty}>Aún no has enviado ninguna plantilla</div> : <CoachAssignmentGroups assignments={assignments} busy={busy} onView={(id) => { setDetailId(id); setView("detail"); }} onExtend={(assignment) => { setExtendTarget(assignment); setExtendDate(formatEvaluationDateInput(assignment.dueAt)); }} onRemind={(assignment) => void remind(assignment)} />}
        </>
      ) : null}

          {!loading && !error && view === "detail" && detail ? <CoachEvaluationDetail assignment={detail} onCloseDetail={() => setView("review")} /> : null}

      {deleteOpen ? <><button className={styles.scrim} type="button" aria-label="Cancelar" onClick={() => setDeleteOpen(false)} /><div className={`${styles.modal} ${styles.stack}`} role="dialog" aria-modal="true"><h3>¿Ocultar {deleteSelection.size} plantilla{deleteSelection.size === 1 ? "" : "s"}?</h3><p className={styles.muted}>Dejarán de aparecer en tu biblioteca. Los snapshots, asignaciones y respuestas ya enviadas se conservarán.</p><button className={styles.buttonDanger} type="button" disabled={busy} onClick={() => void hideTemplates()}>Sí, ocultar</button><button className={styles.button} type="button" onClick={() => setDeleteOpen(false)}>Cancelar</button></div></> : null}
      {extendTarget ? <><button className={styles.scrim} type="button" aria-label="Cancelar" onClick={() => setExtendTarget(null)} /><div className={`${styles.modal} ${styles.stack}`} role="dialog" aria-modal="true"><h3>Extender fecha límite</h3><p className={styles.muted}>Nueva fecha para {extendTarget.studentName}</p><input className={styles.field} type="date" value={extendDate} onChange={(event) => setExtendDate(event.target.value)} /><button className={styles.button} type="button" disabled={busy || !extendDate} onClick={() => void extendAssignment()}>Guardar nueva fecha</button><button className={styles.buttonSecondary} type="button" onClick={() => setExtendTarget(null)}>Cancelar</button></div></> : null}
      {toast ? <div className={styles.toast} role="status">{toast}</div> : null}
    </section>
  );
}

function CoachAssignmentGroups({ assignments, busy, onView, onExtend, onRemind }: {
  readonly assignments: readonly CoachEvaluationAssignment[];
  readonly busy: boolean;
  readonly onView: (id: string) => void;
  readonly onExtend: (assignment: CoachEvaluationAssignment) => void;
  readonly onRemind: (assignment: CoachEvaluationAssignment) => void;
}) {
  const groups = new Map<string, CoachEvaluationAssignment[]>();
  for (const assignment of assignments) groups.set(assignment.sendBatchId, [...(groups.get(assignment.sendBatchId) ?? []), assignment]);
  return <div className={styles.stack}>{[...groups.values()].map((group) => <section className={`${styles.card} ${styles.stack}`} key={group[0]!.sendBatchId}><div><strong>{group[0]!.snapshot.name}</strong><p className={styles.meta}>Enviada: {formatEvaluationDate(group[0]!.sentAt)} · {group.length} alumno{group.length === 1 ? "" : "s"}</p></div>{group.map((assignment) => <article className={`${styles.assignmentCard} ${styles.stack}`} key={assignment.id}><div className={styles.studentHeading}><strong>{assignment.studentName}</strong><StatusBadge status={assignment.status} /></div><p className={styles.meta}>{assignment.status === "completed" ? `Respondida: ${formatEvaluationDate(assignment.completedAt)}` : assignment.dueAt ? `Vence: ${formatEvaluationDate(assignment.dueAt)}` : "Sin fecha límite"}</p><div className={styles.inlineActions}>{assignment.status === "completed" ? <button className={styles.button} type="button" onClick={() => onView(assignment.id)}>Ver respuesta</button> : null}{assignment.status !== "completed" && assignment.canMutate ? <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => onExtend(assignment)}>Extender fecha</button> : null}{assignment.canRemind ? <button className={styles.buttonSecondary} type="button" disabled={busy} onClick={() => onRemind(assignment)}>Recordar</button> : null}</div></article>)}</section>)}</div>;
}

function CoachEvaluationDetail({ assignment, onCloseDetail }: { readonly assignment: CoachEvaluationAssignment; readonly onCloseDetail: () => void }) {
  return <div className={styles.stack}><div className={`${styles.card} ${styles.stack}`}><h2 id="coach-evaluations-title" className={styles.title}>{assignment.snapshot.name}</h2><p className={styles.meta}>Alumno: {assignment.studentName}</p><p className={styles.meta}>Enviada: {formatEvaluationDate(assignment.sentAt)} · Respondida: {formatEvaluationDate(assignment.completedAt)}</p>{assignment.snapshot.sensitive && assignment.consentConfirmed ? <p style={{ color: "#4ade80", fontSize: 11 }}>✓ Alumno confirmó el consentimiento de datos sensibles</p> : null}</div>{assignment.snapshot.questions.map((question) => <article className={`${styles.questionCard} ${styles.stack}`} key={question.id}><strong>{question.text}</strong>{question.mode === "text" ? <TextAnswer answer={assignment.answers[question.id]} /> : <AnswerRows question={question} answer={assignment.answers[question.id]} />}</article>)}<button className={styles.button} type="button" onClick={onCloseDetail}>Volver al estado de envío</button></div>;
}

function TextAnswer({ answer }: { readonly answer: CoachEvaluationAssignment["answers"][string] }) {
  return <p className={styles.muted}>{typeof answer === "string" ? answer : "Sin respuesta"}</p>;
}

function AnswerRows({ question, answer }: { readonly question: EvaluationQuestion; readonly answer: CoachEvaluationAssignment["answers"][string] }) {
  const rows = answer && typeof answer !== "string" ? answer.rows : [];
  if (rows.length === 0) return <p className={styles.muted}>Sin filas registradas</p>;
  return <div className={styles.stack}>{rows.map((row) => <div className={styles.answerRow} key={row.id}><dl>{(question.columns ?? []).map((column) => <div key={column.id}><dt>{column.label}:</dt><dd>{row.values[column.id] || "—"}</dd></div>)}</dl></div>)}</div>;
}

export function StatusBadge({ status }: { readonly status: CoachEvaluationAssignment["status"] }) {
  const labels = { pending: "Pendiente", draft: "Borrador", expired: "Vencida", completed: "Completada" } as const;
  return <span className={`${styles.badge} ${styles[status]}`}>{labels[status]}</span>;
}
