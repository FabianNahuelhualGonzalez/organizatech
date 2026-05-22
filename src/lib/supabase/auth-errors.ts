export function translateAuthError(error: unknown) {
  const message = readAuthErrorMessage(error).toLowerCase();

  if (!message) return "Ocurrió un problema al autenticar. Intenta nuevamente.";
  if (message.includes("sesión expiró") || message.includes("session expired") || message.includes("jwt expired")) {
    return "Tu sesión expiró. Inicia sesión nuevamente para continuar.";
  }
  if (message.includes("debes iniciar sesión") || message.includes("auth session missing")) {
    return "Debes iniciar sesión para guardar tus datos.";
  }
  if (message.includes("invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (message.includes("email not confirmed")) return "Debes confirmar tu correo antes de iniciar sesión.";
  if (message.includes("user already registered") || message.includes("already registered")) {
    return "Este correo ya está registrado.";
  }
  if (message.includes("password should be at least") || message.includes("password")) {
    return "La contraseña no cumple con el mínimo requerido.";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("failed to fetch")) {
    return "No pudimos conectar con el servidor. Intenta nuevamente.";
  }

  return "Ocurrió un problema al autenticar. Intenta nuevamente.";
}

export function translatePersistenceError(error: unknown) {
  const message = readAuthErrorMessage(error).toLowerCase();

  if (isSessionExpiredError(error)) return "Tu sesión expiró. Inicia sesión nuevamente para continuar.";
  if (message.includes("debes iniciar sesión") || message.includes("auth session missing")) {
    return "Debes iniciar sesión para guardar tus datos.";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("failed to fetch")) {
    return "No pudimos guardar los datos en la nube. Revisa tu conexión e intenta nuevamente.";
  }

  return readAuthErrorMessage(error) || "No pudimos guardar los datos. Intenta nuevamente.";
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
