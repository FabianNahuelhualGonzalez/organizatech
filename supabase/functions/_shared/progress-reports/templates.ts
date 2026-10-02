export function renderProgressReportEmail(input: {
  readonly studentName: string;
  readonly coachName: string;
  readonly studentMessage: string | null;
  readonly checkDates: readonly string[];
  readonly photoCount: number;
  readonly actionUrl: string;
}) {
  const name = input.studentName.trim();
  const coachName = input.coachName.trim();
  const url = new URL(input.actionUrl);
  if (!name || name.length > 201 || /[\u0000-\u001f\u007f]/.test(name)
    || !coachName || coachName.length > 201 || /[\u0000-\u001f\u007f]/.test(coachName)
    || (input.studentMessage !== null && (input.studentMessage.length > 2000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.studentMessage)))
    || input.checkDates.length < 1 || input.checkDates.length > 30
    || input.checkDates.some((date) => !/^\d{2}\/\d{2}\/\d{4}$/.test(date))
    || !Number.isInteger(input.photoCount) || input.photoCount < 1 || input.photoCount > 30
    || url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("invalid progress report email");
  }
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&#39;",
  })[character]!);
  const subject = `${name} te envió un reporte de fotos de progreso`;
  const summary = `${input.photoCount} ${input.photoCount === 1 ? "foto" : "fotos"} de progreso · Check ${input.checkDates.join(" y ")}.`;
  const message = input.studentMessage?.trim() || null;
  return {
    subject,
    htmlContent: `<!doctype html><html lang="es"><body style="margin:0;background:#07101A;color:#E5E7EB;font-family:'Roboto Mono',monospace"><main style="max-width:600px;margin:0 auto;padding:32px 18px"><section style="border:1px solid #243247;border-radius:18px;background:#111827;padding:28px"><p style="color:#3C7AFF;font-size:12px;font-weight:700">ORGANIZATECH · FOTOS DE PROGRESO</p><h1 style="font-size:22px;line-height:1.35">${escape(subject)}</h1><p style="color:#AFC2DE;line-height:1.7">Hola, ${escape(coachName)}.</p><p style="color:#AFC2DE;line-height:1.7">${escape(summary)}</p><p style="font-size:24px" aria-label="Fotos privadas">🔒</p>${message ? `<p style="color:#AFC2DE;line-height:1.7">Mensaje de ${escape(name)}: ${escape(message)}</p>` : ""}<a href="${escape(url.toString())}" style="display:inline-block;margin-top:10px;border-radius:10px;background:#3C7AFF;color:#fff;padding:13px 18px;text-decoration:none;font-weight:700">Abrir Organizatech</a><p style="color:#AFC2DE;font-size:12px">Por privacidad, los archivos no se adjuntan al correo.</p></section></main></body></html>`,
    textContent: `${subject}\n\nHola, ${coachName}.\n${summary}${message ? `\n\nMensaje de ${name}: ${message}` : ""}\n\nPor privacidad, los archivos no se adjuntan al correo. Abre tu sesión de coach: ${url.toString()}`,
  };
}
