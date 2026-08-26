import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const ROOT_PATH = "src/components/organizatech-app.tsx";
const CONTROLLER_PATH = "src/features/auth/model/multiportal-auth-controller.ts";
const GATEWAY_PATH = "src/features/auth/data/supabase-multiportal-auth-gateway.ts";
const HOOK_PATH = "src/features/auth/hooks/use-multiportal-auth-boundary.ts";
const MODEL_PATH = "src/features/coach-portal/model/coach-portal.ts";
const COMPONENT_PATH = "src/features/coach-portal/components/coach-portal.tsx";
const PRODUCT_CONTRACT_PATH = "docs/product/auth-coach-product-contract.md";
const ROADMAP_PATH = "docs/product/auth-coach-roadmap.md";
const PACKAGE_PATH = "package.json";
const AUTH_CONFIRMATION_MIGRATION_PATH =
  "supabase/migrations/20260820041942_auth_confirmation_pending_memberships.sql";
const AUTH_SEPARATE_LEGACY_CONTACT_MIGRATION_PATH =
  "supabase/migrations/20260825043212_auth_separate_coach_contact_email.sql";
const AUTH_SEPARATE_CONTACT_MIGRATION_PATH =
  "supabase/migrations/20260826041258_auth_separate_coach_contact_email.sql";

const FAILURE = {
  coachContinuesUser: "[AUTH-COACH-01.PORTAL.M01.coach-continues-user]",
  destinationsShared: "[AUTH-COACH-01.PORTAL.M02.destinations-shared]",
  coachMountsUser: "[AUTH-COACH-01.PORTAL.M03.coach-mounts-user]",
  selectedPortalIgnored: "[AUTH-COACH-01.PORTAL.M04.selected-portal-ignored]",
  nameAuthority: "[AUTH-COACH-01.PORTAL.M05.name-authority]",
  professionalAuthority: "[AUTH-COACH-01.PORTAL.M06.professional-title-authority]",
  exactHomeCopy: "[AUTH-COACH-01.PORTAL.M07.exact-home-copy]",
  menuOrder: "[AUTH-COACH-01.PORTAL.M08.menu-order]",
  disabledNavigation: "[AUTH-COACH-01.PORTAL.M09.disabled-navigation]",
  futureScreen: "[AUTH-COACH-01.PORTAL.M10.future-screen]",
  profileNavigation: "[AUTH-COACH-01.PORTAL.M11.profile-navigation]",
  userProfileData: "[AUTH-COACH-01.PORTAL.M12.user-profile-data]",
  derivedAge: "[AUTH-COACH-01.PORTAL.M13.derived-age]",
  editingEnabled: "[AUTH-COACH-01.PORTAL.M14.editing-enabled]",
  coachWrite: "[AUTH-COACH-01.PORTAL.M15.coach-write]",
  logoutRetainsState: "[AUTH-COACH-01.PORTAL.M16.logout-retains-state]",
  staleRemount: "[AUTH-COACH-01.PORTAL.M17.stale-remount]",
  omittedProfessionalTitle: "[AUTH-COACH-01.PORTAL.M18.omitted-professional-title]",
  emailImplemented: "[AUTH-COACH-01.PORTAL.M19.email-implemented]",
  prohibitedArtifact: "[AUTH-COACH-01.PORTAL.M20.prohibited-artifact]",
  confirmationRemoved: "[AUTH-COACH-01.PORTAL.M21.confirmation-removed]",
  confirmationResent: "[AUTH-COACH-01.PORTAL.M22.confirmation-resent]",
  emailContractMissing: "[AUTH-COACH-01.PORTAL.M23.email-contract-missing]",
} as const;

interface Sources {
  root: string;
  controller: string;
  gateway: string;
  hook: string;
  model: string;
  component: string;
  productContract: string;
  roadmap: string;
  packageJson: string;
}

type SourceKey = keyof Sources;

const SOURCE_PATHS: Record<SourceKey, string> = {
  root: ROOT_PATH,
  controller: CONTROLLER_PATH,
  gateway: GATEWAY_PATH,
  hook: HOOK_PATH,
  model: MODEL_PATH,
  component: COMPONENT_PATH,
  productContract: PRODUCT_CONTRACT_PATH,
  roadmap: ROADMAP_PATH,
  packageJson: PACKAGE_PATH,
};

function readSources(): Sources {
  return {
    root: readFileSync(ROOT_PATH, "utf8"),
    controller: readFileSync(CONTROLLER_PATH, "utf8"),
    gateway: readFileSync(GATEWAY_PATH, "utf8"),
    hook: readFileSync(HOOK_PATH, "utf8"),
    model: readFileSync(MODEL_PATH, "utf8"),
    component: readFileSync(COMPONENT_PATH, "utf8"),
    productContract: readFileSync(PRODUCT_CONTRACT_PATH, "utf8"),
    roadmap: readFileSync(ROADMAP_PATH, "utf8"),
    packageJson: readFileSync(PACKAGE_PATH, "utf8"),
  };
}

function sha256(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function assertContract(condition: unknown, failure: string): asserts condition {
  assert.equal(Boolean(condition), true, failure);
}

function parseSource(source: string, path: string) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function assertValidSource(source: string, path: string) {
  if (path === PACKAGE_PATH) {
    assert.doesNotThrow(() => JSON.parse(source), `[AUTH-COACH-01.PORTAL.syntax] JSON válido: ${path}`);
    return;
  }
  if (!path.endsWith(".ts") && !path.endsWith(".tsx")) return;
  const result = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    reportDiagnostics: true,
  });
  const syntaxErrors = (result.diagnostics ?? []).filter(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    syntaxErrors,
    [],
    `[AUTH-COACH-01.PORTAL.syntax] TypeScript ejecutable: ${path}`,
  );
}

function findFunction(sourceFile: ts.SourceFile, name: string) {
  let result: ts.FunctionDeclaration | null = null;
  const visit = (node: ts.Node) => {
    if (result) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const resolved = result as ts.FunctionDeclaration | null;
  assert.ok(resolved?.body, `función ${name} disponible`);
  return resolved as ts.FunctionDeclaration & { body: ts.Block };
}

function findSwitchStatement(node: ts.Node) {
  let result: ts.SwitchStatement | null = null;
  const visit = (candidate: ts.Node) => {
    if (result) return;
    if (ts.isSwitchStatement(candidate)) {
      result = candidate;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  assert.ok(result, "switch de destino disponible");
  return result as ts.SwitchStatement;
}

function caseLabel(clause: ts.CaseOrDefaultClause) {
  if (!ts.isCaseClause(clause)) return null;
  return ts.isStringLiteralLike(clause.expression) ? clause.expression.text : null;
}

function functionText(source: string, path: string, name: string) {
  const sourceFile = parseSource(source, path);
  return findFunction(sourceFile, name).getText(sourceFile);
}

function replaceExactlyOnce(source: string, target: string, replacement: string, name: string) {
  assert.equal(source.split(target).length - 1, 1, `${name}: target único`);
  return source.replace(target, replacement);
}

function auditDestinations(sources: Sources) {
  const sourceFile = parseSource(sources.root, ROOT_PATH);
  const continuation = findFunction(sourceFile, "continueAuthorizedPortalAccess");
  const destinationSwitch = findSwitchStatement(continuation.body);
  const clauses = destinationSwitch.caseBlock.clauses;

  const sharedDestination = clauses.some((clause, index) => (
    caseLabel(clause) === "user_authorized"
    && clause.statements.length === 0
    && caseLabel(clauses[index + 1]) === "coach_authorized"
  ));
  assertContract(!sharedDestination, FAILURE.destinationsShared);

  const userClauses = clauses.filter((clause) => caseLabel(clause) === "user_authorized");
  const userText = userClauses.map((clause) => clause.getText(sourceFile)).join("\n");
  assertContract(
    userClauses.length === 1
    && /continueAuthenticatedSession\(\s*authState,\s*intent,\s*clearCompletedAuthForm,\s*\)/.test(userText),
    FAILURE.destinationsShared,
  );

  const coachClauses = clauses.filter((clause) => caseLabel(clause) === "coach_authorized");
  const coachText = coachClauses.map((clause) => clause.getText(sourceFile)).join("\n");
  assertContract(
    coachClauses.length === 1
    && !/continueAuthenticatedSession|refreshTrainingDataForSession|navigation\.transition/.test(coachText)
    && /createCoachPortalSession/.test(coachText)
    && /replaceCoachPortalSession/.test(coachText),
    FAILURE.coachContinuesUser,
  );
}

function auditCoachComposition(sources: Sources) {
  const sourceFile = parseSource(sources.root, ROOT_PATH);
  let coachBoundary: ts.IfStatement | null = null;
  const visit = (node: ts.Node) => {
    if (
      !coachBoundary
      && ts.isIfStatement(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "coachPortalSession"
      && node.thenStatement.getText(sourceFile).includes("<CoachPortalBoundary")
    ) {
      coachBoundary = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const boundary = coachBoundary as ts.IfStatement | null;
  const userShellIndex = sources.root.lastIndexOf("<AppShellLayout");
  assertContract(
    Boolean(boundary)
    && boundary!.getStart(sourceFile) < userShellIndex
    && !boundary!.thenStatement.getText(sourceFile).includes("ProfileScreen")
    && !boundary!.thenStatement.getText(sourceFile).includes("DashboardScreen"),
    FAILURE.coachMountsUser,
  );
}

function auditSelectedPortal(sources: Sources) {
  assertContract(
    /if\s*\(\s*input\.requestedPortal\s*===\s*"usuario"\s*\)/.test(sources.controller)
    && /requestedPortal:\s*"usuario"/.test(sources.controller)
    && /requestedPortal:\s*"coach"/.test(sources.controller)
    && /portalDecision === "authorize_coach" \? "coach" : "usuario"/.test(sources.root)
    && /portalEventDecision === "authorize_coach" \? "coach" : "usuario"/.test(sources.root),
    FAILURE.selectedPortalIgnored,
  );
}

function auditCoachPresentationAuthorities(sources: Sources) {
  assertContract(
    /fullName:\s*`\$\{\s*registration\.firstName\s*\}\s+\$\{\s*registration\.lastName\s*\}`\.trim\(\)/.test(sources.model)
    && !/user_metadata|app_metadata|displayName|sessionName|profilePersonalData/.test(sources.model),
    FAILURE.nameAuthority,
  );
  assertContract(
    /professionalTitle:\s*registration\.professionalTitle/.test(sources.model)
    && /professionalTitle:\s*row\.professional_title/.test(sources.gateway)
    && /value=\{registration\.professionalTitle\}/.test(sources.component),
    FAILURE.professionalAuthority,
  );
}

function auditExactCopyAndMenu(sources: Sources) {
  assertContract(
    sources.model.includes('export const COACH_HOME_WELCOME = "bienvenido Coach.";')
    && sources.model.includes(
      '"Gracias por registrarte. Estamos construyendo algo grande, muchas gracias por la confianza!";',
    ),
    FAILURE.exactHomeCopy,
  );

  const labels = [...sources.model.matchAll(/\{\s*id:\s*"[^"]+",\s*label:\s*"([^"]+)"/g)]
    .map((match) => match[1]);
  assertContract(
    JSON.stringify(labels) === JSON.stringify([
      "Mi perfil",
      "Panel principal",
      "Entrenemos",
      "Comparación semanal",
      "Modificar ciclo de entrenamiento",
      "Historial ciclo de entrenamiento",
      "Calendario",
      "Mensajes",
      "Cerrar sesión",
    ]),
    FAILURE.menuOrder,
  );
}

function auditClosedCoachNavigation(sources: Sources) {
  const disabledStart = sources.component.indexOf('if (item.availability === "disabled")');
  const disabledEnd = sources.component.indexOf('if (item.id === "profile")', disabledStart);
  const disabledBranch = sources.component.slice(disabledStart, disabledEnd);
  assertContract(
    disabledStart >= 0
    && disabledEnd > disabledStart
    && /aria-disabled="true"/.test(disabledBranch)
    && /\sdisabled(?:\s|>)/.test(disabledBranch)
    && !/href=|onClick=|onNavigate|router\.|dispatch\(/.test(disabledBranch),
    FAILURE.disabledNavigation,
  );

  assertContract(
    /export type CoachPortalScreen\s*=\s*"home"\s*\|\s*"profile"\s*;/.test(sources.model)
    && !/screen:\s*"(?:dashboard|training|comparison|calendar|messages|cycle)/.test(sources.model),
    FAILURE.futureScreen,
  );

  const profileStart = sources.component.indexOf('if (item.id === "profile")');
  const profileEnd = sources.component.indexOf(
    '\n              return (\n                <li key={item.id} className={styles.logoutRow}>',
    profileStart,
  );
  const profileBranch = sources.component.slice(profileStart, profileEnd);
  assertContract(
    /onClick=\{onOpenProfile\}/.test(profileBranch)
    && /case "profile_opened":[\s\S]*screen:\s*"profile"/.test(sources.model)
    && /<CoachPortalProfile/.test(sources.component),
    FAILURE.profileNavigation,
  );
}

function auditReadOnlyCoachProfile(sources: Sources) {
  const coachFeatureSource = `${sources.model}\n${sources.component}`;
  assertContract(
    !/ProfileScreen|profilePersonalData|useProfileController|userProfile|user_metadata|app_metadata|\.from\("profiles"\)/.test(
      coachFeatureSource,
    ),
    FAILURE.userProfileData,
  );

  assertContract(
    /const age\s*=\s*calculateAgeFromBirthDate\(\s*registration\.birthDate,\s*referenceDate,?\s*\)/.test(
      sources.model,
    )
    && !/interface CoachRegistrationRecord[\s\S]*?\bage\??:/.test(sources.controller),
    FAILURE.derivedAge,
  );

  const editStart = sources.component.indexOf('aria-label="Editar perfil (próximamente)"');
  const editEnd = sources.component.indexOf("</button>", editStart);
  const editControl = sources.component.slice(editStart, editEnd);
  assertContract(
    editStart >= 0
    && editEnd > editStart
    && /aria-disabled="true"/.test(editControl)
    && /\sdisabled(?:\s|>)/.test(editControl)
    && !/onClick=/.test(editControl),
    FAILURE.editingEnabled,
  );

  assertContract(
    !/fetch\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|\.from\(|supabase|repository|onSave|onUpload/.test(
      coachFeatureSource,
    ),
    FAILURE.coachWrite,
  );
}

function auditLogoutAndStaleSafety(sources: Sources) {
  const logout = functionText(sources.root, ROOT_PATH, "handleLogout");
  const clearSession = functionText(sources.root, ROOT_PATH, "clearUserSessionState");
  const componentLogout = functionText(sources.component, COMPONENT_PATH, "handleLogout");
  assertContract(
    /multiportalAuth\.invalidatePortalOperations\(\)/.test(logout)
    && /signOut\(\{\s*scope:\s*"local"\s*\}\)/.test(logout)
    && /replaceCoachPortalSession\(null\)/.test(clearSession)
    && /dispatch\(\{\s*type:\s*"reset"\s*\}\)/.test(componentLogout),
    FAILURE.logoutRetainsState,
  );

  const authorization = functionText(
    sources.root,
    ROOT_PATH,
    "authorizeAndContinuePortalSession",
  );
  const staleGuardIndex = authorization.search(
    /access\.state === "stale"\s*\|\|\s*!multiportalAuth\.isPortalResolutionCurrent\(resolutionOwner\)/,
  );
  const applyIndex = authorization.indexOf("applySessionState(authState)");
  assertContract(
    staleGuardIndex >= 0
    && applyIndex > staleGuardIndex
    && /function invalidatePortalOperations\(\)[\s\S]*portalResolutionOwnersRef\.current\.invalidate\(\)/.test(
      sources.hook,
    ),
    FAILURE.staleRemount,
  );
}

function auditTypedCoachEvidence(sources: Sources) {
  const controllerRecord = sources.controller.match(
    /export interface CoachRegistrationRecord \{[\s\S]*?\n\}/,
  )?.[0] ?? "";
  for (const field of [
    "userId",
    "createdAt",
    "firstName",
    "lastName",
    "birthDate",
    "gender",
    "phoneNumber",
    "professionalTitle",
    "contactEmail",
  ]) {
    if (!new RegExp(`\\b${field}:`).test(controllerRecord)) {
      assertContract(false, FAILURE.omittedProfessionalTitle);
    }
  }
  assertContract(
    sources.gateway.includes(
      '"user_id,created_at,first_name,last_name,birth_date,gender,phone_number,professional_title,contact_email"',
    )
    && /createdAt:\s*row\.created_at/.test(sources.gateway)
    && /professionalTitle:\s*row\.professional_title/.test(sources.gateway)
    && /contactEmail:\s*row\.contact_email/.test(sources.gateway)
    && /coach:\s*coachRegistration/.test(sources.controller)
    && /registration:\s*access\.coach/.test(sources.root),
    FAILURE.omittedProfessionalTitle,
  );

  const registerCoach = functionText(sources.controller, CONTROLLER_PATH, "registerCoach");
  const registerSharedCoach = functionText(
    sources.controller,
    CONTROLLER_PATH,
    "registerSharedCoach",
  );
  const registerSeparateCoach = functionText(
    sources.controller,
    CONTROLLER_PATH,
    "registerSeparateCoach",
  );
  assertContract(
    /input\.flow === "shared"/.test(registerCoach)
    && /registerSharedCoach\(input\.registration, owner, gateway\)/.test(registerCoach)
    && /registerSeparateCoach\(input, owner, gateway\)/.test(registerCoach)
    && (registerSharedCoach.match(/gateway\.createSharedCoachRegistration\(/g) ?? []).length === 1
    && /coachRegistration\.userId !== currentIdentity\.userId/.test(registerSharedCoach)
    && (registerSeparateCoach.match(/gateway\.getCoachRegistration\(/g) ?? []).length === 1
    && /coachRegistration\.userId !== identity\.userId/.test(registerSeparateCoach)
    && !/gateway\.createCoachRegistration/.test(
      `${registerCoach}\n${registerSharedCoach}\n${registerSeparateCoach}`,
    ),
    FAILURE.omittedProfessionalTitle,
  );
}

function auditNoPrematureEmail(sources: Sources) {
  const executableSources = [
    sources.root,
    sources.controller,
    sources.gateway,
    sources.hook,
    sources.model,
    sources.component,
  ].join("\n");
  assertContract(
    !/sendCoachWelcomeEmail|sendCoachMembershipEmail|resend\.|sendgrid|postmark|mailgun|smtpTransport|emailjs/.test(
      executableSources,
    ),
    FAILURE.emailImplemented,
  );
}

function auditProhibitedArtifacts(sources: Sources) {
  const packageJson = JSON.parse(sources.packageJson) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencyNames = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  });
  const status = spawnSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" });
  const changedEntries = (status.stdout ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3).trim(),
    }));
  const contactMigrationRenameInProgress =
    !existsSync(AUTH_SEPARATE_LEGACY_CONTACT_MIGRATION_PATH)
    && existsSync(AUTH_SEPARATE_CONTACT_MIGRATION_PATH)
    && changedEntries.some(({ path, status: entryStatus }) => (
      entryStatus === " D"
      && path === AUTH_SEPARATE_LEGACY_CONTACT_MIGRATION_PATH
    ))
    && changedEntries.some(({ path, status: entryStatus }) => (
      entryStatus === "??"
      && path === AUTH_SEPARATE_CONTACT_MIGRATION_PATH
    ));
  const allSources = Object.values(sources).join("\n");
  assertContract(
    !dependencyNames.some((name) => /resend|sendgrid|postmark|mailgun|nodemailer|emailjs/i.test(name))
    && !changedEntries.some(({ path }) => (
      path === "package-lock.json"
      || (
        path.startsWith("supabase/migrations/")
        && path !== AUTH_CONFIRMATION_MIGRATION_PATH
        && path !== AUTH_SEPARATE_CONTACT_MIGRATION_PATH
        && !(
          contactMigrationRenameInProgress
          && path === AUTH_SEPARATE_LEGACY_CONTACT_MIGRATION_PATH
        )
      )
      || /(^|\/)\.env(?:\.|$)/.test(path)
    ))
    && !/service_role|SUPABASE_SERVICE_ROLE|PRIVATE_KEY/.test(allSources),
    FAILURE.prohibitedArtifact,
  );
}

function auditConfirmationAndFutureEmailContract(sources: Sources) {
  assertContract(
    /export const USER_REGISTRATION_CONFIRMATION_MESSAGE\s*=\s*\n\s*"Si corresponde, completa la confirmación desde tu correo\. También puedes iniciar sesión, recuperar tu contraseña o usar otro correo de acceso\.";/.test(
      sources.controller,
    )
    && /export const COACH_REGISTRATION_CONFIRMATION_MESSAGE\s*=\s*\n\s*USER_REGISTRATION_CONFIRMATION_MESSAGE;/.test(
      sources.controller,
    )
    && /signup\.kind === "confirmation_required" \|\| signup\.kind === "existing_identity"/.test(
      sources.controller,
    )
    && /state:\s*"coach_confirmation_required"[\s\S]*message:\s*COACH_REGISTRATION_CONFIRMATION_MESSAGE/.test(
      sources.controller,
    ),
    FAILURE.confirmationRemoved,
  );

  const registerSeparateCoach = functionText(
    sources.controller,
    CONTROLLER_PATH,
    "registerSeparateCoach",
  );
  const signupCalls = registerSeparateCoach.match(/gateway\.signUpForCoachRegistration\(/g) ?? [];
  const signupIndex = registerSeparateCoach.indexOf("gateway.signUpForCoachRegistration(");
  const neutralResultIndex = registerSeparateCoach.indexOf(
    'signup.kind === "confirmation_required" || signup.kind === "existing_identity"',
  );
  const coachLookupIndex = registerSeparateCoach.indexOf("gateway.getCoachRegistration(");
  const activeIdentityIndex = registerSeparateCoach.indexOf("gateway.getCurrentIdentity(undefined, owner)");
  assertContract(
    signupCalls.length === 1
    && signupIndex >= 0
    && neutralResultIndex > signupIndex
    && coachLookupIndex > neutralResultIndex
    && activeIdentityIndex > coachLookupIndex,
    FAILURE.confirmationResent,
  );

  assertContract(
    sources.productContract.includes("## 10. Correos Coach futuros — AUTH-COACH-02")
    && sources.productContract.includes("### AC-037 — Identidades duales históricas")
    && sources.productContract.includes(
      "Una identidad de Supabase Auth con membresía Usuario puede activar también su",
    )
    && sources.productContract.includes("comparte correo, contraseña y sesión")
    && /identidad Coach\s+separada con otro correo/.test(sources.productContract)
    && sources.productContract.includes("El mismo correo de acceso no puede representar dos identidades")
    && sources.productContract.includes("`contact_email` profesional Coach puede coincidir")
    && sources.productContract.includes("nunca participa en login, ownership")
    && sources.productContract.includes("### AC-040 — Selección explícita del registro Coach híbrido")
    && sources.productContract.includes("Ahora también eres Coach en Organizatech")
    && sources.productContract.includes("Bienvenido a Organizatech Coaching")
    && sources.productContract.includes("Tu cuenta Coach fue creada correctamente.")
    && sources.productContract.includes("exactamente una vez")
    && sources.productContract.includes("idempotente")
    && /no\s+revertirá\s+la membresía/.test(sources.productContract)
    && sources.productContract.includes("confirmación normal de Supabase Auth")
    && sources.roadmap.includes("### AUTH-COACH-02 — Correos de membresía Coach")
    && sources.roadmap.includes("### AUTH-GOOGLE-01 — OAuth Google")
    && sources.roadmap.includes("La misma cuenta Google debe compartir identidad"),
    FAILURE.emailContractMissing,
  );
}

function auditIntegration(sources: Sources) {
  auditDestinations(sources);
  auditCoachComposition(sources);
  auditSelectedPortal(sources);
  auditCoachPresentationAuthorities(sources);
  auditExactCopyAndMenu(sources);
  auditClosedCoachNavigation(sources);
  auditReadOnlyCoachProfile(sources);
  auditLogoutAndStaleSafety(sources);
  auditTypedCoachEvidence(sources);
  auditNoPrematureEmail(sources);
  auditProhibitedArtifacts(sources);
  auditConfirmationAndFutureEmailContract(sources);
}

const mutations = [
  {
    name: "coach_authorized continúa al portal Usuario",
    source: "root" as const,
    expectedFailure: FAILURE.coachContinuesUser,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "        replaceCoachPortalSession(nextCoachPortalSession);",
      "        return continueAuthenticatedSession(authState, intent);",
      "M01",
    ),
  },
  {
    name: "Usuario y Coach comparten el mismo destino",
    source: "root" as const,
    expectedFailure: FAILURE.destinationsShared,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '      case "user_authorized": {',
      '      case "coach_authorized": {',
      "M02",
    ),
  },
  {
    name: "Coach-only deja de montar su boundary propio",
    source: "root" as const,
    expectedFailure: FAILURE.coachMountsUser,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "  if (coachPortalSession) {",
      "  if (false && coachPortalSession) {",
      "M03",
    ),
  },
  {
    name: "identidad dual ignora el portal seleccionado",
    source: "controller" as const,
    expectedFailure: FAILURE.selectedPortalIgnored,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '    if (input.requestedPortal === "usuario") {',
      "    if (true) {",
      "M04",
    ),
  },
  {
    name: "nombre Coach deja de derivar de la fila autoritativa",
    source: "model" as const,
    expectedFailure: FAILURE.nameAuthority,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "    fullName: `${registration.firstName} ${registration.lastName}`.trim(),",
      '    fullName: session.email ?? "",',
      "M05",
    ),
  },
  {
    name: "profesión deja de usar professional_title",
    source: "model" as const,
    expectedFailure: FAILURE.professionalAuthority,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "    professionalTitle: registration.professionalTitle,",
      "    professionalTitle: registration.firstName,",
      "M06",
    ),
  },
  {
    name: "copy exacto del inicio cambia",
    source: "model" as const,
    expectedFailure: FAILURE.exactHomeCopy,
    apply: (value: string) => replaceExactlyOnce(
      value,
      'export const COACH_HOME_WELCOME = "bienvenido Coach.";',
      'export const COACH_HOME_WELCOME = "Bienvenido Coach";',
      "M07",
    ),
  },
  {
    name: "orden aprobado del menú cambia",
    source: "model" as const,
    expectedFailure: FAILURE.menuOrder,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '  { id: "dashboard", label: "Panel principal", availability: "disabled" },\n  { id: "training", label: "Entrenemos", availability: "disabled" },',
      '  { id: "training", label: "Entrenemos", availability: "disabled" },\n  { id: "dashboard", label: "Panel principal", availability: "disabled" },',
      "M08",
    ),
  },
  {
    name: "opción bloqueada obtiene handler",
    source: "component" as const,
    expectedFailure: FAILURE.disabledNavigation,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '<button className={styles.disabledMenuItem} type="button" aria-disabled="true" disabled>',
      '<button className={styles.disabledMenuItem} type="button" aria-disabled="true" disabled onClick={onOpenProfile}>',
      "M09",
    ),
  },
  {
    name: "opción futura agrega una pantalla real",
    source: "model" as const,
    expectedFailure: FAILURE.futureScreen,
    apply: (value: string) => replaceExactlyOnce(
      value,
      'export type CoachPortalScreen = "home" | "profile";',
      'export type CoachPortalScreen = "home" | "profile" | "dashboard";',
      "M10",
    ),
  },
  {
    name: "Mi perfil deja de abrir el perfil Coach",
    source: "component" as const,
    expectedFailure: FAILURE.profileNavigation,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "                      onClick={onOpenProfile}\n",
      "",
      "M11",
    ),
  },
  {
    name: "perfil Coach consume datos del perfil Usuario",
    source: "component" as const,
    expectedFailure: FAILURE.userProfileData,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '<CoachProfileField label="Nombre" value={registration.firstName} />',
      '<CoachProfileField label="Nombre" value={profilePersonalData.firstName} />',
      "M12",
    ),
  },
  {
    name: "edad se hardcodea en cliente",
    source: "model" as const,
    expectedFailure: FAILURE.derivedAge,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "  const age = calculateAgeFromBirthDate(registration.birthDate, referenceDate);",
      "  const age = 36;",
      "M13",
    ),
  },
  {
    name: "edición del perfil se habilita sin backend",
    source: "component" as const,
    expectedFailure: FAILURE.editingEnabled,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '            aria-disabled="true"\n            disabled\n',
      '            aria-disabled="false"\n',
      "M14",
    ),
  },
  {
    name: "perfil Coach agrega un write",
    source: "component" as const,
    expectedFailure: FAILURE.coachWrite,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "  const { registration } = session;\n\n  return (",
      '  const { registration } = session;\n  void fetch("/api/coach/profile", { method: "PATCH" });\n\n  return (',
      "M15",
    ),
  },
  {
    name: "logout conserva el estado Coach",
    source: "root" as const,
    expectedFailure: FAILURE.logoutRetainsState,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "  ) {\n    replaceUserPortalAuthorizationProof(null);\n    replaceCoachPortalSession(null);\n    if (\n",
      "  ) {\n    replaceUserPortalAuthorizationProof(null);\n    void coachPortalSessionRef.current;\n    if (\n",
      "M16",
    ),
  },
  {
    name: "resolución stale puede remontar Coach",
    source: "root" as const,
    expectedFailure: FAILURE.staleRemount,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '    if (access.state === "stale" || !multiportalAuth.isPortalResolutionCurrent(resolutionOwner)) {',
      '    if (access.state === "stale") {',
      "M17",
    ),
  },
  {
    name: "professional_title se omite del transporte",
    source: "gateway" as const,
    expectedFailure: FAILURE.omittedProfessionalTitle,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '  "user_id,created_at,first_name,last_name,birth_date,gender,phone_number,professional_title,contact_email";',
      '  "user_id,created_at,first_name,last_name,birth_date,gender,phone_number,contact_email";',
      "M18",
    ),
  },
  {
    name: "correo Coach se implementa anticipadamente",
    source: "root" as const,
    expectedFailure: FAILURE.emailImplemented,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '      case "coach_authorized": {\n',
      '      case "coach_authorized": {\n        void sendCoachWelcomeEmail();\n',
      "M19",
    ),
  },
  {
    name: "se agrega una dependencia prohibida",
    source: "packageJson" as const,
    expectedFailure: FAILURE.prohibitedArtifact,
    apply: (value: string) => replaceExactlyOnce(
      value,
      '    "zustand": "^5.0.3"\n',
      '    "zustand": "^5.0.3",\n    "resend": "^6.0.0"\n',
      "M20",
    ),
  },
  {
    name: "confirmación normal de Auth se elimina",
    source: "controller" as const,
    expectedFailure: FAILURE.confirmationRemoved,
    apply: (value: string) => replaceExactlyOnce(
      value,
      'export const USER_REGISTRATION_CONFIRMATION_MESSAGE =\n  "Si corresponde, completa la confirmación desde tu correo. También puedes iniciar sesión, recuperar tu contraseña o usar otro correo de acceso.";',
      'export const USER_REGISTRATION_CONFIRMATION_MESSAGE =\n  "Cuenta Coach creada.";',
      "M21",
    ),
  },
  {
    name: "agregar membresía reenvía confirmación Auth",
    source: "controller" as const,
    expectedFailure: FAILURE.confirmationResent,
    apply(value: string) {
      const sourceFile = parseSource(value, CONTROLLER_PATH);
      const registerSeparateCoach = functionText(
        value,
        CONTROLLER_PATH,
        "registerSeparateCoach",
      );
      const mutatedFunction = replaceExactlyOnce(
        registerSeparateCoach,
        "    const coachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
        "    await gateway.signUpForCoachRegistration(input, owner);\n    const coachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
        "M22",
      );
      const registrationFunction = findFunction(sourceFile, "registerSeparateCoach");
      return `${value.slice(0, registrationFunction.getStart(sourceFile))}${mutatedFunction}${value.slice(registrationFunction.end)}`;
    },
  },
  {
    name: "AUTH-COACH-02 deja de estar documentado",
    source: "productContract" as const,
    expectedFailure: FAILURE.emailContractMissing,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "## 10. Correos Coach futuros — AUTH-COACH-02",
      "## 10. Correos Coach futuros",
      "M23",
    ),
  },
] as const;

const EXPECTED_MUTATION_PROBE_COUNT = 23;
assert.equal(
  mutations.length,
  EXPECTED_MUTATION_PROBE_COUNT,
  "AUTH-COACH-01 Portal fija exactamente 23 mutation probes",
);

const positiveControls = [
  {
    name: "comentarios inocentes",
    source: "root" as const,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "  async function continueAuthorizedPortalAccess(\n",
      "  // Selección de destino ya autorizada por backend.\n  async function continueAuthorizedPortalAccess(\n",
      "control comentario",
    ),
  },
  {
    name: "formato multilinea válido",
    source: "model" as const,
    apply: (value: string) => replaceExactlyOnce(
      value,
      "  const age = calculateAgeFromBirthDate(registration.birthDate, referenceDate);",
      `  const age = calculateAgeFromBirthDate(
    registration.birthDate,
    referenceDate,
  );`,
      "control formato",
    ),
  },
  {
    name: "renombre local válido",
    source: "root" as const,
    apply: (value: string) => value.replaceAll(
      "nextCoachPortalSession",
      "authorizedCoachSession",
    ),
  },
] as const;

const EXPECTED_POSITIVE_CONTROL_COUNT = 3;
assert.equal(
  positiveControls.length,
  EXPECTED_POSITIVE_CONTROL_COUNT,
  "AUTH-COACH-01 Portal fija tres controles positivos",
);

test("contrato Coach Portal tolera comentarios, formato y renombres válidos", () => {
  const sources = readSources();
  auditIntegration(sources);
  for (const control of positiveControls) {
    const original = sources[control.source];
    const transformed = control.apply(original);
    assert.notEqual(transformed, original, `${control.name}: transformación efectiva`);
    assert.notEqual(sha256(transformed), sha256(original), `${control.name}: SHA efectivo`);
    assertValidSource(transformed, SOURCE_PATHS[control.source]);
    auditIntegration({ ...sources, [control.source]: transformed });
  }
});

function assertMutationContract(
  original: string,
  mutated: string,
  path: string,
  name: string,
  expectedFailure: string,
  sources: Sources,
  sourceKey: SourceKey,
) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "organizatech-coach-portal-"));
  const temporaryPath = join(temporaryDirectory, path.endsWith(".tsx") ? "source.tsx" : "source.txt");
  const originalHash = sha256(original);
  const mutatedHash = sha256(mutated);
  writeFileSync(temporaryPath, original, "utf8");
  try {
    writeFileSync(temporaryPath, mutated, "utf8");
    const materialized = readFileSync(temporaryPath, "utf8");
    assert.equal(materialized, mutated, `${name}: mutación materializada byte a byte`);
    assert.equal(sha256(materialized), mutatedHash, `${name}: SHA mutado materializado`);
    assert.notEqual(mutatedHash, originalHash, `${name}: mutación cambia SHA`);
    assertValidSource(materialized, path);
    assert.throws(
      () => auditIntegration({ ...sources, [sourceKey]: materialized }),
      (error: unknown) => (
        error instanceof assert.AssertionError
        && error.message.split(/\r?\n/, 1)[0] === expectedFailure
      ),
      `${name}: primera expectedFailure exacta`,
    );
  } finally {
    try {
      if (existsSync(temporaryPath)) {
        writeFileSync(temporaryPath, original, "utf8");
        const restored = readFileSync(temporaryPath, "utf8");
        assert.equal(restored, original, `${name}: restauración byte a byte en finally`);
        assert.equal(sha256(restored), originalHash, `${name}: restauración SHA en finally`);
      }
      assert.equal(
        sha256(readFileSync(path, "utf8")),
        originalHash,
        `${name}: fuente productiva conserva byte y SHA`,
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

for (const mutation of mutations) {
  test(`Coach Portal mutation probe: ${mutation.name}`, () => {
    const sources = readSources();
    const original = sources[mutation.source];
    const mutated = mutation.apply(original);
    assert.notEqual(mutated, original, `${mutation.name}: mutación efectiva`);
    assert.notEqual(sha256(mutated), sha256(original), `${mutation.name}: SHA efectivo`);
    assertMutationContract(
      original,
      mutated,
      SOURCE_PATHS[mutation.source],
      mutation.name,
      mutation.expectedFailure,
      sources,
      mutation.source,
    );
  });
}

console.log(
  `AUTH-COACH-01 Coach Portal mutation probes: ${mutations.length}/${EXPECTED_MUTATION_PROBE_COUNT}; controles positivos: ${positiveControls.length}/${EXPECTED_POSITIVE_CONTROL_COUNT}`,
);
