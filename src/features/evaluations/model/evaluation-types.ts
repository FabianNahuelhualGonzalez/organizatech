export type EvaluationQuestionMode = "text" | "table";
export type EvaluationTablePreset = "meals" | "medications" | "custom";
export type EvaluationAssignmentStatus = "pending" | "draft" | "expired" | "completed";

export interface EvaluationColumn {
  readonly id: string;
  readonly label: string;
}

export interface EvaluationQuestion {
  readonly id: string;
  readonly text: string;
  readonly required: boolean;
  readonly mode: EvaluationQuestionMode;
  readonly preset?: EvaluationTablePreset;
  readonly columns?: readonly EvaluationColumn[];
  readonly guidance?: string;
}

export interface EvaluationTemplate {
  readonly id: string;
  readonly name: string;
  readonly questions: readonly EvaluationQuestion[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvaluationStudent {
  readonly episodeId: string;
  readonly name: string;
  readonly email: string;
}

export interface EvaluationSnapshot {
  readonly templateOriginId: string;
  readonly name: string;
  readonly questions: readonly EvaluationQuestion[];
  readonly sensitive: boolean;
}

export interface EvaluationTableRow {
  readonly id: string;
  readonly values: Readonly<Record<string, string>>;
}

export type EvaluationAnswer = string | { readonly rows: readonly EvaluationTableRow[] };
export type EvaluationAnswers = Readonly<Record<string, EvaluationAnswer>>;

export interface CoachEvaluationAssignment {
  readonly id: string;
  readonly sendBatchId: string;
  readonly studentName: string;
  readonly snapshot: EvaluationSnapshot;
  readonly status: EvaluationAssignmentStatus;
  readonly sentAt: string;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly consentConfirmed: boolean;
  readonly answers: EvaluationAnswers;
  readonly canMutate: boolean;
  readonly canRemind: boolean;
}

export interface StudentEvaluationAssignment {
  readonly id: string;
  readonly coachName: string;
  readonly snapshot: EvaluationSnapshot;
  readonly status: EvaluationAssignmentStatus;
  readonly sentAt: string;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly consentConfirmed: boolean;
  readonly answers: EvaluationAnswers;
}

export const EVALUATION_CONSENT_COPY =
  "Confirmo que la información entregada (salud, lesiones, medicación o alimentación) es correcta y autorizo a mi coach vinculado a acceder a ella para ajustar mi plan.";

export const EVALUATION_TABLE_PRESETS: Readonly<Record<EvaluationTablePreset, {
  readonly label: string;
  readonly columns: readonly string[];
}>> = {
  meals: { label: "Comidas", columns: ["Hora", "Alimento", "Cantidad"] },
  medications: { label: "Medicamentos", columns: ["Hora", "Medicamento", "Dosis"] },
  custom: { label: "Personalizado", columns: ["Columna 1"] },
};

export function createEvaluationId(): string {
  return globalThis.crypto.randomUUID();
}

export function createEvaluationQuestion(): EvaluationQuestion {
  return {
    id: createEvaluationId(),
    text: "",
    required: false,
    mode: "text",
    preset: "meals",
    columns: EVALUATION_TABLE_PRESETS.meals.columns.map((label) => ({
      id: createEvaluationId(),
      label,
    })),
    guidance: "",
  };
}

export function questionsForSave(questions: readonly EvaluationQuestion[]): readonly EvaluationQuestion[] {
  const normalized: EvaluationQuestion[] = [];
  for (const question of questions) {
    const text = question.text.trim();
    if (!text) continue;
    if (question.mode === "text") {
      normalized.push({ id: question.id, text: text.slice(0, 100), required: question.required, mode: "text" });
      continue;
    }
    const columns = (question.columns ?? [])
      .map((column) => ({ id: column.id, label: column.label.trim() }))
      .filter((column) => column.label.length > 0);
    if (columns.length === 0) continue;
    normalized.push({
      id: question.id,
      text: text.slice(0, 100),
      required: question.required,
      mode: "table" as const,
      preset: question.preset ?? "custom",
      columns,
      guidance: question.guidance?.trim() || undefined,
    });
  }
  return normalized;
}

export function validateEvaluationForSubmit(
  snapshot: EvaluationSnapshot,
  answers: EvaluationAnswers,
  consentConfirmed: boolean,
): ReadonlySet<string> {
  const errors = new Set<string>();
  for (const question of snapshot.questions) {
    if (!question.required) continue;
    const answer = answers[question.id];
    if (question.mode === "text") {
      if (typeof answer !== "string" || !answer.trim()) errors.add(question.id);
    } else if (!answer || typeof answer === "string" || answer.rows.length === 0) {
      errors.add(question.id);
    }
  }
  if (snapshot.sensitive && !consentConfirmed) errors.add("consent");
  return errors;
}

export function formatEvaluationDate(value: string | null): string {
  if (!value) return "Sin fecha límite";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")}`;
}

export function formatEvaluationDateInput(value: string | null): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function initialsForEvaluation(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}
