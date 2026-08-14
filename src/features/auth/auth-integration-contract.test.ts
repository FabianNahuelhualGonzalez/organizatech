import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

const landing = readSource("src/app/page.tsx");
const loginPage = readSource("src/app/login/page.tsx");
const authEntry = readSource("src/features/auth/components/auth-entry-client.tsx");
const root = readSource("src/components/organizatech-app.tsx");
const authScreen = readSource("src/features/auth/components/auth-screen.tsx");
const authStyles = readSource("src/features/auth/components/auth-screen.module.css");
const authRouteController = readSource("src/features/auth/hooks/use-auth-route-controller.ts");

// Landing: cada intención entra al modo y tipo de cuenta autorizados.
assert.match(landing, /className=\{styles\.headerCta\} href="\/login"/);
assert.equal(
  landing.match(/href="\/login\?mode=registro&amp;tipo=usuario"/g)?.length ?? 0,
  0,
  "El JSX debe conservar '&' literal; Next se encarga del escape HTML.",
);
assert.equal(landing.match(/href="\/login\?mode=registro&tipo=usuario"/g)?.length, 2);
assert.match(landing, /className=\{styles\.coachCta\} href="\/login\?mode=registro&tipo=coach"/);

// Entrada estable: /login permanece estática y delega searchParams a una frontera cliente con Suspense.
assert.match(loginPage, /<Suspense fallback=\{<main className="app-shell"><AuthLoadingScreen \/><\/main>\}>/);
assert.doesNotMatch(loginPage, /searchParams|async function Home/);
assert.match(authEntry, /useSearchParams\(\)/);
assert.match(authEntry, /resolveAuthRouteState\(\{/);
assert.match(authEntry, /initialAuthRoute=\{initialAuthRoute\}/);
assert.match(root, /resolveInitialAuthState\(initialPasswordRecoveryRouteState, initialAuthRoute\.mode\)/);
assert.match(authRouteController, /window\.history\.replaceState\(/);
assert.match(authRouteController, /createAuthHref\(nextRoute\)/);

// Composition root: sólo integra la feature; la presentación ya no vive dentro del root.
assert.match(root, /import \{[\s\S]*?AuthScreen,[\s\S]*?\} from "@\/features\/auth\/components\/auth-screen";/);
assert.doesNotMatch(root, /function AuthScreen\(/);
assert.match(root, /buildLoginPayload\(formData\)/);
assert.match(root, /buildUserSignupPayload\(formData\)/);
assert.match(root, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
assert.match(root, /supabase\.auth\.signUp\(signupPayload\)/);
assert.match(root, /loginSubmitOwnerController\.acquire\(\)/);
assert.match(root, /resetPasswordForEmail\(email, \{ redirectTo \}\)/);
assert.doesNotMatch(root, /className="login-shell"|Validando sesión<\/h2>/);
assert.match(root, /<AuthLoadingScreen \/>/);
for (const flowScreen of ["PasswordRecoveryScreen", "RecoveryExpiredScreen", "NewPasswordScreen"]) {
  assert.ok(authScreen.includes(`export function ${flowScreen}`));
}

// Presentación y accesibilidad de login/registro.
for (const marker of [
  "Tipo de cuenta",
  'role="tablist"',
  'role="tab"',
  "aria-selected",
  "Correo electrónico",
  "Contraseña",
  "¿Olvidaste tu contraseña?",
  "Continuar con Google",
  "¿No tienes cuenta? Crea una",
  "Nombre",
  "Apellido",
  "Fecha de nacimiento",
  "Edad",
  "Género",
  "Celular",
  "Correo",
  "Confirmar contraseña",
  "Título de estudios",
  "¿Ya tienes cuenta? Iniciar sesión",
]) {
  assert.ok(authScreen.includes(marker), `Falta el contrato visible/accesible: ${marker}`);
}

assert.match(authScreen, /<Image[^>]+src="\/icon\.svg"/);
assert.match(authScreen, /id="register-age" value=\{age \?\? ""\}[^>]+readOnly/);
assert.doesNotMatch(authScreen, /id="register-age"[^>]+name=/);
assert.match(authScreen, /COACH_REGISTRATION_SUBMIT_ENABLED/);
assert.match(authScreen, /disabled=\{isBusy \|\| \(isCoachRegistration && !COACH_REGISTRATION_SUBMIT_ENABLED\)\}/);
assert.doesNotMatch(authScreen, /auth-tab-coach[\s\S]{0,300}disabled/);
assert.match(authScreen, /aria-label="Continuar con Google \(no disponible\)"[\s\S]*?disabled/);
assert.doesNotMatch(authScreen, /Apple|aria-label="Correo"/);
assert.doesNotMatch(authScreen, /dangerouslySetInnerHTML/);
assert.doesNotMatch(authScreen, /email@email\.com/);
assert.match(authScreen, /placeholder="nombre@organizatech\.cl"/);

// Errores de campo: asociación individual, invalidación y status general con tono semántico.
assert.match(authScreen, /aria-describedby=\{errorId\}/);
assert.match(authScreen, /aria-invalid=\{Boolean\(error\)\}/);
assert.match(authScreen, /<FieldError id=\{`\$\{id\}-error`\} message=\{error\} \/>/);
assert.match(authScreen, /role=\{tone === "error" \? "alert" : "status"\}/);
assert.doesNotMatch(authScreen, /aria-describedby=\{statusId\}/);

// Contraste AA mínimo para texto pequeño sobre las superficies aprobadas.
for (const [foreground, background, label] of [
  ["#b6c0cc", "#27313d", "tab inactivo y ayudas"],
  ["#bdc6d1", "#27313d", "botón inferior"],
  ["#aeb8c5", "#27313d", "placeholders"],
  ["#c0c8d2", "#27313d", "edad read-only"],
  ["#aab4c1", "#07101a", "separador"],
] as const) {
  assert.ok(authStyles.toLowerCase().includes(foreground), `Falta el color de ${label}`);
  assert.ok(contrastRatio(foreground, background) >= 4.5, `${label} no alcanza WCAG AA`);
}

console.log("auth-integration contract tests passed");

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/../g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
