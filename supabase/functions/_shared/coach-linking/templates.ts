export type CoachLinkEmailAudience = "student" | "coach";

export interface CoachLinkEmailInput {
  readonly audience: CoachLinkEmailAudience;
  readonly recipientFirstName: string;
  readonly coachName: string;
  readonly studentName: string;
  readonly actionUrl: string;
}

export interface RenderedCoachLinkEmail {
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
}

export type CoachInvitationEmailAudience = "student" | "coach";

export interface CoachInvitationEmailInput {
  readonly audience: CoachInvitationEmailAudience;
  readonly recipientFirstName: string | null;
  readonly coachName: string;
  readonly invitedEmail: string;
  readonly invitationCode: string;
  readonly expiresAt: string;
  readonly recipientHasAccount: boolean;
  readonly actionUrl: string;
}

const FONT = "'Roboto Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function presentation(value: string, maximum: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new TypeError("Invalid coach-link email presentation data.");
  }
  return normalized;
}

function secureUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("Invalid coach-link email action URL.");
  }
  return url.toString();
}

function invitationCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^([ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]-){2}[ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]$/.test(normalized)) {
    throw new TypeError("Invalid coach invitation code.");
  }
  return normalized;
}

function email(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized !== value || normalized.length > 254
    || !/^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/.test(normalized)) {
    throw new TypeError("Invalid coach invitation email.");
  }
  return normalized;
}

function expiration(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError("Invalid coach invitation expiration.");
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(new Date(time));
}

export function renderCoachInvitationEmail(input: CoachInvitationEmailInput): RenderedCoachLinkEmail {
  const student = input.audience === "student";
  const firstName = input.recipientFirstName === null ? null : presentation(input.recipientFirstName, 80);
  const coachName = presentation(input.coachName, 201);
  const invitedEmail = email(input.invitedEmail);
  const code = invitationCode(input.invitationCode);
  const expiry = expiration(input.expiresAt);
  const actionUrl = secureUrl(input.actionUrl);
  const subject = student
    ? `${coachName} te invitó a vincularte en Organizatech`
    : `Código de vinculación creado para ${invitedEmail}`;
  const heading = student ? "Tienes una invitación de coaching" : "Código de vinculación creado";
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";
  const intro = student
    ? `${coachName} te invitó a vincular tu cuenta de Organizatech.`
    : `Creamos un código de vinculación dirigido exclusivamente a ${invitedEmail}.`;
  const accountInstruction = input.recipientHasAccount
    ? "Inicia sesión con este mismo correo y ve a Perfil > Coaching para ingresar el código."
    : "Aún no encontramos una cuenta para este correo. Crea tu cuenta con exactamente este correo y luego ve a Perfil > Coaching para ingresar el código.";
  const instruction = student
    ? accountInstruction
    : "El alumno debe iniciar sesión —o crear su cuenta— con ese mismo correo y aceptar el código en Perfil > Coaching.";
  const cta = student
    ? input.recipientHasAccount ? "Ingresar a Organizatech" : "Crear mi cuenta"
    : "Abrir Panel Coach";
  const footer = student
    ? "El vínculo no se activa automáticamente: requiere una sesión autenticada con este correo y el ingreso manual del código."
    : "Si el correo no llega, el código sigue vigente y puedes compartirlo mediante las opciones de respaldo del Panel Coach.";

  const htmlContent = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(subject)}</title></head>
<body style="Margin:0;padding:24px 12px;background:#07101A;color:#fff;font-family:${FONT};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#0D1A26;border:1px solid rgba(255,255,255,.16);border-radius:15px;overflow:hidden;">
<tr><td style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,.10);"><span style="display:inline-block;width:24px;height:24px;border-radius:7px;background:#3C7AFF;vertical-align:middle;"></span><span style="padding-left:10px;font-size:13px;font-weight:700;letter-spacing:.02em;vertical-align:middle;">ORGANIZATECH</span></td></tr>
<tr><td style="padding:28px 24px;"><h1 style="Margin:0 0 12px;font-family:${FONT};font-size:18px;line-height:1.4;">${escapeHtml(heading)}</h1>
<p style="Margin:0 0 16px;font-size:14px;line-height:1.6;color:rgba(255,255,255,.70);">${escapeHtml(greeting)}<br><br>${escapeHtml(intro)} ${escapeHtml(instruction)}</p>
<p style="Margin:0 0 8px;font-size:11px;line-height:1.5;color:rgba(255,255,255,.52);">CÓDIGO DE VINCULACIÓN</p>
<p style="Margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:.08em;color:#fff;">${escapeHtml(code)}</p>
<p style="Margin:0 0 20px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.52);">Vence el ${escapeHtml(expiry)}.</p>
<a href="${escapeHtml(actionUrl)}" role="button" style="display:inline-block;background:#3C7AFF;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:11px;">${escapeHtml(cta)}</a>
<p style="Margin:20px 0 0;font-size:11px;line-height:1.5;color:rgba(255,255,255,.38);">${escapeHtml(footer)}</p></td></tr>
</table></td></tr></table></body></html>`;

  return {
    subject,
    htmlContent,
    textContent: [
      "ORGANIZATECH", "", heading, "", greeting, "", `${intro} ${instruction}`, "",
      `Código de vinculación: ${code}`, `Vence el ${expiry}.`, "", `${cta}: ${actionUrl}`, "", footer,
    ].join("\n"),
  };
}

export function renderCoachLinkEmail(input: CoachLinkEmailInput): RenderedCoachLinkEmail {
  const firstName = presentation(input.recipientFirstName, 80);
  const coachName = presentation(input.coachName, 201);
  const studentName = presentation(input.studentName, 201);
  const actionUrl = secureUrl(input.actionUrl);
  const student = input.audience === "student";
  const subject = student ? `Te vinculaste con ${coachName}` : `Nuevo alumno vinculado: ${studentName}`;
  const heading = student ? "Vinculación confirmada" : "Nuevo alumno vinculado";
  const sentences = student ? [
    `Te vinculaste con ${coachName} en Organizatech.`,
    "A partir de ahora puede ver tus entrenamientos y crear o editar tus rutinas.",
    "Puedes desvincularte cuando quieras desde tu perfil; tu historial se conserva.",
  ] : [
    `${studentName} se vinculó a tu cuenta usando tu código de invitación.`,
    "Ya puedes ver sus entrenamientos y crear o editar sus rutinas desde tu dashboard.",
  ];
  const cta = student ? "Ver mi coach" : "Ver alumno";
  const footer = student
    ? "Este correo se envió porque tu cuenta se vinculó con un coach en Organizatech."
    : "Este correo se envió porque un alumno usó tu código de vinculación en Organizatech.";
  const emphasis = student ? coachName : studentName;
  const firstSentence = sentences[0]!.replace(emphasis, `__${emphasis}__`);
  const htmlFirstSentence = escapeHtml(firstSentence)
    .replace(`__${escapeHtml(emphasis)}__`, `<strong style="color:#fff;">${escapeHtml(emphasis)}</strong>`);
  const htmlSentences = [htmlFirstSentence, ...sentences.slice(1).map(escapeHtml)].join(" ");

  const htmlContent = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(subject)}</title></head>
<body style="Margin:0;padding:24px 12px;background:#07101A;color:#fff;font-family:${FONT};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#0D1A26;border:1px solid rgba(255,255,255,.16);border-radius:15px;overflow:hidden;">
<tr><td style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,.10);"><span style="display:inline-block;width:24px;height:24px;border-radius:7px;background:#3C7AFF;vertical-align:middle;"></span><span style="padding-left:10px;font-size:13px;font-weight:700;letter-spacing:.02em;vertical-align:middle;">ORGANIZATECH</span></td></tr>
<tr><td style="padding:28px 24px;"><h1 style="Margin:0 0 12px;font-family:${FONT};font-size:18px;line-height:1.4;">${escapeHtml(heading)}</h1>
<p style="Margin:0 0 20px;font-size:14px;line-height:1.6;color:rgba(255,255,255,.70);">Hola ${escapeHtml(firstName)},<br><br>${htmlSentences}</p>
<a href="${escapeHtml(actionUrl)}" role="button" style="display:inline-block;background:#3C7AFF;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:11px;">${escapeHtml(cta)}</a>
<p style="Margin:20px 0 0;font-size:11px;line-height:1.5;color:rgba(255,255,255,.38);">${escapeHtml(footer)}</p></td></tr>
</table></td></tr></table></body></html>`;

  return {
    subject,
    htmlContent,
    textContent: [
      "ORGANIZATECH", "", heading, "", `Hola ${firstName},`, "", sentences.join(" "), "",
      `${cta}: ${actionUrl}`, "", footer,
    ].join("\n"),
  };
}
