export type TrainingCycleLifecycleEvent =
  | "expires_t3"
  | "expires_t2"
  | "expires_t1"
  | "expires_t0"
  | "closed_t1";

export interface TrainingCycleLifecycleEmailInput {
  readonly eventKind: TrainingCycleLifecycleEvent;
  readonly scheduledOn: string;
  readonly title: string;
  readonly body: string;
  readonly appUrl: string;
}

export interface TrainingCycleLifecycleEmailTemplate {
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
}

const EVENT_LABELS: Readonly<Record<TrainingCycleLifecycleEvent, string>> = {
  expires_t3: "CICLO · T-3",
  expires_t2: "CICLO · T-2",
  expires_t1: "CICLO · T-1",
  expires_t0: "CICLO · ÚLTIMO DÍA",
  closed_t1: "CICLO · CIERRE",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function safeText(value: string, maximumLength: number) {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maximumLength
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)
  ) {
    throw new TypeError("Contenido de ciclo inválido.");
  }
  return normalized;
}

export function renderTrainingCycleLifecycleEmail(
  input: TrainingCycleLifecycleEmailInput,
): TrainingCycleLifecycleEmailTemplate {
  const title = safeText(input.title, 120);
  const body = safeText(input.body, 1000);
  const label = EVENT_LABELS[input.eventKind];
  if (!label || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledOn)) {
    throw new TypeError("Evento de ciclo inválido.");
  }

  const actionUrl = new URL("/", input.appUrl);
  if (actionUrl.protocol !== "https:" || actionUrl.username || actionUrl.password) {
    throw new TypeError("URL de aplicación inválida.");
  }

  return {
    subject: title,
    htmlContent: `<!doctype html><html lang="es"><body style="margin:0;background:#07101A;color:#E5E7EB;font-family:'Roboto Mono',monospace"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(title)}</div><main style="max-width:600px;margin:0 auto;padding:32px 18px"><section style="border:1px solid #243247;border-radius:18px;background:#111827;padding:28px"><p style="color:#3C7AFF;font-size:12px;font-weight:700;letter-spacing:.08em">${escapeHtml(label)}</p><h1 style="font-size:24px;line-height:1.3">${escapeHtml(title)}</h1><p style="color:#AFC2DE;line-height:1.65">${escapeHtml(body)}</p><p style="padding:14px;border-radius:10px;background:#0B1522;color:#E5E7EB">${escapeHtml(input.scheduledOn)} · America/Santiago</p><a href="${escapeHtml(actionUrl.href)}" style="display:inline-block;margin-top:10px;border-radius:10px;background:#3C7AFF;color:#fff;padding:13px 18px;text-decoration:none;font-weight:700">Abrir Organizatech</a><p style="margin-top:24px;color:#8294AD;font-size:12px">La notificación también está disponible en la campana de Organizatech.</p></section></main></body></html>`,
    textContent: `${label}\n\n${title}\n${body}\n${input.scheduledOn} · America/Santiago\n\nAbrir Organizatech: ${actionUrl.href}\n\nLa notificación también está disponible en la campana de Organizatech.`,
  };
}
