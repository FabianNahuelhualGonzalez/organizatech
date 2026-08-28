export interface CalendarReminderEmailInput {
  readonly title: string;
  readonly description: string;
  readonly occurrenceOn: string;
  readonly reminderTime: string;
  readonly appUrl: string;
}

export interface CalendarReminderEmailTemplate {
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function safeText(value: string, maximumLength: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new TypeError("Contenido de recordatorio inválido.");
  }
  return normalized;
}

export function renderCalendarReminderEmail(input: CalendarReminderEmailInput): CalendarReminderEmailTemplate {
  const title = safeText(input.title, 120);
  const description = input.description.trim()
    ? safeText(input.description, 1000)
    : "Tienes un recordatorio de calendario programado.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurrenceOn) || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input.reminderTime)) {
    throw new TypeError("Fecha de recordatorio inválida.");
  }
  const actionUrl = new URL("/", input.appUrl);
  if (actionUrl.protocol !== "https:" || actionUrl.username || actionUrl.password) {
    throw new TypeError("URL de aplicación inválida.");
  }
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const schedule = `${input.occurrenceOn} · ${input.reminderTime.slice(0, 5)} · America/Santiago`;
  return {
    subject: `Recordatorio: ${title}`,
    htmlContent: `<!doctype html><html lang="es"><body style="margin:0;background:#07101A;color:#E5E7EB;font-family:'Roboto Mono',monospace"><div style="display:none;max-height:0;overflow:hidden">${safeTitle}</div><main style="max-width:600px;margin:0 auto;padding:32px 18px"><section style="border:1px solid #243247;border-radius:18px;background:#111827;padding:28px"><p style="color:#3C7AFF;font-size:12px;font-weight:700;letter-spacing:.08em">RECORDATORIO DE CALENDARIO</p><h1 style="font-size:24px;line-height:1.3">${safeTitle}</h1><p style="color:#AFC2DE;line-height:1.65">${safeDescription}</p><p style="padding:14px;border-radius:10px;background:#0B1522;color:#E5E7EB">${escapeHtml(schedule)}</p><a href="${escapeHtml(actionUrl.href)}" style="display:inline-block;margin-top:10px;border-radius:10px;background:#3C7AFF;color:#fff;padding:13px 18px;text-decoration:none;font-weight:700">Abrir Organizatech</a><p style="margin-top:24px;color:#8294AD;font-size:12px">Configuraste este correo desde tu recordatorio. La notificación también está disponible en la campana.</p></section></main></body></html>`,
    textContent: `RECORDATORIO DE CALENDARIO\n\n${title}\n${description}\n${schedule}\n\nAbrir Organizatech: ${actionUrl.href}\n\nConfiguraste este correo desde tu recordatorio. La notificación también está disponible en la campana.`,
  };
}
