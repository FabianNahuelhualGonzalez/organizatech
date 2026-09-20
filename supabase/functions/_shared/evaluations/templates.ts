export type EvaluationEmailEvent =
  | "evaluation_received"
  | "evaluation_sent"
  | "evaluation_completed"
  | "evaluation_due_reminder";

export interface EvaluationEmailInput {
  readonly eventKind: EvaluationEmailEvent;
  readonly templateName: string;
  readonly coachName?: string;
  readonly studentName?: string;
  readonly studentNames?: string;
  readonly dueAt?: string | null;
  readonly dueLabel?: string | null;
  readonly actionUrl: string;
}

export interface EvaluationEmailTemplate {
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
}

function safe(value: string | null | undefined, maximum: number) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > maximum || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new TypeError("invalid evaluation email copy");
  }
  return normalized;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function dueCopy(dueAt?: string | null) {
  if (!dueAt) return "Sin fecha límite.";
  const date = new Date(dueAt);
  if (!Number.isFinite(date.getTime())) throw new TypeError("invalid due date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `Fecha límite: ${part("day")}/${part("month")}/${part("year")}.`;
}

export function renderEvaluationEmail(input: EvaluationEmailInput): EvaluationEmailTemplate {
  const template = safe(input.templateName, 120);
  const actionUrl = new URL(input.actionUrl);
  if (actionUrl.protocol !== "https:" || actionUrl.username || actionUrl.password) throw new TypeError("invalid app url");
  let subject: string;
  let body: string;
  if (input.eventKind === "evaluation_received") {
    const coach = safe(input.coachName, 201);
    subject = `Nueva evaluación de ${coach}`;
    body = `${coach} te envió el formulario «${template}». ${dueCopy(input.dueAt)} Responde desde la app.`;
  } else if (input.eventKind === "evaluation_sent") {
    const names = safe(input.studentNames, 12000);
    subject = "Enviaste una evaluación";
    body = `Tu plantilla «${template}» se envió a ${names}. Te avisaremos cuando respondan.`;
  } else if (input.eventKind === "evaluation_completed") {
    const student = safe(input.studentName, 201);
    subject = `${student} respondió tu evaluación`;
    body = `${student} completó «${template}». Revisa sus respuestas desde la app.`;
  } else {
    const coach = safe(input.coachName, 201);
    const due = safe(input.dueLabel, 10);
    subject = `Recordatorio: «${template}» vence pronto`;
    body = `Tienes hasta el ${due} para responder «${template}» de ${coach}.`;
  }
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(body);
  const href = escapeHtml(actionUrl.toString());
  return {
    subject,
    htmlContent: `<!doctype html><html lang="es"><body style="margin:0;background:#07101A;color:#E5E7EB;font-family:'Roboto Mono',monospace"><main style="max-width:600px;margin:0 auto;padding:32px 18px"><section style="border:1px solid #243247;border-radius:18px;background:#111827;padding:28px"><p style="color:#3C7AFF;font-size:12px;font-weight:700;letter-spacing:.08em">EVALUACIONES</p><h1 style="font-size:22px;line-height:1.35">${safeSubject}</h1><p style="color:#AFC2DE;line-height:1.7">${safeBody}</p><a href="${href}" style="display:inline-block;margin-top:10px;border-radius:10px;background:#3C7AFF;color:#fff;padding:13px 18px;text-decoration:none;font-weight:700">Abrir Organizatech</a></section></main></body></html>`,
    textContent: `EVALUACIONES\n\n${subject}\n${body}\n\nAbrir Organizatech: ${actionUrl.toString()}`,
  };
}
