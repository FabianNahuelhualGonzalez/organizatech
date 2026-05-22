export function translateAuthError(error: unknown) {
  const message = readAuthErrorMessage(error).toLowerCase();

  if (!message) return "No pudimos completar la acción. Intenta nuevamente.";
  if (message.includes("sesión expiró") || message.includes("session expired") || message.includes("jwt expired")) {
    return "Tu sesión expiró. Inicia sesión nuevamente.";
  }
  if (message.includes("debes iniciar sesión") || message.includes("auth session missing")) {
    return "Debes iniciar sesión para continuar.";
  }
  if (message.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (message.includes("email not confirmed")) return "Debes confirmar tu correo antes de iniciar sesión.";
  if (message.includes("user already registered") || message.includes("already registered")) {
    return "Este correo ya está registrado. Intenta iniciar sesión.";
  }
  if (message.includes("rate limit") || message.includes("over_email_send_rate_limit")) {
    return "Se alcanzó el límite de intentos por ahora. Espera unos minutos e intenta nuevamente.";
  }
  if (message.includes("password should be at least") || message.includes("password")) {
    return "La contraseña debe tener al menos 8 caracteres.";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("failed to fetch")) {
    return "No pudimos conectar con el servidor. Intenta nuevamente.";
  }

  return "No pudimos completar la acción. Intenta nuevamente.";
}

export function translatePersistenceError(error: unknown) {
  const message = readAuthErrorMessage(error).toLowerCase();

  if (isSessionExpiredError(error)) return "Tu sesión expiró. Inicia sesión nuevamente.";
  if (message.includes("debes iniciar sesión") || message.includes("auth session missing")) {
    return "Debes iniciar sesión para continuar.";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("failed to fetch")) {
    return "No pudimos completar la acción. Revisa tu conexión e intenta nuevamente.";
  }
  if (message.includes("supabase")) return "No pudimos completar la acción. Intenta nuevamente.";

  return readAuthErrorMessage(error) || "No pudimos completar la acción. Intenta nuevamente.";
}

export function isSessionExpiredError(error: unknown) {
  const message = readAuthErrorMessage(error).toLowerCase();
  return message.includes("sesión expiró") || message.includes("session expired") || message.includes("jwt expired");
}

function readAuthErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error ?? "");
}
