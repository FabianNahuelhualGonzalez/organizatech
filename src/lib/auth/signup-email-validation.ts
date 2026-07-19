const blockedSignupDomains = new Set([
  "example.com",
  "example.cl",
  "test.com",
  "test.cl",
  "fake.com",
  "fake.cl",
  "prueba.com",
  "demo.com",
  "dominio.com",
  "correo.com",
  "email.com",
  "mailinator.com",
  "yopmail.com",
  "tempmail.com",
  "10minutemail.com",
]);

const blockedSignupLocalParts = new Set([
  "test",
  "prueba",
  "fake",
  "demo",
  "usuario",
  "user",
  "asd",
  "aaa",
  "qwe",
  "correo",
  "email",
]);

export function isValidSignupEmailFormat(email: string): boolean {
  if (email.length < 6 || email.length > 254) return false;
  if ((email.match(/@/g) ?? []).length !== 1) return false;

  const [localPart, domain] = email.split("@");
  if (!localPart || !domain || localPart.length > 64) return false;
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;

  const labels = domain.split(".");
  const extension = labels.at(-1) ?? "";
  if (labels.length < 2 || extension.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) return false;

  return true;
}

export function validateSignupEmail(rawEmail: string): string | null {
  const email = rawEmail.trim().toLowerCase();
  if (/\s/.test(rawEmail)) return "El correo no debe contener espacios.";
  if (!isValidSignupEmailFormat(email)) return "Ingresa un correo válido para poder confirmar tu cuenta.";

  const [localPart, domain] = email.split("@");
  if (blockedSignupDomains.has(domain) || blockedSignupLocalParts.has(localPart)) {
    return "No uses correos de prueba. Necesitamos un correo real para confirmar tu cuenta.";
  }

  return null;
}
