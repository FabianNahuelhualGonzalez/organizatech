import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canAccessStudentEvaluations } from "./model/evaluation-navigation";

const coach = readFileSync("src/features/evaluations/components/coach-evaluations.tsx", "utf8");
const student = readFileSync("src/features/evaluations/components/student-evaluations.tsx", "utf8");
const model = readFileSync("src/features/evaluations/model/evaluation-types.ts", "utf8");

test("Coach cubre biblioteca, constructor, envío, snapshot y revisión aprobados", () => {
  for (const copy of ["+ Agregar", "Evaluaciones enviadas", "Agregar más preguntas", "Esta evaluación solicita datos sensibles.", "Al marcarla, el alumno deberá aceptar responder preguntas sobre salud, lesiones, medicación o alimentación.", "Extender fecha", "Recordar", "Ver respuesta"]) {
    assert.ok(coach.includes(copy), `Falta el texto aprobado: ${copy}`);
  }
  assert.doesNotMatch(coach, /Ocultar|ocultar/);
  assert.match(coach, /aria-label=\{`Eliminar \$\{template\.name\}`\}/);
  assert.match(coach, /Confirmar eliminación/);
  assert.match(coach, /deleteOwnEvaluationTemplate/);
  assert.match(coach, /EVALUATION_TABLE_PRESETS/);
  assert.match(coach, /listOwnEvaluationStudents/);
  assert.match(coach, /La evaluación fue creada, pero el correo está pendiente de reintento/);
  assert.match(coach, /El recordatorio fue creado, pero el correo está pendiente de reintento/);
  for (const copy of [
    "Formulario pendiente de responder.",
    "Formulario respondido — OK.",
    "Formulario vencido.",
    "Recordatorios enviados:",
    "Formularios enviados:",
    "Pendientes:",
    "Respondidos:",
    "Recordar pendientes",
  ]) {
    assert.ok(`${coach}\n${model}`.includes(copy), `Falta el texto aprobado: ${copy}`);
  }
  assert.match(coach, /Se crearon los recordatorios, pero uno o más correos están pendientes de reintento/);
});

test("envío móvil mantiene controles equivalentes sin overflow horizontal", () => {
  const css = readFileSync("src/features/evaluations/components/evaluations.module.css", "utf8");
  for (const className of ["sendForm", "sendControl", "dateField"]) {
    assert.match(coach, new RegExp(`styles\\.${className}`));
    assert.match(css, new RegExp(`\\.${className}`));
  }
  assert.match(css, /\.sendControl \{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*max-width: 100%/);
  assert.match(css, /\.dateField \{[\s\S]*inline-size: 100%;[\s\S]*min-inline-size: 0;[\s\S]*max-inline-size: 100%;[\s\S]*overflow: hidden/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*min-inline-size: 0;[\s\S]*max-inline-size: 100%/);
  assert.match(css, /\.pillButton \{[\s\S]*white-space: nowrap/);
  assert.match(css, /\.inlineActions \{[\s\S]*flex-wrap: wrap/);
  assert.match(css, /\.assignmentCard \.inlineActions > button \{ width: 100%; \}/);
});

test("resultado de alumno separa nombre completo y correo en dos líneas", () => {
  assert.match(coach, /styles\.listButton[\s\S]*<strong>\{student\.name\}<\/strong><span>\{student\.email\}<\/span>/);
  assert.match(readFileSync("src/features/evaluations/components/evaluations.module.css", "utf8"), /\.listButton strong,[\s\S]*\.listButton span \{[\s\S]*display: block/);
});

test("Alumno cubre tabs, borrador, vencimiento, consentimiento exacto y tablas apiladas", () => {
  for (const copy of ["Pendientes", "Vencidas", "Completadas", "Guardar borrador", "El plazo para responder venció", "+ Agregar fila", "Evaluación enviada"]) {
    assert.ok(student.includes(copy), `Falta el texto aprobado: ${copy}`);
  }
  assert.match(model, /Confirmo que la información entregada \(salud, lesiones, medicación o alimentación\) es correcta y autorizo a mi coach vinculado a acceder a ella para ajustar mi plan\./);
  assert.doesNotMatch(student, /overflow-x|<table/);
  assert.match(student, /La evaluación fue enviada, pero el correo al coach está pendiente de reintento/);
});

test("Mis evaluaciones conserva el guard y compone Formularios, Documentos y Fotos", () => {
  const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const topbar = readFileSync("src/features/app-shell/components/app-topbar.tsx", "utf8");
  const portalShell = readFileSync("src/features/user-portal-shell/components/user-portal-shell.tsx", "utf8");
  const portalTopbar = readFileSync("src/features/user-portal-shell/components/user-portal-topbar.tsx", "utf8");
  assert.match(root, /screen === "evaluaciones" && supabaseUser\?\.id && hasStudentEvaluationsAccess/);
  assert.match(root, /contextLabel=\{screen === "evaluaciones" && hasStudentEvaluationsAccess \? "Evaluaciones" : null\}/);
  assert.match(topbar, /contextLabel \? \(/);
  assert.match(portalShell, /contextLabel=\{contextLabel\}/);
  assert.match(portalTopbar, /\{contextLabel \? <span className=\{styles\.brandContext\}>\{contextLabel\}<\/span> : null\}/);
  assert.match(student, /Mis evaluaciones[\s\S]*\["formularios", "documentos", "fotos"\]/);
  assert.match(student, /section === "formularios" && !loading && !loadError && assignments\.length > 0 \? <div className=\{styles\.studentTabs\}/);
  assert.match(student, /section === "documentos" \? medicalDocuments/);
  assert.match(student, /section === "fotos" \? progressPhotos/);
});

test("Documentos y Fotos usan sólo gateways propios y la tarjeta previa desaparece", () => {
  const photos = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  const documents = readFileSync("src/features/progress-records/components/student-medical-documents.tsx", "utf8");
  assert.doesNotMatch(photos, /Ver mis fotos|styles\.entry/);
  assert.match(photos, /getStudentProgressPhotoGateway\(\)\.downloadOwnPhoto/);
  assert.match(documents, /getStudentMedicalDocumentGateway\(\)\.downloadOwn/);
  assert.match(documents, /gateway\.reserve\(\)[\s\S]*gateway\.stage\([\s\S]*gateway\.finalize\(/);
  assert.match(documents, /setNotice\("Guardado"\)/);
  assert.match(documents, /Compartir con mi coach/);
  assert.match(documents, /Dejar de compartir/);
  assert.doesNotMatch(`${photos}\n${documents}`, /\.storage\.from\(|\.rpc\(|getPublicUrl|createSignedUrl/);
  assert.doesNotMatch(documents, /Enviar al coach|Guardar y enviar|\.docx|image\/jpeg/);
  assert.match(documents, /PDF · máx\. 25 MB por archivo/);
  assert.match(documents, /Elige un PDF válido de hasta 25 MB\./);
  assert.match(documents, /<small>PDF · máx\. 25 MB<\/small>/);
  assert.match(documents, /format\(bytes \/ 1024 \/ 1024\)\} MB/);
  assert.doesNotMatch(documents, /MiB/);
});

test("Mis evaluaciones mantiene márgenes, estado vacío y textos aprobados", () => {
  const css = readFileSync("src/features/evaluations/components/evaluations.module.css", "utf8");
  assert.match(css, /\.studentBack \{[\s\S]*padding: 12px 14px 0/);
  assert.match(css, /\.studentIntro \{[\s\S]*padding: 12px 16px 0/);
  assert.match(css, /\.studentSegmentWrap \{[\s\S]*padding: 14px 14px 0/);
  assert.match(css, /\.studentScroll \{[^}]*overflow-y: auto/);
  assert.match(css, /\.studentContent \{[^}]*padding: 16px 14px 20px/);
  assert.match(css, /\.studentEmpty \{[\s\S]*min-height: 300px/);
  const scroll = student.indexOf('id="student-evaluations-content"');
  const sections = student.indexOf("className={styles.studentSegmentWrap}");
  const content = student.indexOf("className={styles.studentContent}");
  assert.ok(scroll >= 0 && scroll < sections && sections < content, "El selector se desplaza con el contenido");
  assert.match(student, /assignments\.length === 0 \? <div className=\{styles\.studentFirstEmpty\}>/);
  assert.match(student, /Aún no tienes evaluaciones/);
  for (const copy of ["No tienes evaluaciones pendientes", "No tienes evaluaciones vencidas", "Aún no has completado evaluaciones"]) {
    assert.ok(student.includes(copy));
  }
});

test("Nuevo check usa hoja privada y espera fotos publicadas", () => {
  const photos = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  const sheet = readFileSync("src/features/progress-records/components/student-progress-check-sheet.tsx", "utf8");
  const documents = readFileSync("src/features/progress-records/components/student-medical-documents.tsx", "utf8");
  assert.doesNotMatch(photos, /Nueva carga|Selecciona de 1 a 3 fotos|Elegir fotos/);
  assert.match(sheet, /role="dialog" aria-modal="true"/);
  assert.match(sheet, /¿Descartar este check\?/);
  assert.match(sheet, /"frente", "perfil", "espalda"/);
  assert.doesNotMatch(sheet, /sin comprimir|Calidad original/);
  assert.match(photos, /publishedAssetIds\.every[\s\S]*gateway\.createCheck\(checkedOn, publishedAssetIds\)/);
  assert.match(photos, /setNotice\("Check guardado"\)/);
  assert.match(documents, /Aún no tienes documentos[\s\S]*\+ Subir documento[\s\S]*Tus documentos son privados/);
});

test("Fotos permanece montada al volver del selector durante la revalidación del vínculo", () => {
  const controller = readFileSync("src/features/coach-linking/hooks/use-coach-linking-controller.ts", "utf8");
  const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const photos = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  const sheet = readFileSync("src/features/progress-records/components/student-progress-check-sheet.tsx", "utf8");
  const refresh = controller.slice(controller.indexOf("const refreshActive = useCallback("), controller.indexOf("const openForm = useCallback("));
  const access = { expectedUserId: "student", activeCoachLinkIdentityKey: "student", isCoachPortal: false } as const;

  assert.match(refresh, /window\.addEventListener\("focus", onResume\)/);
  assert.match(refresh, /document\.addEventListener\("visibilitychange", onResume\)/);
  assert.match(refresh, /snapshotRef\.current\.activeState !== "linked"/);
  assert.match(refresh, /activeState: "loading"/);
  assert.equal(canAccessStudentEvaluations({ ...access, activeCoachLinkState: "linked" }), true);
  assert.equal(canAccessStudentEvaluations({ ...access, activeCoachLinkState: "loading" }), true);
  assert.equal(canAccessStudentEvaluations({ ...access, activeCoachLinkIdentityKey: null, activeCoachLinkState: "loading" }), false);
  assert.match(root, /screen === "evaluaciones" && supabaseUser\?\.id && hasStudentEvaluationsAccess && \(/);
  assert.match(root, /if \(coachLinking\.snapshot\.activeState === "loading"\) return;/);
  assert.match(photos, /const \[composerOpen, setComposerOpen\] = useState\(false\)/);
  assert.match(sheet, /const \[slots, setSlots\] = useState/);
});

test("fallas de reserva, staging o cola conservan la hoja y permiten reintentar sin exponer errores crudos", () => {
  const photos = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  const sheet = readFileSync("src/features/progress-records/components/student-progress-check-sheet.tsx", "utf8");
  const save = photos.slice(photos.indexOf("async function saveNewCheck("), photos.indexOf("async function loadMore("));

  assert.match(save, /queuedPhotosRef\.current\[photo\.pose\] = pending/);
  assert.match(save, /if \(!pending\.staged\)/);
  assert.match(save, /if \(!pending\.enqueued\)/);
  assert.match(save, /No pudimos reservar la foto\. Reintenta sin volver a elegirla\./);
  assert.match(save, /No pudimos subir la foto a la zona privada\. Reintenta sin volver a elegirla\./);
  assert.match(save, /No pudimos poner la foto en cola\. Reintenta sin volver a elegirla\./);
  assert.doesNotMatch(save, /error\.message/);
  assert.ok(save.indexOf("await gateway.createCheck(checkedOn, publishedAssetIds)") < save.indexOf("closeCheckSheet()"));
  assert.match(sheet, /className=\{styles\.sheetFooter\}[\s\S]*role="alert"[\s\S]*className=\{styles\.sheetSave\}/);
});
