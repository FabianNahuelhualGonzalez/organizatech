import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import { SIGNUP_CONFIRMATION_INVALID_MESSAGE } from "@/features/auth/model/multiportal-auth-controller";

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

const COACH_CONTRACT_RUNNER_PATH =
  "src/features/auth/multiportal-auth-integration-contract.test.ts";
const COACH_INTEGRATION_CONTRACT_SPECIFIER =
  "@/features/coach-portal/coach-portal-integration-contract";
const COACH_MODEL_CONTRACT_SPECIFIER =
  "@/features/coach-portal/model/coach-portal.contract";
const COACH_INTEGRATION_IMPORT_FAILURE =
  "[AUTH-COACH-01.runner-import.integration-contract]";
const COACH_MODEL_IMPORT_FAILURE = "[AUTH-COACH-01.runner-import.model-contract]";

// Deuda contractual LOW no bloqueante: este guard focal no amplía la auditoría a los
// anclajes literales históricos de Auth; su eventual endurecimiento queda fuera de alcance.
const coachContractRunner = readSource(COACH_CONTRACT_RUNNER_PATH);
assertCoachContractRunnerImports(coachContractRunner);
runCoachContractRunnerPositiveControls(coachContractRunner);
runCoachContractRunnerMutationProbes(coachContractRunner);

const landing = readSource("src/app/page.tsx");
const loginPage = readSource("src/app/login/page.tsx");
const authEntry = readSource("src/features/auth/components/auth-entry-client.tsx");
const root = readSource("src/components/organizatech-app.tsx");
const authScreen = readSource("src/features/auth/components/auth-screen.tsx");
const authStyles = readSource("src/features/auth/components/auth-screen.module.css");
const authRouteController = readSource("src/features/auth/hooks/use-auth-route-controller.ts");
const authCallback = readSource("src/features/auth/model/auth-callback.ts");
const multiportalController = readSource("src/features/auth/model/multiportal-auth-controller.ts");
const multiportalGateway = readSource("src/features/auth/data/supabase-multiportal-auth-gateway.ts");
const multiportalBoundary = readSource("src/features/auth/hooks/use-multiportal-auth-boundary.ts");
const registrationFormController = readSource(
  "src/features/auth/model/auth-registration-form-controller.ts",
);
const registrationFormHook = readSource(
  "src/features/auth/hooks/use-auth-registration-form-controller.ts",
);
const authConfirmationDesign = readSource("docs/product/auth-confirmation-recovery-design.md");
const environmentsDesign = readSource("docs/ambientes.md");
const signupConfirmationController = multiportalController.slice(
  multiportalController.indexOf("async function resolveSignupConfirmation"),
  multiportalController.indexOf("async function rejectPortalSession"),
);

test("AUTH-HYBRID-01 mantiene revisión/reset dentro de Auth y fuera del root", () => {
  auditRegistrationOwnership({
    root,
    screen: authScreen,
    controller: registrationFormController,
    hook: registrationFormHook,
  });
});

test("AUTH-HYBRID-01 mata mutantes focales de revisión, owner y selector", () => {
  runRegistrationOwnershipMutationProbes({
    root,
    screen: authScreen,
    controller: registrationFormController,
    hook: registrationFormHook,
  });
});

test("AUTH-HYBRID-01 mata por conducta los mutantes de elegibilidad shared", () => {
  runSharedCoachEligibilityBehaviorMutationProbes(registrationFormController);
});

test("AUTH-HYBRID-01 coordina por conducta el resultado tipado del login Coach compartido", async () => {
  const authorized = await runSharedCoachLoginRootHarness({
    state: "authorized",
    userId: "user-a",
  });
  assert.deepEqual(authorized.appliedSessions, ["user-a"]);
  assert.deepEqual(authorized.routes, [{ mode: "registro", accountType: "coach" }]);
  assert.deepEqual(authorized.navigations, [{ mode: "registro", reason: "auth-screen-switch" }]);
  assert.deepEqual(authorized.statuses, [{ message: "", tone: "info" }]);
  assert.equal(authorized.continuation, undefined);

  for (const state of ["rejected", "error"] as const) {
    const rejected = await runSharedCoachLoginRootHarness({
      state,
      message: "No pudimos completar la acción. Intenta nuevamente.",
    });
    assert.deepEqual(rejected.appliedSessions, [], `${state}: no publica sesión`);
    assert.deepEqual(rejected.routes, [], `${state}: no cambia ruta`);
    assert.deepEqual(rejected.navigations, [], `${state}: no navega ni abre portal`);
    assert.deepEqual(rejected.statuses, [{
      message: "No pudimos completar la acción. Intenta nuevamente.",
      tone: "error",
    }]);
    assert.equal(rejected.signOutNoticeSettlements, 1);
    assert.equal(rejected.continuation, undefined);
  }

  for (const state of ["stale", "busy"] as const) {
    const ignored = await runSharedCoachLoginRootHarness({ state });
    assert.deepEqual(ignored.appliedSessions, [], `${state}: no publica sesión`);
    assert.deepEqual(ignored.routes, [], `${state}: no cambia ruta`);
    assert.deepEqual(ignored.navigations, [], `${state}: no navega`);
    assert.deepEqual(ignored.statuses, [], `${state}: no publica respuesta ajena`);
  }

  const normalLogin = await runSharedCoachLoginRootHarness(
    { state: "stale" },
    false,
  );
  assert.equal(normalLogin.completionCalls, 0);
  assert.equal(normalLogin.continuation, "normal_login");

  const continuation = focalSourceBetween(
    root,
    "if (registrationForm.controller.getState().sharedCoachLoginPending) {",
    "portalResolutionOwner = multiportalAuth.beginPortalResolution",
  );
  assert.doesNotMatch(continuation, /supabase\.auth\.signOut|continueAuthorizedPortalAccess/);
  assert.match(multiportalController, /completeSharedCoachLogin\([\s\S]*?gateway\.signOut\("authorization_error", owner\)/);
  assert.match(multiportalBoundary, /existing\?\.expectedUserId === expectedUserId[\s\S]*?return existing\.operation/);
});

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
assert.match(root, /buildCoachRegistrationPayload\(formData\)/);
assert.match(root, /buildSharedCoachRegistrationPayload\(formData\)/);
assert.match(root, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
assert.doesNotMatch(multiportalController, /signInForCoachRegistration/);
assert.doesNotMatch(multiportalGateway, /signInForCoachRegistration/);
assert.match(multiportalGateway, /createSharedCoachRegistration[\s\S]*rpc\("register_own_coach"/);
assert.match(multiportalController, /gateway\.signUpForCoachRegistration\(input, owner\)/);
assert.match(root, /multiportalAuth\.registerUser\(\s*signupPayload,/);
assert.doesNotMatch(root, /supabase\.auth\.signUp\(signupPayload\)/);
assert.match(root, /authorizeAndContinuePortalSession\(/);
assert.match(root, /continueAuthorizedPortalAccess\(/);
assert.match(root, /loginSubmitOwnerController\.acquire\(\)/);
assert.match(root, /resetPasswordForEmail\(email, \{ redirectTo \}\)/);
assert.doesNotMatch(root, /className="login-shell"|Validando sesión<\/h2>/);
assert.match(root, /<AuthLoadingScreen \/>/);
for (const flowScreen of ["PasswordRecoveryScreen", "RecoveryExpiredScreen", "NewPasswordScreen"]) {
  assert.ok(authScreen.includes(`export function ${flowScreen}`));
}

// AUTH-CONFIRM-01: callback cerrado, portal backend y coalescing de eventos.
assert.match(authCallback, /export const AUTH_CALLBACK_PATH = "\/login"/);
assert.match(authCallback, /target\.origin !== source\.origin \|\| target\.pathname !== AUTH_CALLBACK_PATH/);
assert.match(authCallback, /input\.evidence\.flow !== SIGNUP_CONFIRMATION_FLOW/);
assert.match(authCallback, /input\.event === "PASSWORD_RECOVERY"/);
assert.match(authCallback, /input\.callbackAccessToken !== input\.sessionAccessToken/);
assert.doesNotMatch(authCallback, /portal|professional_title|phone_number|birth_date/);
assert.doesNotMatch(multiportalGateway, /prepare_auth_registration_intent/);
assert.match(multiportalGateway, /withSignupConfirmationMetadata/);
assert.match(multiportalGateway, /organizatech_registration_portal|portal: "coach"/);
assert.match(multiportalGateway, /get_own_auth_registration_confirmation/);
assert.match(multiportalGateway, /getBrowserAuthCallbackUrl\(SIGNUP_CONFIRMATION_FLOW\)/);
assert.match(multiportalGateway, /signOut\(\{ scope: "local" \}\)/);
assert.match(multiportalController, /confirmation\.portal === "coach"/);
assert.doesNotMatch(signupConfirmationController, /input\.requestedPortal/);
assert.match(
  multiportalBoundary,
  /existing\?\.operation && existing\.expectedUserId === expectedUserId[\s\S]*?return existing\.operation/,
);
assert.match(
  multiportalBoundary,
  /pendingSignupConfirmation && settleSignupConfirmation\("signed_out"\)[\s\S]*?return "complete_signup_confirmation"/,
);
assert.match(root, /getBrowserAuthCallbackUrl\(PASSWORD_RECOVERY_FLOW\)/);
assert.match(root, /clearSignupConfirmationUrl\(\)/);
assert.match(root, /result === "stale"[\s\S]*?invalidateSignupConfirmation\(\)/);
assertSignupConfirmationCleanupOrder(root);
test("error de signOut limpia el fragmento y publica sólo estado controlado", async () => {
  await assertSignupConfirmationSignOutFailureIsContained(root);
});
assert.doesNotMatch(`${authConfirmationDesign}\n${environmentsDesign}`, /https:\/\/\*\.vercel\.app\/\*\*/);
assert.match(environmentsDesign, /https:\/\/\*-<team-or-account-slug>\.vercel\.app\/\*\*/);

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
  "Correo de acceso Coach",
  "Correo de contacto",
  "Confirmar contraseña",
  "Título de estudios",
  "¿Ya tienes cuenta? Iniciar sesión",
]) {
  assert.ok(authScreen.includes(marker), `Falta el contrato visible/accesible: ${marker}`);
}

assert.match(authScreen, /<Image[^>]+src="\/icon\.svg"/);
assertAuthRegistrationInputContract(authScreen);
runAuthRegistrationInputOrderControls(authScreen);
runAuthRegistrationInputMutationProbes(authScreen);
assert.doesNotMatch(authScreen, /COACH_REGISTRATION_SUBMIT_ENABLED/);
assert.match(authScreen, /action=\{onSubmit\}/);
assert.match(authScreen, /disabled=\{isBusy\}/);
assert.match(authScreen, /fieldErrors\["register-professional-title"\]/);
assert.doesNotMatch(authScreen, /auth-tab-coach[\s\S]{0,300}disabled/);
assert.match(authScreen, /aria-label="Continuar con Google \(no disponible\)"[\s\S]*?disabled/);
assert.doesNotMatch(authScreen, /Apple|aria-label="Correo"/);
assert.doesNotMatch(authScreen, /dangerouslySetInnerHTML/);
assert.doesNotMatch(authScreen, /email@email\.com/);
assert.match(authScreen, /placeholder="nombre@organizatech\.cl"/);
assert.equal(
  authScreen.split("¿Ya tienes una cuenta Organizatech Usuario? Puedes usar esa misma cuenta para acceder también como Coach. Si prefieres mantener ambas cuentas separadas, crea tu cuenta Coach con otro correo.").length - 1,
  1,
  "el copy híbrido aprobado aparece exactamente una vez",
);

// La fecha y la edad respetan sus columnas incluso con el ancho intrínseco del input date en WebKit.
runCssBraceBalanceContractChecks(authStyles);
assertBirthDateAgeCssContract(authStyles);
runBirthDateAgeMutationProbes(authStyles);

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

const AUTH_REGISTRATION_OWNERSHIP_FAILURE =
  "[AUTH-HYBRID-01.registration-form.ownership-and-revision]";

interface RegistrationOwnershipSources {
  root: string;
  screen: string;
  controller: string;
  hook: string;
}

function focalSourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(
    startIndex >= 0 && endIndex > startIndex,
    `${AUTH_REGISTRATION_OWNERSHIP_FAILURE} no se pudo aislar ${start}`,
  );
  return source.slice(startIndex, endIndex);
}

type SharedCoachRootResult =
  | { state: "authorized"; userId: string }
  | { state: "rejected" | "error"; message: string }
  | { state: "busy" | "stale" };

async function runSharedCoachLoginRootHarness(
  result: SharedCoachRootResult,
  sharedCoachLoginPending = true,
) {
  const continuation = focalSourceBetween(
    root,
    "if (registrationForm.controller.getState().sharedCoachLoginPending) {",
    "portalResolutionOwner = multiportalAuth.beginPortalResolution",
  );
  const appliedSessions: string[] = [];
  const routes: unknown[] = [];
  const navigations: unknown[] = [];
  const statuses: Array<{ message: string; tone: string }> = [];
  let completionCalls = 0;
  let signOutNoticeSettlements = 0;
  const context: Record<string, unknown> & {
    __runSharedCoachLogin?: () => Promise<string | undefined>;
  } = {
    registrationForm: {
      controller: {
        getState: () => ({ sharedCoachLoginPending }),
      },
      completeSharedCoachLogin: async () => {
        completionCalls += 1;
        return result;
      },
    },
    session: { user: { id: "user-a" } },
    authenticatedState: { session: { user: { id: "user-a" } } },
    multiportalAuth: {
      settlePortalSignOutMessage: () => {
        signOutNoticeSettlements += 1;
        return null;
      },
      beginPortalResolution: () => assert.fail("el harness no abre resolución de portal"),
    },
    setAuthStatus: (message: string, tone: string) => statuses.push({ message, tone }),
    applySessionState: (state: { session?: { user?: { id?: string } } }) => {
      appliedSessions.push(state.session?.user?.id ?? "missing");
    },
    captureSessionDataRequestToken: () => ({ generation: 1 }),
    authRouteController: {
      replace: (route: unknown) => routes.push(JSON.parse(JSON.stringify(route)) as unknown),
    },
    navigation: {
      transition: (navigation: unknown) => (
        navigations.push(JSON.parse(JSON.stringify(navigation)) as unknown)
      ),
    },
    createAuthNavigationReset: (mode: string, reason: string) => ({ mode, reason }),
  };
  runInNewContext(
    `let appliedIdentityToken = null;
     globalThis.__runSharedCoachLogin = async function () {
       ${continuation}
       return "normal_login";
     };`,
    context,
  );
  assert.equal(typeof context.__runSharedCoachLogin, "function");
  const continuationResult = await context.__runSharedCoachLogin!();
  return {
    continuation: continuationResult,
    appliedSessions,
    routes,
    navigations,
    statuses,
    completionCalls,
    signOutNoticeSettlements,
  };
}

function auditRegistrationOwnership(sources: RegistrationOwnershipSources) {
  const { root: rootSource, screen, controller, hook } = sources;
  const failure = AUTH_REGISTRATION_OWNERSHIP_FAILURE;
  for (const field of [
    "firstName",
    "lastName",
    "birthDate",
    "gender",
    "phoneNumber",
    "professionalTitle",
    "contactEmail",
    "email",
    "password",
    "confirmPassword",
  ]) {
    assert.match(controller, new RegExp(`${field}: \"\"`), `${failure} falta ${field}`);
  }
  assert.match(
    controller,
    /function publish[\s\S]*?revision \+= 1;[\s\S]*?state = \{ \.\.\.nextState, revision \};[\s\S]*?for \(const listener of listeners\) listener\(\);/,
    `${failure} cada publicación debe avanzar la revisión antes de notificar`,
  );
  assert.match(
    controller,
    /edit\(field, value\) \{\s*publish\(\{[\s\S]*?values: \{ \.\.\.state\.values, \[field\]: value \}/,
    `${failure} toda edición de campo usa la revisión única`,
  );
  assert.match(
    controller,
    /resetIfCurrent\(capture\) \{\s*if \(capture\.revision !== revision\) return false;\s*publish\(createInitialState\(revision\)\);\s*return true;/,
    `${failure} un reset tardío debe fallar cerrado`,
  );
  assert.match(controller, /fieldErrors: \{\}[\s\S]*showPassword: false[\s\S]*showConfirmPassword: false/);
  assert.doesNotMatch(controller, /useEffect|setTimeout|queueMicrotask|Promise\./);
  assert.doesNotMatch(hook, /setTimeout|queueMicrotask/);

  assert.match(rootSource, /useAuthRegistrationFormController\(\{/);
  assert.match(rootSource, /registrationForm\.controller\.captureRevision\(\)/);
  assert.match(rootSource, /registrationForm\.controller\.resetIfCurrent\(registrationRevision\)/);
  assert.match(rootSource, /registrationForm\.controller\.reset\(\)/);
  assert.doesNotMatch(
    rootSource,
    /authRegistrationResetToken|setAuthRegistrationResetToken|resetAuthRegistrationForm|setRegisterName|setRegisterEmail|setRegisterPassword|setRegisterConfirmPassword/,
    `${failure} el root no puede recuperar ownership de registro`,
  );

  const handleAuth = focalSourceBetween(
    rootSource,
    "  async function handleAuth(",
    "  async function handlePasswordRecovery(",
  );
  for (const branch of [
    {
      name: "Coach",
      start: "const registration = await multiportalAuth.registerCoach(",
      owner: "!multiportalAuth.isCoachRegistrationSubmitCurrent(coachRegistrationSubmitOwner)",
      end: "      if (signupPayload) {",
    },
    {
      name: "Usuario",
      start: "const registration = await multiportalAuth.registerUser(",
      owner: "!multiportalAuth.isUserRegistrationSubmitCurrent(userRegistrationSubmitOwner)",
      end: "      if (mode !== \"login\") return;",
    },
  ] as const) {
    const branchSource = focalSourceBetween(handleAuth, branch.start, branch.end);
    const ownerIndex = branchSource.indexOf(branch.owner);
    const revisionIndex = branchSource.indexOf(
      "!registrationForm.controller.isRevisionCurrent(registrationRevision)",
    );
    const firstEffect = Math.min(...[
      branchSource.indexOf("resetIfCurrent("),
      branchSource.indexOf("setAuthStatus("),
      branchSource.indexOf("applySessionState("),
      branchSource.indexOf("continueAuthorizedPortalAccess("),
    ].filter((index) => index >= 0));
    assert.ok(ownerIndex >= 0, `${failure} ${branch.name} pierde owner`);
    assert.ok(revisionIndex > ownerIndex, `${failure} ${branch.name} pierde revisión completa`);
    assert.ok(firstEffect > revisionIndex, `${failure} ${branch.name} publica antes de validar revisión`);
    const continuationIndex = branchSource.lastIndexOf("continueAuthorizedPortalAccess(");
    const delayedOwnerIndex = branchSource.lastIndexOf(branch.owner.slice(1));
    const delayedResetIndex = branchSource.lastIndexOf(
      "registrationForm.controller.resetIfCurrent(registrationRevision)",
    );
    assert.ok(
      continuationIndex >= 0
      && delayedOwnerIndex > continuationIndex
      && delayedResetIndex > delayedOwnerIndex,
      `${failure} ${branch.name} pierde owner o revisión en el reset posterior a la continuación`,
    );
  }
  for (const terminalState of ["coach_confirmation_required", "user_confirmation_required"]) {
    assert.match(
      handleAuth,
      new RegExp(`registration\\.state === \"${terminalState}\"[\\s\\S]*?registrationForm\\.controller\\.resetIfCurrent\\(registrationRevision\\)`),
      `${failure} ${terminalState} debe resetear sólo la revisión vigente`,
    );
  }

  assert.doesNotMatch(
    screen,
    /showRegisterPassword|showRegisterConfirmPassword|setLastName|setBirthDate|setGender|setPhoneNumber|setProfessionalTitle|setContactEmail/,
    `${failure} AuthScreen no conserva estado local de registro`,
  );
  assert.equal((screen.match(/registrationController\.edit\(/g) ?? []).length, 10);
  assert.match(
    screen,
    /<h2>\{isCoachRegistration \? "Crear cuenta Coach"[\s\S]*?<fieldset[\s\S]*?aria-label="Modalidad de cuenta Coach"/,
    `${failure} selector inmediatamente bajo el título Coach`,
  );
  for (const [value, label] of [
    ["shared", "Usar mi cuenta Usuario"],
    ["separate", "Crear una cuenta Coach separada"],
  ] as const) {
    assert.match(
      screen,
      new RegExp(`type=\"radio\"[\\s\\S]*?value=\"${value}\"[\\s\\S]*?checked=\\{registrationState\\.coachFlow === \"${value}\"\\}[\\s\\S]*?<span>${label}<\\/span>`),
      `${failure} opción accesible ${value}`,
    );
  }
  assert.match(screen, /includeCredentials=\{!isCoachRegistration \|\| registrationState\.coachFlow === "separate"\}/);
  assert.match(screen, /Iniciar sesión y continuar/);
  assert.match(screen, /\? "Activar cuenta Coach"\s*: "Crear cuenta Coach"/);
  assert.match(screen, /aria-label="Continuar con Google \(no disponible\)"[\s\S]*?disabled/);
  assert.doesNotMatch(
    `${rootSource}\n${screen}\n${hook}`,
    /identity_switch_required|coachIdentitySwitch|signOutForCoachIdentitySwitch|Cerrar sesión y continuar/,
    `${failure} el flujo híbrido no conserva el switch absoluto`,
  );
}

function replaceRegistrationFragment(source: string, target: string, replacement: string) {
  assert.equal(source.split(target).length - 1, 1, `mutante focal requiere target único: ${target}`);
  return source.replace(target, replacement);
}

function runRegistrationOwnershipMutationProbes(sources: RegistrationOwnershipSources) {
  const probes: Array<{ name: string; sources: RegistrationOwnershipSources }> = [
    {
      name: "una edición no avanza revisión",
      sources: {
        ...sources,
        controller: replaceRegistrationFragment(
          sources.controller,
          "    revision += 1;",
          "    revision += 0;",
        ),
      },
    },
    {
      name: "reset ignora revisión capturada",
      sources: {
        ...sources,
        controller: replaceRegistrationFragment(
          sources.controller,
          "      if (capture.revision !== revision) return false;\n      publish(createInitialState(revision));",
          "      publish(createInitialState(revision));",
        ),
      },
    },
    {
      name: "respuesta Coach omite revisión completa",
      sources: {
        ...sources,
        root: sources.root.replace(
          "          || !registrationForm.controller.isRevisionCurrent(registrationRevision)\n",
          "",
        ),
      },
    },
    {
      name: "continuación Usuario resetea sin owner vigente",
      sources: {
        ...sources,
        root: replaceRegistrationFragment(
          sources.root,
          `          if (
            userRegistrationSubmitOwner
            && multiportalAuth.isUserRegistrationSubmitCurrent(userRegistrationSubmitOwner)
          ) {
            registrationForm.controller.resetIfCurrent(registrationRevision);
          }`,
          "          registrationForm.controller.resetIfCurrent(registrationRevision);",
        ),
      },
    },
    {
      name: "selector compartido deja de ser single-choice",
      sources: {
        ...sources,
        screen: replaceRegistrationFragment(
          sources.screen,
          "                  checked={registrationState.coachFlow === \"shared\"}",
          "                  checked",
        ),
      },
    },
  ];

  for (const probe of probes) {
    assert.throws(
      () => auditRegistrationOwnership(probe.sources),
      (error: unknown) => error instanceof assert.AssertionError
        && error.message.includes(AUTH_REGISTRATION_OWNERSHIP_FAILURE),
      `debe morir el mutante: ${probe.name}`,
    );
  }
  auditRegistrationOwnership({
    root: `${sources.root}\n// control inocente root`,
    screen: `${sources.screen}\n// control inocente screen`,
    controller: `${sources.controller}\n// control inocente controller`,
    hook: `${sources.hook}\n// control inocente hook`,
  });
}

const SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE =
  "[AUTH-HYBRID-01.registration-form.shared-eligibility-behavior]";

interface ExecutableSharedCoachEligibilityCapture {
  readonly revision: number;
  readonly expectedUserId: string | null;
}

interface ExecutableAuthRegistrationFormController {
  getState(): {
    revision: number;
    coachFlow: "shared" | "separate" | null;
    sharedCoachEligibility:
      | { state: "idle" | "checking" | "sign_in_required" }
      | { state: "authorized"; userId: string };
  };
  subscribe(listener: () => void): () => void;
  edit(field: string, value: string): void;
  selectCoachFlow(
    flow: "shared" | "separate",
    expectedUserId: string | null,
  ): ExecutableSharedCoachEligibilityCapture;
  completeSharedCoachEligibility(
    capture: ExecutableSharedCoachEligibilityCapture,
    eligibility:
      | { state: "sign_in_required" }
      | { state: "authorized"; userId: string },
  ): boolean;
}

type ExecutableAuthRegistrationFormControllerFactory =
  () => ExecutableAuthRegistrationFormController;

function loadRegistrationFormControllerFactory(
  source: string,
): ExecutableAuthRegistrationFormControllerFactory {
  const transpiled = ts.transpileModule(source, {
    fileName: "auth-registration-form-controller.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  });
  const syntaxErrors = (transpiled.diagnostics ?? []).filter(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    syntaxErrors,
    [],
    `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.syntax el fixture debe ser ejecutable`,
  );
  const commonJsModule: { exports: Record<string, unknown> } = { exports: {} };
  runInNewContext(transpiled.outputText, {
    exports: commonJsModule.exports,
    module: commonJsModule,
  });
  const factory = commonJsModule.exports.createAuthRegistrationFormController;
  assert.equal(
    typeof factory,
    "function",
    `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.factory falta el factory ejecutable`,
  );
  return factory as ExecutableAuthRegistrationFormControllerFactory;
}

function executableRegistrationStateSnapshot(
  controller: ExecutableAuthRegistrationFormController,
) {
  return JSON.stringify(controller.getState());
}

function assertSharedEligibilityRevisionBehavior(
  factory: ExecutableAuthRegistrationFormControllerFactory,
) {
  const failure = `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.revision`;
  const controller = factory();
  const capture = controller.selectCoachFlow("shared", "user-a");
  controller.edit("contactEmail", "revision-b@example.com");
  const snapshot = executableRegistrationStateSnapshot(controller);
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => {
    notifications += 1;
  });
  const completed = controller.completeSharedCoachEligibility(
    capture,
    { state: "sign_in_required" },
  );
  unsubscribe();

  assert.equal(completed, false, `${failure} una captura stale no completa`);
  assert.equal(
    executableRegistrationStateSnapshot(controller),
    snapshot,
    `${failure} una captura stale no modifica estado`,
  );
  assert.equal(notifications, 0, `${failure} una captura stale no publica`);
}

function assertSharedEligibilityFlowBehavior(
  factory: ExecutableAuthRegistrationFormControllerFactory,
) {
  const failure = `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.flow`;
  const controller = factory();
  controller.selectCoachFlow("shared", "user-a");
  const separateCapture = controller.selectCoachFlow("separate", null);
  const snapshot = executableRegistrationStateSnapshot(controller);
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => {
    notifications += 1;
  });
  const completed = controller.completeSharedCoachEligibility(
    separateCapture,
    { state: "sign_in_required" },
  );
  unsubscribe();

  assert.equal(completed, false, `${failure} separate no completa elegibilidad shared`);
  assert.equal(
    executableRegistrationStateSnapshot(controller),
    snapshot,
    `${failure} separate no modifica estado de elegibilidad`,
  );
  assert.equal(notifications, 0, `${failure} separate no publica elegibilidad shared`);
}

function assertSharedEligibilityExpectedIdentityBehavior(
  factory: ExecutableAuthRegistrationFormControllerFactory,
) {
  const failure = `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.expected-identity`;
  const controller = factory();
  const capture = controller.selectCoachFlow("shared", "user-a");
  const snapshot = executableRegistrationStateSnapshot(controller);
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => {
    notifications += 1;
  });
  const completed = controller.completeSharedCoachEligibility(capture, {
    state: "authorized",
    userId: "user-b",
  });
  unsubscribe();

  assert.equal(completed, false, `${failure} una identidad cruzada no autoriza`);
  assert.equal(
    executableRegistrationStateSnapshot(controller),
    snapshot,
    `${failure} una identidad cruzada no modifica estado`,
  );
  assert.equal(notifications, 0, `${failure} una identidad cruzada no publica`);
}

function assertSharedCoachEligibilityBehavior(
  factory: ExecutableAuthRegistrationFormControllerFactory,
) {
  assertSharedEligibilityRevisionBehavior(factory);
  assertSharedEligibilityFlowBehavior(factory);
  assertSharedEligibilityExpectedIdentityBehavior(factory);
}

function runSharedCoachEligibilityBehaviorMutationProbes(source: string) {
  assertSharedCoachEligibilityBehavior(loadRegistrationFormControllerFactory(source));

  const probes = [
    {
      name: "elimina guard de revisión",
      failure: `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.revision`,
      assertBehavior: assertSharedEligibilityRevisionBehavior,
      mutate: (current: string) => replaceRegistrationFragment(
        current,
        `        capture.revision !== revision
        || state.coachFlow !== "shared"`,
        "        state.coachFlow !== \"shared\"",
      ),
    },
    {
      name: "elimina guard de flujo shared",
      failure: `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.flow`,
      assertBehavior: assertSharedEligibilityFlowBehavior,
      mutate: (current: string) => replaceRegistrationFragment(
        current,
        `        capture.revision !== revision
        || state.coachFlow !== "shared"
        || (`,
        `        capture.revision !== revision
        || (`,
      ),
    },
    {
      name: "elimina verificación de identidad esperada",
      failure: `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.expected-identity`,
      assertBehavior: assertSharedEligibilityExpectedIdentityBehavior,
      mutate: (current: string) => replaceRegistrationFragment(
        current,
        `        || (
          eligibility.state === "authorized"
          && eligibility.userId !== capture.expectedUserId
        )`,
        "",
      ),
    },
  ] as const;

  for (const probe of probes) {
    const mutated = probe.mutate(source);
    assert.notEqual(mutated, source, `el mutante debe modificar la fuente: ${probe.name}`);
    const factory = loadRegistrationFormControllerFactory(mutated);
    assert.throws(
      () => probe.assertBehavior(factory),
      (error: unknown) => error instanceof assert.AssertionError
        && error.message.includes(probe.failure),
      `debe morir por conducta el mutante: ${probe.name}`,
    );
  }

  assertSharedCoachEligibilityBehavior(
    loadRegistrationFormControllerFactory(`${source}\n// control inocente H3`),
  );
  assert.equal(
    readSource("src/features/auth/model/auth-registration-form-controller.ts"),
    source,
    `${SHARED_COACH_ELIGIBILITY_BEHAVIOR_FAILURE}.bytes los probes no alteran producto`,
  );
}

type AuthJsxOpeningLikeElement = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

interface ParsedAuthJsx {
  sourceFile: ts.SourceFile;
  elements: AuthJsxOpeningLikeElement[];
}

interface AuthJsxTarget {
  parsed: ParsedAuthJsx;
  element: AuthJsxOpeningLikeElement;
  attributes: ts.JsxAttribute[];
}

function parseAuthJsx(source: string): ParsedAuthJsx {
  const sourceFile = ts.createSourceFile(
    "auth-screen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  assert.equal(
    parseDiagnostics.length,
    0,
    `[auth-jsx.syntax] La mutación debe conservar sintaxis TSX válida: ${parseDiagnostics.map((diagnostic) => diagnostic.messageText).join(" | ")}`,
  );

  const elements: AuthJsxOpeningLikeElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, elements };
}

function findUniqueFunctionDeclaration(
  parsed: ParsedAuthJsx,
  name: string,
  assertionName: string,
): ts.FunctionDeclaration & { body: ts.Block } {
  const functions = parsed.sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ));
  assert.equal(
    functions.length,
    1,
    `[${assertionName}] ${name} debe tener una única implementación ejecutable.`,
  );
  assert.ok(functions[0].body, `[${assertionName}] ${name} debe conservar su cuerpo ejecutable.`);
  return functions[0] as ts.FunctionDeclaration & { body: ts.Block };
}

function collectJsxElements(node: ts.Node) {
  const elements: AuthJsxOpeningLikeElement[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      elements.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return elements;
}

function jsxAttributeName(attribute: ts.JsxAttribute, sourceFile: ts.SourceFile) {
  return attribute.name.getText(sourceFile);
}

function jsxAttributes(
  element: AuthJsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  name: string,
) {
  return element.attributes.properties.filter((property): property is ts.JsxAttribute => (
    ts.isJsxAttribute(property) && jsxAttributeName(property, sourceFile) === name
  ));
}

function literalJsxString(attribute: ts.JsxAttribute | undefined) {
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function findAuthJsxTarget(parsed: ParsedAuthJsx, id: string, assertionName: string): AuthJsxTarget {
  const matches = parsed.elements.filter((element) => (
    jsxAttributes(element, parsed.sourceFile, "id").some((attribute) => (
      literalJsxString(attribute) === id
    ))
  ));
  assert.equal(
    matches.length,
    1,
    `[${assertionName}.unique-id] Debe existir exactamente un elemento JSX con id literal "${id}".`,
  );
  const element = matches[0];
  const idAttributes = jsxAttributes(element, parsed.sourceFile, "id");
  assert.equal(
    idAttributes.length,
    1,
    `[${assertionName}.id-attribute] El elemento ${id} debe declarar id exactamente una vez.`,
  );
  assert.equal(
    literalJsxString(idAttributes[0]),
    id,
    `[${assertionName}.id-literal] El id ${id} debe ser un literal estático.`,
  );
  return {
    parsed,
    element,
    attributes: element.attributes.properties.filter(ts.isJsxAttribute),
  };
}

function assertNoTargetSpreads(target: AuthJsxTarget, assertionName: string) {
  const spreads = target.element.attributes.properties.filter(ts.isJsxSpreadAttribute);
  assert.equal(
    spreads.length,
    0,
    `[${assertionName}] El elemento auditado no puede reconstruir atributos mediante spread.`,
  );
}

function getUniqueTargetAttribute(target: AuthJsxTarget, name: string, assertionName: string) {
  const attributes = target.attributes.filter((attribute) => (
    jsxAttributeName(attribute, target.parsed.sourceFile) === name
  ));
  assert.equal(
    attributes.length,
    1,
    `[${assertionName}] ${name} debe existir exactamente una vez en el elemento auditado.`,
  );
  return attributes[0];
}

function assertLiteralTargetAttribute(
  target: AuthJsxTarget,
  name: string,
  expected: string,
  assertionName: string,
) {
  const attribute = getUniqueTargetAttribute(target, name, assertionName);
  assert.equal(
    literalJsxString(attribute),
    expected,
    `[${assertionName}] ${name} debe ser el literal "${expected}".`,
  );
}

function assertForwardedIdentifierAttribute(
  target: AuthJsxTarget,
  name: string,
  identifier: string,
) {
  const assertionName = `auth-text-field.${name}-forwarding`;
  const attribute = getUniqueTargetAttribute(target, name, assertionName);
  const initializer = attribute.initializer;
  assert.ok(
    initializer && ts.isJsxExpression(initializer) && initializer.expression
      && ts.isIdentifier(initializer.expression) && initializer.expression.text === identifier,
    `[${assertionName}] El input nativo debe reenviar ${name}={${identifier}} sin reconstrucciones.`,
  );
}

function assertAuthTextFieldInputForwarding(parsed: ParsedAuthJsx) {
  const component = findUniqueFunctionDeclaration(
    parsed,
    "AuthTextField",
    "auth-text-field.unique-component",
  );
  const nativeInputs = collectJsxElements(component.body).filter((element) => (
    element.tagName.getText(parsed.sourceFile) === "input"
  ));
  assert.equal(
    nativeInputs.length,
    1,
    "[auth-text-field.unique-native-input] AuthTextField debe renderizar exactamente un input nativo.",
  );
  const target: AuthJsxTarget = {
    parsed,
    element: nativeInputs[0],
    attributes: nativeInputs[0].attributes.properties.filter(ts.isJsxAttribute),
  };
  assertNoTargetSpreads(target, "auth-text-field.attributes-spread");
  assertForwardedIdentifierAttribute(target, "id", "id");
  assertForwardedIdentifierAttribute(target, "name", "name");
  assertForwardedIdentifierAttribute(target, "type", "type");
}

function assertRegistrationFieldsOwnership(
  parsed: ParsedAuthJsx,
  targets: readonly AuthJsxTarget[],
) {
  const registrationFields = findUniqueFunctionDeclaration(
    parsed,
    "RegistrationFields",
    "registration-fields.unique-component",
  );
  const ownedElements = collectJsxElements(registrationFields.body);
  const ownedElementSet = new Set(ownedElements);
  for (const target of targets) {
    assert.ok(
      ownedElementSet.has(target.element),
      "[registration-fields.target-ownership] Los IDs auditados deben pertenecer a RegistrationFields, no a elementos señuelo.",
    );
  }

  for (const element of ownedElements) {
    assert.equal(
      element.attributes.properties.filter(ts.isJsxSpreadAttribute).length,
      0,
      "[registration-fields.attributes-spread] RegistrationFields no puede reconstruir atributos mediante spreads.",
    );
    for (const idAttribute of jsxAttributes(element, parsed.sourceFile, "id")) {
      assert.ok(
        literalJsxString(idAttribute) !== null,
        "[registration-fields.id-literal] Los IDs de RegistrationFields deben ser literales estáticos.",
      );
    }
  }
}

function assertAuthRegistrationInputContract(source: string) {
  const parsed = parseAuthJsx(source);
  assertAuthTextFieldInputForwarding(parsed);

  const birthDate = findAuthJsxTarget(parsed, "register-birth-date", "register-birth-date");
  assert.equal(
    birthDate.element.tagName.getText(parsed.sourceFile),
    "AuthTextField",
    "[register-birth-date.element] La fecha debe usar el campo que renderiza el input nativo auditado.",
  );
  assertNoTargetSpreads(birthDate, "register-birth-date.attributes-spread");
  assertLiteralTargetAttribute(birthDate, "type", "date", "register-birth-date.type");

  const age = findAuthJsxTarget(parsed, "register-age", "register-age");
  assert.equal(
    age.element.tagName.getText(parsed.sourceFile),
    "input",
    "[register-age.element] Edad debe permanecer como un input nativo único.",
  );
  assertNoTargetSpreads(age, "register-age.name-spread");
  assert.equal(
    jsxAttributes(age.element, parsed.sourceFile, "name").length,
    0,
    "[register-age.name-absent] El input Edad no puede declarar name en ninguna posición.",
  );

  const readOnly = getUniqueTargetAttribute(age, "readOnly", "register-age.readOnly");
  assert.equal(
    readOnly.initializer,
    undefined,
    "[register-age.readOnly] Edad debe conservar readOnly como atributo booleano estático.",
  );
  assertLiteralTargetAttribute(age, "aria-readonly", "true", "register-age.aria-readonly");

  const tabIndex = getUniqueTargetAttribute(age, "tabIndex", "register-age.tabIndex");
  const tabIndexInitializer = tabIndex.initializer;
  assert.ok(
    tabIndexInitializer
      && ts.isJsxExpression(tabIndexInitializer)
      && tabIndexInitializer.expression
      && ts.isPrefixUnaryExpression(tabIndexInitializer.expression)
      && tabIndexInitializer.expression.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(tabIndexInitializer.expression.operand)
      && tabIndexInitializer.expression.operand.text === "1",
    "[register-age.tabIndex] Edad debe conservar tabIndex={-1} sin reconstrucciones.",
  );

  assertRegistrationFieldsOwnership(parsed, [birthDate, age]);
}

function getTargetAndAttributeForMutation(source: string, id: string, attributeName: string) {
  const parsed = parseAuthJsx(source);
  const target = findAuthJsxTarget(parsed, id, `probe.${id}`);
  const attribute = getUniqueTargetAttribute(target, attributeName, `probe.${id}.${attributeName}`);
  return { parsed, target, attribute };
}

function replaceJsxAttribute(source: string, id: string, attributeName: string, replacement: string) {
  const { parsed, attribute } = getTargetAndAttributeForMutation(source, id, attributeName);
  return `${source.slice(0, attribute.getStart(parsed.sourceFile))}${replacement}${source.slice(attribute.end)}`;
}

function removeJsxAttribute(source: string, id: string, attributeName: string) {
  return replaceJsxAttribute(source, id, attributeName, "");
}

function insertJsxAttributeRelativeToId(
  source: string,
  id: string,
  attributeSource: string,
  position: "before" | "after",
) {
  const { parsed, attribute } = getTargetAndAttributeForMutation(source, id, "id");
  const insertionIndex = position === "before" ? attribute.getStart(parsed.sourceFile) : attribute.end;
  const insertion = position === "before" ? `${attributeSource} ` : ` ${attributeSource}`;
  return `${source.slice(0, insertionIndex)}${insertion}${source.slice(insertionIndex)}`;
}

function insertSiblingAfterTarget(source: string, id: string, siblingSource: string) {
  const parsed = parseAuthJsx(source);
  const target = findAuthJsxTarget(parsed, id, `probe.${id}`);
  return `${source.slice(0, target.element.end)}\n        ${siblingSource}${source.slice(target.element.end)}`;
}

function duplicateTargetElement(source: string, id: string) {
  const parsed = parseAuthJsx(source);
  const target = findAuthJsxTarget(parsed, id, `probe.${id}`);
  const elementSource = source.slice(target.element.getStart(parsed.sourceFile), target.element.end);
  return `${source.slice(0, target.element.end)}\n        ${elementSource}${source.slice(target.element.end)}`;
}

function moveJsxAttributeBefore(source: string, id: string, attributeName: string) {
  const { parsed, attribute } = getTargetAndAttributeForMutation(source, id, attributeName);
  const attributeSource = source.slice(attribute.getStart(parsed.sourceFile), attribute.end);
  const withoutAttribute = `${source.slice(0, attribute.getStart(parsed.sourceFile))}${source.slice(attribute.end)}`;
  return insertJsxAttributeRelativeToId(withoutAttribute, id, attributeSource, "before");
}

function runAuthRegistrationInputOrderControls(source: string) {
  const reorderedBirthDate = moveJsxAttributeBefore(source, "register-birth-date", "type");
  const reordered = moveJsxAttributeBefore(reorderedBirthDate, "register-age", "tabIndex");
  assert.notEqual(reordered, source, "El control de orden debe reordenar atributos realmente.");
  parseAuthJsx(reordered);
  assertAuthRegistrationInputContract(reordered);
  assert.equal(
    readSource("src/features/auth/components/auth-screen.tsx"),
    source,
    "El control de orden debe conservar auth-screen.tsx byte a byte.",
  );
  console.log("AUTH-01 registration input AST order controls passed");
}

function runAuthRegistrationInputMutationProbes(source: string) {
  const probes: Array<{
    name: string;
    assertion: string;
    mutate: (current: string) => string;
  }> = [
    {
      name: "cambiar fecha a type text",
      assertion: "register-birth-date.type",
      mutate: (current) => replaceJsxAttribute(current, "register-birth-date", "type", 'type="text"'),
    },
    {
      name: "eliminar type de fecha",
      assertion: "register-birth-date.type",
      mutate: (current) => removeJsxAttribute(current, "register-birth-date", "type"),
    },
    {
      name: "dejar type date sólo en comentario JSX",
      assertion: "register-birth-date.type",
      mutate: (current) => insertSiblingAfterTarget(
        removeJsxAttribute(current, "register-birth-date", "type"),
        "register-birth-date",
        '{/* type="date" */}',
      ),
    },
    {
      name: "dejar type date sólo dentro de un string JSX",
      assertion: "register-birth-date.type",
      mutate: (current) => insertSiblingAfterTarget(
        removeJsxAttribute(current, "register-birth-date", "type"),
        "register-birth-date",
        '<span data-contract-decoy={\'type="date"\'} />',
      ),
    },
    {
      name: "mover type date a un input señuelo",
      assertion: "register-birth-date.type",
      mutate: (current) => insertSiblingAfterTarget(
        removeJsxAttribute(current, "register-birth-date", "type"),
        "register-birth-date",
        '<input type="date" aria-hidden="true" />',
      ),
    },
    {
      name: "duplicar id register-birth-date",
      assertion: "register-birth-date.unique-id",
      mutate: (current) => duplicateTargetElement(current, "register-birth-date"),
    },
    {
      name: "agregar name antes del id de Edad",
      assertion: "register-age.name-absent",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        'name="register-age"',
        "before",
      ),
    },
    {
      name: "agregar name después del id de Edad",
      assertion: "register-age.name-absent",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        'name="register-age"',
        "after",
      ),
    },
    {
      name: "agregar name dinámico a Edad",
      assertion: "register-age.name-absent",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        'name={String("register-age")}',
        "after",
      ),
    },
    {
      name: "inyectar name de Edad mediante spread",
      assertion: "register-age.name-spread",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        '{...{ name: "register-age" }}',
        "after",
      ),
    },
    {
      name: "duplicar id register-age",
      assertion: "register-age.unique-id",
      mutate: (current) => duplicateTargetElement(current, "register-age"),
    },
    {
      name: "eliminar readOnly de Edad",
      assertion: "register-age.readOnly",
      mutate: (current) => removeJsxAttribute(current, "register-age", "readOnly"),
    },
    {
      name: "eliminar aria-readonly de Edad",
      assertion: "register-age.aria-readonly",
      mutate: (current) => removeJsxAttribute(current, "register-age", "aria-readonly"),
    },
    {
      name: "eliminar tabIndex de Edad",
      assertion: "register-age.tabIndex",
      mutate: (current) => removeJsxAttribute(current, "register-age", "tabIndex"),
    },
  ];

  for (const probe of probes) {
    const mutated = probe.mutate(source);
    assert.notEqual(mutated, source, `El probe no alteró auth-screen.tsx: ${probe.name}`);
    parseAuthJsx(mutated);
    assert.throws(
      () => assertAuthRegistrationInputContract(mutated),
      (error: unknown) => (
        error instanceof assert.AssertionError && error.message.includes(`[${probe.assertion}]`)
      ),
      `El contrato AST no rechazó por su aserción específica: ${probe.name}`,
    );
    assert.equal(
      readSource("src/features/auth/components/auth-screen.tsx"),
      source,
      `El probe no conservó auth-screen.tsx byte a byte: ${probe.name}`,
    );
  }

  console.log(`AUTH-01 registration input AST mutation probes passed (${probes.length}/${probes.length})`);
}

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

interface StructuredCssRule {
  selector: string;
  body: string;
  bodyStart: number;
  bodyEnd: number;
  atRules: string[];
}

interface CssDeclaration {
  property: string;
  value: string;
}

function topLevelRule(rule: StructuredCssRule) {
  return rule.atRules.length === 0;
}

function mobileRule(rule: StructuredCssRule) {
  return rule.atRules.some((atRule) => normalizeCssText(atRule) === "@media (max-width: 360px)");
}

function iosWebKitRule(rule: StructuredCssRule) {
  return rule.atRules.some((atRule) => (
    normalizeCssText(atRule) === "@supports (-webkit-touch-callout: none)"
  ));
}

function assertBirthDateAgeCssContract(source: string) {
  const rules = extractStructuredCssRules(source);
  const birthRow = getUniqueCssRule(rules, ".birthRow", topLevelRule, "birth-row.selector");
  assertCssDeclaration(
    birthRow,
    "grid-template-columns",
    "minmax(0, 1.45fr) minmax(92px, 0.85fr)",
    "birth-row.grid-template-columns",
  );
  assertCssDeclaration(birthRow, "align-items", "start", "birth-row.align-items");

  const birthField = getUniqueCssRule(rules, ".birthRow > .field", topLevelRule, "birth-field.selector");
  assertCssDeclaration(birthField, "min-width", "0", "birth-field.min-width");
  assertCssDeclaration(birthField, "max-width", "100%", "birth-field.max-width");
  assertCssDeclaration(birthField, "min-inline-size", "0", "birth-field.min-inline-size");
  assertCssDeclaration(birthField, "max-inline-size", "100%", "birth-field.max-inline-size");

  const birthInput = getUniqueCssRule(
    rules,
    ".birthRow > .field > input",
    topLevelRule,
    "birth-input.selector",
  );
  for (const [property, value] of [
    ["display", "block"],
    ["width", "100%"],
    ["min-width", "0"],
    ["max-width", "100%"],
    ["inline-size", "100%"],
    ["min-inline-size", "0"],
    ["max-inline-size", "100%"],
  ] as const) {
    assertCssDeclaration(birthInput, property, value, `birth-input.${property}`);
  }

  const stackedBirthRow = getUniqueCssRule(rules, ".birthRow", mobileRule, "birth-mobile.selector");
  assertCssDeclaration(
    stackedBirthRow,
    "grid-template-columns",
    "1fr",
    "birth-mobile.grid-template-columns",
  );

  const iosDateInput = getUniqueCssRule(
    rules,
    '.field input[type="date"]',
    iosWebKitRule,
    "birth-ios-date.selector",
  );
  assertCssDeclaration(iosDateInput, "-webkit-appearance", "none", "birth-ios-date.webkit-appearance");
  assertCssDeclaration(iosDateInput, "appearance", "none", "birth-ios-date.appearance");

  const iosDateValue = getUniqueCssRule(
    rules,
    '.field input[type="date"]::-webkit-date-and-time-value',
    iosWebKitRule,
    "birth-ios-date-value.selector",
  );
  assertCssDeclaration(iosDateValue, "height", "1.5em", "birth-ios-date-value.height");
  assertCssDeclaration(iosDateValue, "text-align", "left", "birth-ios-date-value.text-align");
}

function runBirthDateAgeMutationProbes(source: string) {
  const probes: Array<{
    name: string;
    assertion: string;
    mutate: (current: string) => string;
  }> = [
    {
      name: "retirar min-inline-size",
      assertion: "birth-input.min-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        removeDeclaration(body, "min-inline-size")
      )),
    },
    {
      name: "retirar max-inline-size",
      assertion: "birth-input.max-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        removeDeclaration(body, "max-inline-size")
      )),
    },
    {
      name: "mover propiedades a otro selector",
      assertion: "birth-field.min-inline-size",
      mutate: (current) => `${mutateRuleBody(current, ".birthRow > .field", topLevelRule, (body) => (
        removeDeclaration(removeDeclaration(body, "min-inline-size"), "max-inline-size")
      ))}\n.birthRowDecoy { min-inline-size: 0; max-inline-size: 100%; }\n`,
    },
    {
      name: "reemplazar las columnas por tracks sin minmax",
      assertion: "birth-row.grid-template-columns",
      mutate: (current) => mutateRuleBody(current, ".birthRow", topLevelRule, (body) => (
        replaceDeclaration(body, "grid-template-columns", "1.45fr 0.85fr")
      )),
    },
    {
      name: "eliminar align-items start",
      assertion: "birth-row.align-items",
      mutate: (current) => mutateRuleBody(current, ".birthRow", topLevelRule, (body) => (
        removeDeclaration(body, "align-items")
      )),
    },
    {
      name: "introducir width 900px",
      assertion: "birth-input.width",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        replaceDeclaration(body, "width", "900px")
      )),
    },
    {
      name: "cambiar min-width cero por auto",
      assertion: "birth-field.min-width",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field", topLevelRule, (body) => (
        replaceDeclaration(body, "min-width", "auto")
      )),
    },
    {
      name: "dejar propiedades sólo en comentario",
      assertion: "birth-input.min-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        `${removeDeclaration(removeDeclaration(body, "min-inline-size"), "max-inline-size")}
  /* min-inline-size: 0; max-inline-size: 100%; */\n`
      )),
    },
    {
      name: "dejar propiedades sólo dentro de un string",
      assertion: "birth-input.min-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        `${removeDeclaration(removeDeclaration(body, "min-inline-size"), "max-inline-size")}
  content: "min-inline-size: 0; max-inline-size: 100%;";\n`
      )),
    },
    {
      name: "vaciar bloque real y usar bloque señuelo",
      assertion: "birth-input.display",
      mutate: (current) => `${mutateRuleBody(
        current,
        ".birthRow > .field > input",
        topLevelRule,
        () => "\n",
      )}\n.decoyInput { display: block; width: 100%; min-width: 0; max-width: 100%; inline-size: 100%; min-inline-size: 0; max-inline-size: 100%; }\n`,
    },
    {
      name: "reducir birthRow a una columna fuera del breakpoint",
      assertion: "birth-row.grid-template-columns",
      mutate: (current) => mutateRuleBody(current, ".birthRow", topLevelRule, (body) => (
        replaceDeclaration(body, "grid-template-columns", "1fr")
      )),
    },
    {
      name: "eliminar apilado móvil",
      assertion: "birth-mobile.grid-template-columns",
      mutate: (current) => mutateRuleBody(current, ".birthRow", mobileRule, (body) => (
        removeDeclaration(body, "grid-template-columns")
      )),
    },
  ];

  assert.equal(probes.length, 12, "El contrato debe conservar los 12 mutation probes de Fecha/Edad.");
  for (const probe of probes) {
    const mutated = probe.mutate(source);
    assert.notEqual(mutated, source, `El probe no alteró el CSS: ${probe.name}`);
    assert.throws(
      () => assertBirthDateAgeCssContract(mutated),
      (error: unknown) => (
        error instanceof assert.AssertionError && error.message.includes(`[${probe.assertion}]`)
      ),
      `El contrato no rechazó por su aserción específica: ${probe.name}`,
    );
  }

  console.log(`AUTH-01 Fecha/Edad mutation probes passed (${probes.length}/12)`);
}

function runCssBraceBalanceContractChecks(source: string) {
  assert.throws(
    () => extractStructuredCssRules(`${source}\n}`),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.braces.unexpected-close")
    ),
    "El parser debe rechazar una llave de cierre huérfana por css.braces.unexpected-close.",
  );

  const innocentCss = String.raw`
.example::before {
  content: "}";
}

.singleQuote::before {
  content: '}';
}

.escapedQuote::before {
  content: "\"}";
}

/* comentario con } */
@supports (display: grid) {
  .nested {
    display: grid;
  }
}
`;
  const innocentRules = extractStructuredCssRules(innocentCss);
  assert.ok(
    innocentRules.some((rule) => (
      rule.selector === ".nested"
      && rule.atRules.some((atRule) => normalizeCssText(atRule) === "@supports (display: grid)")
    )),
    "El scanner debe aceptar una regla válida anidada dentro de @supports.",
  );

  assert.throws(
    () => extractStructuredCssRules(".unclosed { color: red;"),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.braces.unclosed-open")
    ),
    "El parser debe distinguir una llave de apertura sin cierre.",
  );
  assert.throws(
    () => extractStructuredCssRules(".unclosed { /* comentario"),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.comments.unclosed")
    ),
    "El parser debe rechazar comentarios sin cierre.",
  );
  assert.throws(
    () => extractStructuredCssRules('.unclosed { content: "string sin cierre; }'),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.strings.unclosed")
    ),
    "El parser debe rechazar strings sin cierre.",
  );

  console.log("AUTH-01 CSS global brace-balance contract passed");
}

function extractStructuredCssRules(source: string) {
  assertCssGlobalBraceBalance(source);
  return parseCssRange(source, 0, source.length, []);
}

function assertCssGlobalBraceBalance(source: string) {
  let depth = 0;
  let quote = "";
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (character === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }

    if (character === "/" && next === "*") {
      inComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "\\") {
      index += 1;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      assert.ok(
        depth >= 0,
        `[css.braces.unexpected-close] Llave de cierre sin apertura en el índice ${index}.`,
      );
    }
  }

  assert.ok(!inComment, "[css.comments.unclosed] Comentario CSS sin cierre.");
  assert.equal(quote, "", "[css.strings.unclosed] String CSS sin cierre.");
  assert.equal(depth, 0, `[css.braces.unclosed-open] Quedaron ${depth} llaves de apertura sin cierre.`);
}

function parseCssRange(source: string, start: number, end: number, atRules: string[]): StructuredCssRule[] {
  const rules: StructuredCssRule[] = [];
  let cursor = start;

  while (cursor < end) {
    const openBrace = findNextCssCharacter(source, "{", cursor, end);
    if (openBrace === -1) break;
    const closeBrace = findMatchingCssBrace(source, openBrace, end);
    assert.notEqual(closeBrace, -1, "CSS inválido: bloque sin cierre.");

    const header = normalizeCssText(stripCssComments(source.slice(cursor, openBrace)).replace(/^;+/, ""));
    const bodyStart = openBrace + 1;
    const bodyEnd = closeBrace;
    const body = source.slice(bodyStart, bodyEnd);

    if (header.startsWith("@")) {
      rules.push(...parseCssRange(source, bodyStart, bodyEnd, [...atRules, header]));
    } else if (header) {
      rules.push({ selector: header, body, bodyStart, bodyEnd, atRules });
    }

    cursor = closeBrace + 1;
  }

  return rules;
}

function getUniqueCssRule(
  rules: StructuredCssRule[],
  selector: string,
  context: (rule: StructuredCssRule) => boolean,
  assertionName: string,
) {
  const matches = rules.filter((rule) => rule.selector === selector && context(rule));
  assert.equal(matches.length, 1, `[${assertionName}] se esperaba una única regla estructural ${selector}.`);
  return matches[0];
}

function assertCssDeclaration(
  rule: StructuredCssRule,
  property: string,
  expectedValue: string,
  assertionName: string,
) {
  const declarations = parseCssDeclarations(rule.body).filter((declaration) => declaration.property === property);
  assert.equal(
    declarations.length,
    1,
    `[${assertionName}] ${rule.selector} debe declarar ${property} exactamente una vez dentro de su bloque.`,
  );
  assert.equal(
    declarations[0]?.value,
    expectedValue,
    `[${assertionName}] ${rule.selector} debe declarar ${property}: ${expectedValue}.`,
  );
}

function parseCssDeclarations(body: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  let statementStart = 0;
  let quote = "";
  let parenthesisDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index] ?? ";";
    const next = body[index + 1];

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      index = findCssCommentEnd(body, index + 2);
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parenthesisDepth += 1;
    else if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "{" && parenthesisDepth === 0 && bracketDepth === 0) {
      const closeBrace = findMatchingCssBrace(body, index, body.length);
      assert.notEqual(closeBrace, -1, "CSS inválido: regla anidada sin cierre.");
      index = closeBrace;
      statementStart = closeBrace + 1;
    } else if (character === ";" && parenthesisDepth === 0 && bracketDepth === 0) {
      const declaration = parseCssDeclaration(body.slice(statementStart, index));
      if (declaration) declarations.push(declaration);
      statementStart = index + 1;
    }
  }

  return declarations;
}

function parseCssDeclaration(statement: string): CssDeclaration | null {
  const normalized = stripCssComments(statement).trim();
  if (!normalized) return null;
  const colon = findNextCssCharacter(normalized, ":", 0, normalized.length);
  if (colon === -1) return null;
  const property = normalized.slice(0, colon).trim().toLowerCase();
  if (!/^[-a-z]+$/.test(property)) return null;
  return { property, value: normalizeCssText(normalized.slice(colon + 1)) };
}

function mutateRuleBody(
  source: string,
  selector: string,
  context: (rule: StructuredCssRule) => boolean,
  mutate: (body: string) => string,
) {
  const rule = getUniqueCssRule(extractStructuredCssRules(source), selector, context, `probe.${selector}`);
  const body = mutate(rule.body);
  assert.notEqual(body, rule.body, `El probe no modificó el bloque ${selector}.`);
  return `${source.slice(0, rule.bodyStart)}${body}${source.slice(rule.bodyEnd)}`;
}

function removeDeclaration(body: string, property: string) {
  return replaceDeclarationStatement(body, property, "");
}

function replaceDeclaration(body: string, property: string, value: string) {
  return replaceDeclarationStatement(body, property, `${property}: ${value};`);
}

function replaceDeclarationStatement(body: string, property: string, replacement: string) {
  const pattern = new RegExp(`(^|\\n)([ \\t]*)${escapeRegExp(property)}\\s*:[^;]+;`, "m");
  assert.match(body, pattern, `El fixture debe declarar ${property}.`);
  return body.replace(pattern, (_match, lineStart: string, indentation: string) => (
    replacement ? `${lineStart}${indentation}${replacement}` : lineStart
  ));
}

function findNextCssCharacter(source: string, target: string, start: number, end: number) {
  let quote = "";
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === "/" && next === "*") {
      index = findCssCommentEnd(source, index + 2);
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === target) {
      return index;
    }
  }
  return -1;
}

function findMatchingCssBrace(source: string, openBrace: number, end: number) {
  let depth = 0;
  let quote = "";
  for (let index = openBrace; index < end; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      index = findCssCommentEnd(source, index + 2);
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function stripCssComments(source: string) {
  let result = "";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      result += character;
      if (character === "\\" && next) result += source[++index];
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
      result += character;
    } else if (character === "/" && next === "*") {
      const commentEnd = findCssCommentEnd(source, index + 2);
      result += source.slice(index, commentEnd + 1).replace(/[^\n]/g, " ");
      index = commentEnd;
    } else {
      result += character;
    }
  }
  return result;
}

function findCssCommentEnd(source: string, contentStart: number) {
  const end = source.indexOf("*/", contentStart);
  assert.notEqual(end, -1, "CSS inválido: comentario sin cierre.");
  return end + 1;
}

function normalizeCssText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CoachContractImportExpectation {
  moduleSpecifier: string;
  failureMarker: string;
}

interface CoachContractRunnerMutationProbe {
  name: string;
  expectedFailure: string;
  mutate: (source: string) => string;
}

interface CoachContractRunnerPositiveControl {
  name: string;
  mutate: (source: string) => string;
}

function coachContractImportExpectations(): readonly CoachContractImportExpectation[] {
  return [
    {
      moduleSpecifier: COACH_INTEGRATION_CONTRACT_SPECIFIER,
      failureMarker: COACH_INTEGRATION_IMPORT_FAILURE,
    },
    {
      moduleSpecifier: COACH_MODEL_CONTRACT_SPECIFIER,
      failureMarker: COACH_MODEL_IMPORT_FAILURE,
    },
  ];
}

function parseCoachContractRunner(source: string, path = COACH_CONTRACT_RUNNER_PATH) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  assert.equal(
    parseDiagnostics.length,
    0,
    `[AUTH-COACH-01.runner-import.syntax] ${path} debe conservar sintaxis TypeScript válida: ${parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
      .join(" | ")}`,
  );
  return sourceFile;
}

function coachContractRunnerImports(sourceFile: ts.SourceFile) {
  return sourceFile.statements.filter((statement): statement is ts.ImportDeclaration => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.importClause === undefined
  ));
}

function assertCoachContractRunnerImports(
  source: string,
  path = COACH_CONTRACT_RUNNER_PATH,
) {
  const sourceFile = parseCoachContractRunner(source, path);
  const imports = coachContractRunnerImports(sourceFile);

  for (const expectation of coachContractImportExpectations()) {
    const count = imports.filter((declaration) => (
      (declaration.moduleSpecifier as ts.StringLiteral).text === expectation.moduleSpecifier
    )).length;
    if (count !== 1) {
      throw new Error(
        `${expectation.failureMarker}\n`+
        "El runner autoritativo debe contener exactamente una vez el import ejecutable de efecto lateral "+
        `${expectation.moduleSpecifier}; `+
        `encontrado: ${count}.`,
      );
    }
  }
}

function findUniqueCoachContractImport(
  source: string,
  moduleSpecifier: string,
  path = COACH_CONTRACT_RUNNER_PATH,
) {
  const sourceFile = parseCoachContractRunner(source, path);
  const matches = coachContractRunnerImports(sourceFile).filter((declaration) => (
    (declaration.moduleSpecifier as ts.StringLiteral).text === moduleSpecifier
  ));
  assert.equal(
    matches.length,
    1,
    `[AUTH-COACH-01.runner-import.fixture] El fixture base debe contener una vez ${moduleSpecifier}.`,
  );
  return { sourceFile, declaration: matches[0] };
}

function replaceCoachContractImport(
  source: string,
  moduleSpecifier: string,
  replacement: (declarationSource: string) => string,
) {
  const { sourceFile, declaration } = findUniqueCoachContractImport(source, moduleSpecifier);
  const start = declaration.getStart(sourceFile);
  const declarationSource = source.slice(start, declaration.end);
  return `${source.slice(0, start)}${replacement(declarationSource)}${source.slice(declaration.end)}`;
}

function reorderCoachContractImports(source: string) {
  const integration = findUniqueCoachContractImport(
    source,
    COACH_INTEGRATION_CONTRACT_SPECIFIER,
  );
  const model = findUniqueCoachContractImport(source, COACH_MODEL_CONTRACT_SPECIFIER);
  const targets = [integration, model].sort((left, right) => (
    left.declaration.getStart(left.sourceFile) - right.declaration.getStart(right.sourceFile)
  ));
  const [first, second] = targets;
  const firstStart = first.declaration.getStart(first.sourceFile);
  const secondStart = second.declaration.getStart(second.sourceFile);
  const firstSource = source.slice(firstStart, first.declaration.end);
  const secondSource = source.slice(secondStart, second.declaration.end);
  const between = source.slice(first.declaration.end, secondStart);
  return `${source.slice(0, firstStart)}${secondSource}${between}${firstSource}${source.slice(second.declaration.end)}`;
}

function hashCoachContractRunner(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function exerciseCoachContractRunnerFixture(
  original: string,
  name: string,
  mutate: (source: string) => string,
  verify: (effectiveSource: string, fixturePath: string) => void,
) {
  const originalSha = hashCoachContractRunner(original);
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "organizatech-coach-runner-contract-"));
  const fixturePath = join(fixtureDirectory, "multiportal-auth-integration-contract.test.ts");

  try {
    writeFileSync(fixturePath, original, "utf8");
    const mutated = mutate(original);
    assert.notEqual(
      mutated,
      original,
      `[AUTH-COACH-01.runner-import.fixture-effective] El caso debe mutar la fuente: ${name}.`,
    );
    writeFileSync(fixturePath, mutated, "utf8");
    const effectiveSource = readFileSync(fixturePath, "utf8");
    const effectiveSha = hashCoachContractRunner(effectiveSource);
    assert.equal(
      effectiveSource,
      mutated,
      `[AUTH-COACH-01.runner-import.fixture-effective] La fuente materializada debe ser efectiva: ${name}.`,
    );
    assert.notEqual(
      effectiveSha,
      originalSha,
      `[AUTH-COACH-01.runner-import.fixture-sha] El SHA efectivo debe cambiar: ${name}.`,
    );
    parseCoachContractRunner(effectiveSource, fixturePath);
    verify(effectiveSource, fixturePath);
  } finally {
    try {
      writeFileSync(fixturePath, original, "utf8");
      const restoredSource = readFileSync(fixturePath, "utf8");
      assert.equal(
        restoredSource,
        original,
        `[AUTH-COACH-01.runner-import.fixture-restore] Debe restaurar bytes originales: ${name}.`,
      );
      assert.equal(
        hashCoachContractRunner(restoredSource),
        originalSha,
        `[AUTH-COACH-01.runner-import.fixture-restore] Debe restaurar el SHA original: ${name}.`,
      );
      const productiveSource = readSource(COACH_CONTRACT_RUNNER_PATH);
      assert.equal(
        productiveSource,
        original,
        `[AUTH-COACH-01.runner-import.productive-bytes] El probe no puede alterar el runner: ${name}.`,
      );
      assert.equal(
        hashCoachContractRunner(productiveSource),
        originalSha,
        `[AUTH-COACH-01.runner-import.productive-sha] El probe no puede alterar su SHA: ${name}.`,
      );
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  }
}

function assertCoachContractRunnerExpectedFailure(
  source: string,
  path: string,
  expectedFailure: string,
  probeName: string,
) {
  let failure: unknown;
  try {
    assertCoachContractRunnerImports(source, path);
  } catch (error) {
    failure = error;
  }
  assert.ok(
    failure instanceof Error,
    `[AUTH-COACH-01.runner-import.probe] El contrato debía lanzar una excepción: ${probeName}.`,
  );
  assert.equal(
    failure.message.split(/\r?\n/, 1)[0],
    expectedFailure,
    `[AUTH-COACH-01.runner-import.expected-failure] Primera causa inesperada: ${probeName}.`,
  );
}

function runCoachContractRunnerMutationProbes(source: string) {
  const probes: CoachContractRunnerMutationProbe[] = [
    {
      name: "eliminar import del contrato de integración Coach",
      expectedFailure: COACH_INTEGRATION_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_INTEGRATION_CONTRACT_SPECIFIER,
        () => "",
      ),
    },
    {
      name: "eliminar import del contrato de modelo Coach",
      expectedFailure: COACH_MODEL_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_MODEL_CONTRACT_SPECIFIER,
        () => "",
      ),
    },
    {
      name: "reemplazar integración por comentario señuelo",
      expectedFailure: COACH_INTEGRATION_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_INTEGRATION_CONTRACT_SPECIFIER,
        (declaration) => `// ${declaration}`,
      ),
    },
    {
      name: "reemplazar modelo por string señuelo",
      expectedFailure: COACH_MODEL_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_MODEL_CONTRACT_SPECIFIER,
        () => `const coachModelContractImportDecoy = "${COACH_MODEL_CONTRACT_SPECIFIER}";`,
      ),
    },
    {
      name: "duplicar import del contrato de integración Coach",
      expectedFailure: COACH_INTEGRATION_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_INTEGRATION_CONTRACT_SPECIFIER,
        (declaration) => `${declaration}\n${declaration}`,
      ),
    },
    {
      name: "duplicar import del contrato de modelo Coach",
      expectedFailure: COACH_MODEL_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_MODEL_CONTRACT_SPECIFIER,
        (declaration) => `${declaration}\n${declaration}`,
      ),
    },
    {
      name: "sustituir integración por módulo de nombre parecido",
      expectedFailure: COACH_INTEGRATION_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_INTEGRATION_CONTRACT_SPECIFIER,
        () => `import "${COACH_INTEGRATION_CONTRACT_SPECIFIER}-decoy";`,
      ),
    },
    {
      name: "sustituir modelo por módulo de nombre parecido",
      expectedFailure: COACH_MODEL_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_MODEL_CONTRACT_SPECIFIER,
        () => `import "${COACH_MODEL_CONTRACT_SPECIFIER}-decoy";`,
      ),
    },
    {
      name: "convertir integración en import type vacío",
      expectedFailure: COACH_INTEGRATION_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_INTEGRATION_CONTRACT_SPECIFIER,
        () => `import type {} from "${COACH_INTEGRATION_CONTRACT_SPECIFIER}";`,
      ),
    },
    {
      name: "convertir modelo en import type vacío",
      expectedFailure: COACH_MODEL_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_MODEL_CONTRACT_SPECIFIER,
        () => `import type {} from "${COACH_MODEL_CONTRACT_SPECIFIER}";`,
      ),
    },
    {
      name: "convertir ambos contratos en imports type vacíos",
      expectedFailure: COACH_INTEGRATION_IMPORT_FAILURE,
      mutate: (current) => {
        const typeOnlyIntegration = replaceCoachContractImport(
          current,
          COACH_INTEGRATION_CONTRACT_SPECIFIER,
          () => `import type {} from "${COACH_INTEGRATION_CONTRACT_SPECIFIER}";`,
        );
        return replaceCoachContractImport(
          typeOnlyIntegration,
          COACH_MODEL_CONTRACT_SPECIFIER,
          () => `import type {} from "${COACH_MODEL_CONTRACT_SPECIFIER}";`,
        );
      },
    },
    {
      name: "convertir integración en import vacío con cláusula",
      expectedFailure: COACH_INTEGRATION_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_INTEGRATION_CONTRACT_SPECIFIER,
        () => `import {} from "${COACH_INTEGRATION_CONTRACT_SPECIFIER}";`,
      ),
    },
    {
      name: "convertir modelo en import con namespace",
      expectedFailure: COACH_MODEL_IMPORT_FAILURE,
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_MODEL_CONTRACT_SPECIFIER,
        () => `import * as CoachModelContract from "${COACH_MODEL_CONTRACT_SPECIFIER}";`,
      ),
    },
  ];
  const expectedProbeCount = 13;
  assert.equal(
    probes.length,
    expectedProbeCount,
    "[AUTH-COACH-01.runner-import.probe-count] Debe conservarse el conteo fijo de mutaciones.",
  );

  for (const probe of probes) {
    exerciseCoachContractRunnerFixture(
      source,
      probe.name,
      probe.mutate,
      (effectiveSource, fixturePath) => assertCoachContractRunnerExpectedFailure(
        effectiveSource,
        fixturePath,
        probe.expectedFailure,
        probe.name,
      ),
    );
  }

  console.log(
    `AUTH-COACH-01 runner import AST mutation probes passed (${probes.length}/${expectedProbeCount})`,
  );
}

function runCoachContractRunnerPositiveControls(source: string) {
  const controls: CoachContractRunnerPositiveControl[] = [
    {
      name: "reformatear imports protegidos",
      mutate: (current) => {
        const reformattedIntegration = replaceCoachContractImport(
          current,
          COACH_INTEGRATION_CONTRACT_SPECIFIER,
          () => `import\n  "${COACH_INTEGRATION_CONTRACT_SPECIFIER}"\n;`,
        );
        return replaceCoachContractImport(
          reformattedIntegration,
          COACH_MODEL_CONTRACT_SPECIFIER,
          () => `import\n  "${COACH_MODEL_CONTRACT_SPECIFIER}"\n;`,
        );
      },
    },
    {
      name: "cambiar comillas de imports protegidos",
      mutate: (current) => {
        const singleQuotedIntegration = replaceCoachContractImport(
          current,
          COACH_INTEGRATION_CONTRACT_SPECIFIER,
          () => `import '${COACH_INTEGRATION_CONTRACT_SPECIFIER}';`,
        );
        return replaceCoachContractImport(
          singleQuotedIntegration,
          COACH_MODEL_CONTRACT_SPECIFIER,
          () => `import '${COACH_MODEL_CONTRACT_SPECIFIER}';`,
        );
      },
    },
    {
      name: "agregar comentarios cercanos",
      mutate: (current) => replaceCoachContractImport(
        current,
        COACH_INTEGRATION_CONTRACT_SPECIFIER,
        (declaration) => `// Comentario inocente previo.\n${declaration}\n/* Comentario inocente posterior. */`,
      ),
    },
    {
      name: "reordenar imports protegidos",
      mutate: reorderCoachContractImports,
    },
    {
      name: "agregar nombre local inocente",
      mutate: (current) => (
        `import { basename as coachRunnerFixtureBasename } from "node:path";\n${current}`
      ),
    },
  ];
  const expectedControlCount = 5;
  assert.equal(
    controls.length,
    expectedControlCount,
    "[AUTH-COACH-01.runner-import.control-count] Debe conservarse el conteo fijo de controles.",
  );

  for (const control of controls) {
    exerciseCoachContractRunnerFixture(
      source,
      control.name,
      control.mutate,
      (effectiveSource, fixturePath) => assertCoachContractRunnerImports(
        effectiveSource,
        fixturePath,
      ),
    );
  }

  console.log(
    `AUTH-COACH-01 runner import AST positive controls passed (${controls.length}/${expectedControlCount})`,
  );
}

function findNamedFunctionText(source: string, functionName: string) {
  const sourceFile = ts.createSourceFile(
    "src/components/organizatech-app.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const matches: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      matches.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(matches.length, 1, `${functionName}: declaración única`);
  return matches[0]!;
}

function assertSignupConfirmationCleanupOrder(source: string) {
  const completeSource = findNamedFunctionText(source, "completeSignupConfirmationSession");
  const cleanupOffset = completeSource.indexOf("clearSignupConfirmationUrl();");
  const completionOffset = completeSource.indexOf("multiportalAuth.completeSignupConfirmation(");
  assert.ok(cleanupOffset >= 0, "signup confirmation debe limpiar la URL");
  assert.ok(
    cleanupOffset < completionOffset,
    "signup confirmation debe limpiar el fragmento antes de esperar cualquier cierre",
  );
  assert.match(completeSource, /\.catch\(\(\) => \{\s*invalidateSignupConfirmation\(\);\s*\}\)/);
  assert.doesNotMatch(
    completeSource,
    /publishSignupConfirmationResult|continueAuthorizedPortalAccess|replaceCoachPortalSession|setCoachPortalSession/,
  );
  assert.doesNotMatch(completeSource, /localStorage|sessionStorage|history\.back|console\./);
}

interface SignupConfirmationHarnessContext {
  [key: string]: unknown;
  __completeSignupConfirmationSession?: (authState: unknown, forceInvalid?: boolean) => void;
}

async function assertSignupConfirmationSignOutFailureIsContained(source: string) {
  const privateToken = "private-signup-token-never-publish";
  const initialUrl = new URL(
    `https://qa-preview.example.test/login?flow=signup-confirmation#access_token=${privateToken}&type=signup`,
  );
  const location = { href: initialUrl.href };
  const replaceTargets: string[] = [];
  let historyBackCalls = 0;
  let externalNavigationCalls = 0;
  const fakeWindow = {
    location: {
      get href() {
        return location.href;
      },
      set href(value: string) {
        location.href = value;
      },
      assign() {
        externalNavigationCalls += 1;
      },
      replace() {
        externalNavigationCalls += 1;
      },
    },
    history: {
      replaceState(_state: unknown, _title: string, target?: string | URL | null) {
        const targetValue = String(target ?? "");
        replaceTargets.push(targetValue);
        location.href = new URL(targetValue, initialUrl.origin).href;
      },
      back() {
        historyBackCalls += 1;
      },
    },
  };
  const signupConfirmationStateRef = { current: "pending" };
  const busyStates: boolean[] = [];
  const loadingStates: boolean[] = [];
  const routeReplacements: unknown[] = [];
  const transitions: unknown[] = [];
  const statuses: Array<{ message: string; tone: string }> = [];
  const logs: unknown[][] = [];
  let signOutAttempts = 0;

  const signOutAfterSignupConfirmation = async () => {
    signOutAttempts += 1;
    throw new Error(`signOutAfterSignupConfirmation failed: ${privateToken}`);
  };
  const context: SignupConfirmationHarnessContext = {
    URL,
    window: fakeWindow,
    multiportalAuth: {
      async completeSignupConfirmation() {
        await signOutAfterSignupConfirmation();
        return "signed_out";
      },
    },
    signupConfirmationStateRef,
    setIsBusy(value: boolean) {
      busyStates.push(value);
    },
    setIsAuthLoading(value: boolean) {
      loadingStates.push(value);
    },
    authRouteController: {
      replace(value: unknown) {
        routeReplacements.push(value);
      },
    },
    navigation: {
      transition(value: unknown) {
        transitions.push(value);
      },
    },
    createAuthNavigationReset(screen: string, reason: string) {
      return { screen, reason };
    },
    setAuthStatus(message: string, tone: string) {
      statuses.push({ message, tone });
    },
    SIGNUP_CONFIRMATION_INVALID_MESSAGE,
    console: {
      log: (...values: unknown[]) => logs.push(values),
      warn: (...values: unknown[]) => logs.push(values),
      error: (...values: unknown[]) => logs.push(values),
    },
  };
  const harnessSource = [
    findNamedFunctionText(source, "clearSignupConfirmationUrl"),
    findNamedFunctionText(source, "invalidateSignupConfirmation"),
    findNamedFunctionText(source, "completeSignupConfirmationSession"),
    "globalThis.__completeSignupConfirmationSession = completeSignupConfirmationSession;",
  ].join("\n");
  const transpiled = ts.transpileModule(harnessSource, {
    fileName: "signup-confirmation-cleanup-harness.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
    reportDiagnostics: true,
  });
  const syntaxErrors = (transpiled.diagnostics ?? []).filter(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(syntaxErrors, [], "harness de callback conserva sintaxis ejecutable");
  runInNewContext(transpiled.outputText, context);
  const complete = context.__completeSignupConfirmationSession;
  assert.equal(typeof complete, "function");

  complete!({ session: { user: { id: "user-a" } } });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(signOutAttempts, 1, "la falla forzada proviene del cierre post-confirmación");
  assert.equal(signupConfirmationStateRef.current, "invalid");
  assert.ok(replaceTargets.length >= 2, "limpieza inmediata y limpieza idempotente de error");
  assert.equal(new URL(location.href).hash, "");
  assert.equal(new URL(location.href).searchParams.has("flow"), false);
  assert.equal(
    replaceTargets.every((target) => new URL(target, initialUrl.origin).origin === initialUrl.origin),
    true,
  );
  assert.equal(historyBackCalls, 0);
  assert.equal(externalNavigationCalls, 0);
  assert.equal(
    JSON.stringify(routeReplacements),
    JSON.stringify([{ mode: "login", accountType: "usuario" }]),
  );
  assert.equal(
    JSON.stringify(transitions),
    JSON.stringify([{ screen: "login", reason: "signup-confirmation-completed" }]),
  );
  assert.deepEqual(busyStates, [false]);
  assert.deepEqual(loadingStates, [false]);
  assert.deepEqual(statuses, [{ message: SIGNUP_CONFIRMATION_INVALID_MESSAGE, tone: "error" }]);
  assert.equal(logs.length, 0);
  assert.equal(
    JSON.stringify({ statuses, logs, routeReplacements, transitions }).includes(privateToken),
    false,
  );
}
