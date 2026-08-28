export type OrganizatechEmailTemplateKind =
  | "confirmation_user"
  | "confirmation_coach"
  | "welcome_user"
  | "welcome_coach";

export type NeutralAuthEmailAction =
  | "signup"
  | "recovery"
  | "magiclink"
  | "invite"
  | "email_change"
  | "email"
  | "reauthentication"
  | "password_changed_notification"
  | "email_changed_notification"
  | "phone_changed_notification"
  | "identity_linked_notification"
  | "identity_unlinked_notification"
  | "mfa_factor_enrolled_notification"
  | "mfa_factor_unenrolled_notification";

interface EmailTemplateBaseInput {
  actionUrl: string;
  firstName?: string | null;
  lastName?: string | null;
  verificationCode?: string | null;
}

export interface OrganizatechEmailTemplateInput extends EmailTemplateBaseInput {
  kind: OrganizatechEmailTemplateKind;
}

export interface NeutralAuthEmailTemplateInput extends EmailTemplateBaseInput {
  kind: "auth_fallback";
  action: NeutralAuthEmailAction;
}

export type EmailTemplateInput =
  | OrganizatechEmailTemplateInput
  | NeutralAuthEmailTemplateInput;

export interface RenderedEmailTemplate {
  subject: string;
  htmlContent: string;
  textContent: string;
}

interface EmailCopy {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: readonly string[];
  ctaLabel: string;
  closing: string;
}

const BRAND_BACKGROUND = "#07101A";
const BRAND_BLUE = "#3C7AFF";
const FONT_STACK = "'Roboto Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

const ORGANIZATECH_COPY: Record<OrganizatechEmailTemplateKind, EmailCopy> = {
  confirmation_user: {
    subject: "Confirma tu cuenta de Usuario en Organizatech",
    preheader: "Sólo falta un paso para activar tu cuenta de Usuario.",
    eyebrow: "CONFIRMACIÓN DE CUENTA · USUARIO",
    heading: "Sólo falta un paso",
    paragraphs: [
      "Confirma tu cuenta de Usuario para completar tu registro en Organizatech.",
      "Este enlace es personal. Si no solicitaste esta cuenta, puedes ignorar este correo.",
    ],
    ctaLabel: "Confirmar mi cuenta",
    closing: "Nos vemos en Organizatech.",
  },
  confirmation_coach: {
    subject: "Confirma tu cuenta de Coach en Organizatech",
    preheader: "Sólo falta un paso para activar tu cuenta de Coach.",
    eyebrow: "CONFIRMACIÓN DE CUENTA · COACH",
    heading: "Sólo falta un paso",
    paragraphs: [
      "Confirma tu cuenta de Coach para completar tu registro en Organizatech.",
      "Este enlace es personal. Si no solicitaste esta cuenta, puedes ignorar este correo.",
    ],
    ctaLabel: "Confirmar mi cuenta",
    closing: "Nos vemos en Organizatech.",
  },
  welcome_user: {
    subject: "Bienvenido a Organizatech",
    preheader: "Tu espacio de organización, hábitos, planificación y seguimiento ya está listo.",
    eyebrow: "BIENVENIDA · USUARIO",
    heading: "Te damos la bienvenida a Organizatech",
    paragraphs: [
      "Organizatech reúne la organización de tus hábitos, la planificación de tus entrenamientos y el seguimiento de tu progreso en un solo lugar.",
      "Empieza con un objetivo claro, construye una rutina sostenible y revisa tus avances cuando lo necesites.",
    ],
    ctaLabel: "Ir a Organizatech",
    closing: "Tu próximo paso comienza hoy.",
  },
  welcome_coach: {
    subject: "Bienvenido a Organizatech Coach",
    preheader: "Tu espacio Coach para alumnos, planificación e historial ya está listo.",
    eyebrow: "BIENVENIDA · COACH",
    heading: "Te damos la bienvenida a Organizatech Coach",
    paragraphs: [
      "Realiza el seguimiento de tus alumnos, planifica sus entrenamientos y consulta su historial desde un solo lugar.",
      "Organizatech te ayuda a reducir el trabajo operativo para que puedas dedicar más tiempo a acompañar su progreso.",
    ],
    ctaLabel: "Abrir Organizatech Coach",
    closing: "Tu trabajo, más claro y organizado.",
  },
};

const NEUTRAL_AUTH_COPY: Record<NeutralAuthEmailAction, EmailCopy> = {
  signup: {
    subject: "Confirma tu cuenta de Organizatech",
    preheader: "Sólo falta un paso para activar tu cuenta.",
    eyebrow: "CONFIRMACIÓN DE CUENTA",
    heading: "Sólo falta un paso",
    paragraphs: [
      "Confirma tu cuenta para completar tu registro en Organizatech.",
      "Este enlace es personal. Si no solicitaste esta cuenta, puedes ignorar este correo.",
    ],
    ctaLabel: "Confirmar mi cuenta",
    closing: "Nos vemos en Organizatech.",
  },
  recovery: {
    subject: "Restablece tu contraseña de Organizatech",
    preheader: "Usa este enlace para recuperar el acceso a tu cuenta.",
    eyebrow: "SEGURIDAD DE CUENTA",
    heading: "Recupera tu acceso",
    paragraphs: [
      "Recibimos una solicitud para restablecer la contraseña de tu cuenta de Organizatech.",
      "Si no hiciste esta solicitud, puedes ignorar este correo.",
    ],
    ctaLabel: "Restablecer contraseña",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  magiclink: {
    subject: "Ingresa a Organizatech",
    preheader: "Usa este enlace seguro para ingresar a tu cuenta.",
    eyebrow: "ACCESO A ORGANIZATECH",
    heading: "Tu enlace de acceso está listo",
    paragraphs: [
      "Usa el siguiente enlace para ingresar a Organizatech.",
      "Si no solicitaste este acceso, puedes ignorar este correo.",
    ],
    ctaLabel: "Ingresar a Organizatech",
    closing: "Este enlace es personal.",
  },
  invite: {
    subject: "Te invitaron a Organizatech",
    preheader: "Acepta la invitación para comenzar.",
    eyebrow: "INVITACIÓN",
    heading: "Tienes una invitación",
    paragraphs: [
      "Te invitaron a crear una cuenta en Organizatech.",
      "Acepta la invitación con el siguiente enlace seguro.",
    ],
    ctaLabel: "Aceptar invitación",
    closing: "Nos vemos en Organizatech.",
  },
  email_change: {
    subject: "Confirma tu nuevo correo de Organizatech",
    preheader: "Confirma el cambio de correo de tu cuenta.",
    eyebrow: "SEGURIDAD DE CUENTA",
    heading: "Confirma tu nuevo correo",
    paragraphs: [
      "Usa el siguiente enlace para confirmar el cambio de correo de tu cuenta de Organizatech.",
      "Si no solicitaste este cambio, protege tu cuenta y no continúes.",
    ],
    ctaLabel: "Confirmar nuevo correo",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  email: {
    subject: "Confirma tu acceso a Organizatech",
    preheader: "Usa este enlace seguro para continuar.",
    eyebrow: "ACCESO A ORGANIZATECH",
    heading: "Confirma tu acceso",
    paragraphs: [
      "Usa el siguiente enlace seguro para continuar en Organizatech.",
      "Si no solicitaste este acceso, puedes ignorar este correo.",
    ],
    ctaLabel: "Continuar en Organizatech",
    closing: "Este enlace es personal.",
  },
  reauthentication: {
    subject: "Confirma que eres tú en Organizatech",
    preheader: "Confirma tu identidad para continuar.",
    eyebrow: "SEGURIDAD DE CUENTA",
    heading: "Confirma que eres tú",
    paragraphs: [
      "Ingresa el código de verificación para confirmar tu identidad antes de continuar con una acción protegida.",
      "Si no reconoces esta solicitud, puedes ignorar este correo.",
    ],
    ctaLabel: "Código de verificación",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  password_changed_notification: {
    subject: "Tu contraseña de Organizatech fue actualizada",
    preheader: "Aviso de seguridad de tu cuenta.",
    eyebrow: "AVISO DE SEGURIDAD",
    heading: "Tu contraseña fue actualizada",
    paragraphs: [
      "La contraseña de tu cuenta de Organizatech cambió recientemente.",
      "Si no reconoces este cambio, revisa tu cuenta de inmediato.",
    ],
    ctaLabel: "Revisar mi cuenta",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  email_changed_notification: {
    subject: "El correo de tu cuenta fue actualizado",
    preheader: "Aviso de seguridad de tu cuenta Organizatech.",
    eyebrow: "AVISO DE SEGURIDAD",
    heading: "Tu correo fue actualizado",
    paragraphs: [
      "El correo de acceso de tu cuenta de Organizatech cambió recientemente.",
      "Si no reconoces este cambio, revisa tu cuenta de inmediato.",
    ],
    ctaLabel: "Revisar mi cuenta",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  phone_changed_notification: {
    subject: "El teléfono de tu cuenta fue actualizado",
    preheader: "Aviso de seguridad de tu cuenta Organizatech.",
    eyebrow: "AVISO DE SEGURIDAD",
    heading: "Tu teléfono fue actualizado",
    paragraphs: [
      "El teléfono asociado a tu cuenta de Organizatech cambió recientemente.",
      "Si no reconoces este cambio, revisa tu cuenta de inmediato.",
    ],
    ctaLabel: "Revisar mi cuenta",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  identity_linked_notification: {
    subject: "Se vinculó una identidad a tu cuenta",
    preheader: "Aviso de seguridad de tu cuenta Organizatech.",
    eyebrow: "AVISO DE SEGURIDAD",
    heading: "Nueva identidad vinculada",
    paragraphs: [
      "Se vinculó un nuevo método de acceso a tu cuenta de Organizatech.",
      "Si no reconoces esta acción, revisa tu cuenta de inmediato.",
    ],
    ctaLabel: "Revisar mi cuenta",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  identity_unlinked_notification: {
    subject: "Se desvinculó una identidad de tu cuenta",
    preheader: "Aviso de seguridad de tu cuenta Organizatech.",
    eyebrow: "AVISO DE SEGURIDAD",
    heading: "Identidad desvinculada",
    paragraphs: [
      "Se desvinculó un método de acceso de tu cuenta de Organizatech.",
      "Si no reconoces esta acción, revisa tu cuenta de inmediato.",
    ],
    ctaLabel: "Revisar mi cuenta",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  mfa_factor_enrolled_notification: {
    subject: "Se activó un factor de seguridad",
    preheader: "Aviso de seguridad de tu cuenta Organizatech.",
    eyebrow: "AVISO DE SEGURIDAD",
    heading: "Nuevo factor de seguridad",
    paragraphs: [
      "Se activó un factor adicional de autenticación en tu cuenta de Organizatech.",
      "Si no reconoces esta acción, revisa tu cuenta de inmediato.",
    ],
    ctaLabel: "Revisar mi cuenta",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
  mfa_factor_unenrolled_notification: {
    subject: "Se desactivó un factor de seguridad",
    preheader: "Aviso de seguridad de tu cuenta Organizatech.",
    eyebrow: "AVISO DE SEGURIDAD",
    heading: "Factor de seguridad desactivado",
    paragraphs: [
      "Se desactivó un factor adicional de autenticación de tu cuenta de Organizatech.",
      "Si no reconoces esta acción, revisa tu cuenta de inmediato.",
    ],
    ctaLabel: "Revisar mi cuenta",
    closing: "Protege siempre el acceso a tu cuenta.",
  },
};

export function escapeEmailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeNamePart(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayName(input: EmailTemplateBaseInput) {
  return [normalizeNamePart(input.firstName), normalizeNamePart(input.lastName)]
    .filter(Boolean)
    .join(" ");
}

function normalizeActionUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("La URL de acción del correo no es válida.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("La URL de acción del correo no es segura.");
  }
  return url.toString();
}

function normalizeVerificationCode(value: string | null | undefined) {
  const code = (value ?? "").trim();
  if (!/^[0-9]{6,10}$/.test(code)) {
    throw new TypeError("El código de verificación del correo no es válido.");
  }
  return code;
}

function resolveCopy(input: EmailTemplateInput) {
  return input.kind === "auth_fallback"
    ? NEUTRAL_AUTH_COPY[input.action]
    : ORGANIZATECH_COPY[input.kind];
}

function renderParagraphs(paragraphs: readonly string[]) {
  return paragraphs.map((paragraph) => (
    `<p style="Margin:0 0 16px;color:#C9D5E3;font-family:${FONT_STACK};font-size:15px;line-height:1.7;">${escapeEmailHtml(paragraph)}</p>`
  )).join("");
}

export function renderEmailTemplate(input: EmailTemplateInput): RenderedEmailTemplate {
  const copy = resolveCopy(input);
  const name = displayName(input);
  const greetingText = name ? `Hola, ${name}.` : "Hola.";
  const greetingHtml = escapeEmailHtml(greetingText);
  const isReauthentication = input.kind === "auth_fallback"
    && input.action === "reauthentication";
  const verificationCode = isReauthentication
    ? normalizeVerificationCode(input.verificationCode)
    : null;
  const actionUrl = isReauthentication ? null : normalizeActionUrl(input.actionUrl);
  const escapedActionUrl = actionUrl ? escapeEmailHtml(actionUrl) : null;
  const escapedCtaLabel = escapeEmailHtml(copy.ctaLabel);
  const actionBlock = verificationCode
    ? `<p aria-label="Código de verificación" style="Margin:28px 0 30px;padding:16px 20px;border:1px solid ${BRAND_BLUE};border-radius:10px;background-color:#0B1524;color:#F5F7FB;font-family:${FONT_STACK};font-size:26px;font-weight:700;letter-spacing:0.18em;line-height:1.2;text-align:center;">${escapeEmailHtml(verificationCode)}</p>`
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;Margin:28px 0 30px;">
                <tr>
                  <td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:10px;background-color:${BRAND_BLUE};">
                    <a class="email-cta" href="${escapedActionUrl}" aria-label="${escapedCtaLabel}" role="button" style="display:inline-block;padding:15px 22px;color:#FFFFFF;font-family:${FONT_STACK};font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;border-radius:10px;">${escapedCtaLabel}</a>
                  </td>
                </tr>
              </table>`;

  const htmlContent = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeEmailHtml(copy.subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-card { border-radius: 16px !important; }
      .email-padding { padding: 32px 22px !important; }
      .email-heading { font-size: 26px !important; }
      .email-cta { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="Margin:0;padding:0;background-color:${BRAND_BACKGROUND};color:#F5F7FB;font-family:${FONT_STACK};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeEmailHtml(copy.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background-color:${BRAND_BACKGROUND};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background-color:#111827;border:1px solid #243246;border-radius:24px;overflow:hidden;">
          <tr>
            <td style="height:6px;background-color:${BRAND_BLUE};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td class="email-padding" style="padding:44px 42px;">
              <p style="Margin:0 0 28px;color:${BRAND_BLUE};font-family:${FONT_STACK};font-size:18px;font-weight:700;letter-spacing:0.04em;">ORGANIZATECH</p>
              <p style="Margin:0 0 12px;color:#8FA4BC;font-family:${FONT_STACK};font-size:12px;font-weight:700;letter-spacing:0.12em;line-height:1.5;">${escapeEmailHtml(copy.eyebrow)}</p>
              <h1 class="email-heading" style="Margin:0 0 24px;color:#F5F7FB;font-family:${FONT_STACK};font-size:30px;font-weight:700;letter-spacing:-0.03em;line-height:1.25;">${escapeEmailHtml(copy.heading)}</h1>
              <p style="Margin:0 0 16px;color:#F5F7FB;font-family:${FONT_STACK};font-size:15px;font-weight:700;line-height:1.7;">${greetingHtml}</p>
              ${renderParagraphs(copy.paragraphs)}
              ${actionBlock}
              <p style="Margin:0;color:#8FA4BC;font-family:${FONT_STACK};font-size:13px;line-height:1.6;">${escapeEmailHtml(copy.closing)}</p>
            </td>
          </tr>
        </table>
        <p style="Margin:18px 0 0;color:#71839A;font-family:${FONT_STACK};font-size:11px;line-height:1.6;text-align:center;">Correo transaccional de Organizatech · Sin seguimiento publicitario</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textContent = [
    "ORGANIZATECH",
    copy.eyebrow,
    "",
    copy.heading,
    greetingText,
    "",
    ...copy.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    verificationCode
      ? `Código de verificación: ${verificationCode}`
      : `${copy.ctaLabel}: ${actionUrl}`,
    "",
    copy.closing,
    "",
    "Correo transaccional de Organizatech. Sin seguimiento publicitario.",
  ].join("\n");

  return {
    subject: copy.subject,
    htmlContent,
    textContent,
  };
}

export function renderNeutralAuthEmail(
  input: Omit<NeutralAuthEmailTemplateInput, "kind">,
) {
  return renderEmailTemplate({ ...input, kind: "auth_fallback" });
}
