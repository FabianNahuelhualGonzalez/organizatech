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
