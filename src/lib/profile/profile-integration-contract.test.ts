import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static integration source contract only.
 *
 * This file does not render React, simulate user interaction or execute the
 * async profile flow. Runtime behavior belongs to the profile module tests;
 * these assertions only guard wiring, delegation and side-effect boundaries.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const profileScreenStaticSource = readFileSync("src/components/profile/ProfileScreen.tsx", "utf8");
const formFieldStaticSource = readFileSync("src/ui/forms/form-field.tsx", "utf8");
const avatarEditorStaticSource = readFileSync("src/components/profile/ProfileAvatarEditor.tsx", "utf8");
const userAvatarStaticSource = readFileSync("src/components/profile/UserAvatar.tsx", "utf8");
const profileAvatarStaticSource = readFileSync("src/lib/profile/profile-avatar.ts", "utf8");
const profileViewModelStaticSource = readFileSync("src/lib/profile/profile-view-model.ts", "utf8");
const packageStaticSource = readFileSync("package.json", "utf8");

function extractStaticSourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontro el inicio del contrato: ${startMarker}`);
  assert.ok(end > start, `No se encontro el final del contrato: ${endMarker}`);
  return source.slice(start, end);
}

function assertStaticMarkersInOrder(source: string, markers: string[]) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker);
    assert.ok(current >= 0, `Falta el paso requerido: ${marker}`);
    assert.ok(current > previous, `El paso esta fuera de orden: ${marker}`);
    previous = current;
  }
}

// CONTRATO ESTATICO 1: el componente delega la seleccion de fuentes y el view model.
assert.match(appStaticSource, /import \{ buildProfileViewModelFromSources \} from "@\/lib\/profile\/profile-view-model";/);
const viewModelSection = extractStaticSourceSection(appStaticSource, "  const profileViewModel = useMemo", "  const refreshProfileAvatar");
assert.match(viewModelSection, /buildProfileViewModelFromSources\(\{/);
assert.match(viewModelSection, /personalData: profilePersonalData/);
assert.match(viewModelSection, /avatar: profileAvatar/);
assert.doesNotMatch(viewModelSection, /buildProfileViewModel\(\{/);
assert.doesNotMatch(viewModelSection, /displayName: profilePersonalData|avatarPath: profileAvatar/);

// CONTRATO ESTATICO 2: el formulario referencia normalizacion, validacion y payload del dominio.
assert.match(profileScreenStaticSource, /buildProfileFormInitialValues/);
assert.match(profileScreenStaticSource, /buildProfilePersonalDataPayload/);
const submitSection = extractStaticSourceSection(profileScreenStaticSource, "  async function handleSubmit", "  function cancelEdition");
assertStaticMarkersInOrder(submitSection, [
  "const validation = buildProfilePersonalDataPayload(values)",
  "if (!validation.ok)",
  "await onSave({",
  "firstName: payload.first_name",
  "lastName: payload.last_name",
  "birthDate: payload.birth_date",
  "gender: payload.gender",
  "phoneNumber: payload.phone_number",
]);
assert.doesNotMatch(appStaticSource, /buildProfileFormInitialValues|buildProfilePersonalDataPayload/);

// CONTRATO ESTATICO 3: no existe dirty gate y el source bloquea guardar solo durante persistencia.
// P3-47A: el delimitador de cierre era `function ProfileField`, que dejo de existir al migrar ese
// wrapper local a la primitive compartida `FormField`. Se reancla a la siguiente declaracion de la
// misma fuente, `function ProfileSection`, que delimita exactamente la misma seccion.
const personalDataSection = extractStaticSourceSection(profileScreenStaticSource, "function PersonalDataSection", "function ProfileSection");
assert.doesNotMatch(personalDataSection, /\bisDirty\b|\bcanSave\b/);
// El submit sigue deshabilitado unicamente durante la persistencia; ahora se declara sobre la
// primitive compartida, conservando `type="submit"` y `disabled={isSaving}` de forma explicita.
assert.match(personalDataSection, /<Button variant="primary" type="submit" disabled=\{isSaving\}>/);

// CONTRATO ESTATICO 3B (P3-47A, estatico — no sustituye cobertura runtime): Profile consume las
// primitives compartidas y ya no declara su propio wrapper de campo.
assert.match(profileScreenStaticSource, /import \{ FormField \} from "@\/ui\/forms\/form-field";/);
assert.match(profileScreenStaticSource, /import \{ Button \} from "@\/ui\/buttons\/button";/);
assert.doesNotMatch(profileScreenStaticSource, /function ProfileField\b/, "el wrapper local debe haberse eliminado tras migrar sus callers");
assert.doesNotMatch(profileScreenStaticSource, /<ProfileField\b/, "no deben quedar callers del wrapper local");
assert.equal(
  (profileScreenStaticSource.match(/<FormField className="profile-field" label=/g) ?? []).length,
  6,
  "los seis campos del formulario editable siguen presentes y conservan la clase profile-field",
);
for (const fieldLabel of ["Nombre", "Apellido", "Fecha de nacimiento", "Género", "Celular", "Correo"]) {
  assert.ok(
    profileScreenStaticSource.includes(`label="${fieldLabel}"`),
    `el campo ${fieldLabel} debe conservarse`,
  );
}
// Las acciones del formulario conservan orden, textos, tipos y disabled.
assert.match(
  personalDataSection,
  /<Button variant="secondary" type="button" onClick=\{cancelEdition\} disabled=\{isSaving\}>\s*Cancelar\s*<\/Button>/,
);
assert.match(personalDataSection, /\{isSaving \? "Guardando\.\.\." : "Guardar cambios"\}/);
// Los botones que NO mapean a una variante autorizada permanecen nativos en P3-47A.
assert.match(profileScreenStaticSource, /<button\s+className="profile-edit-button"/);

// CONTRATO ESTATICO 3E (P3-50A — SOURCE-BASED): valida asociaciones declaradas en el source.
// No renderiza React, no inspecciona el DOM y no prueba el anuncio real de un lector de pantalla.
const formFieldStaticCode = formFieldStaticSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
assert.match(formFieldStaticSource, /controlId: string;/, "FormField exige un id explicito del control");
assert.match(formFieldStaticSource, /const errorId = `\$\{controlId\}-error`;/);
assert.match(formFieldStaticSource, /<label className=\{className\} htmlFor=\{controlId\}>/);
assert.match(formFieldStaticSource, /\{error && <small id=\{errorId\}>\{error\}<\/small>\}/);
for (const forbidden of [/\bcloneElement\b/, /\buseState\b|\buseEffect\b/, /role="alert"/, /aria-live=/]) {
  assert.doesNotMatch(formFieldStaticCode, forbidden, `FormField no debe incorporar ${forbidden}`);
}

const validatableProfileFields = [
  { label: "Nombre", id: "profile-first-name", errorKey: "firstName" },
  { label: "Apellido", id: "profile-last-name", errorKey: "lastName" },
  { label: "Fecha de nacimiento", id: "profile-birth-date", errorKey: "birthDate" },
  { label: "Género", id: "profile-gender", errorKey: "gender" },
  { label: "Celular", id: "profile-phone-number", errorKey: "phoneNumber" },
] as const;
const expectedProfileControlIds = [
  ...validatableProfileFields.map(({ id }) => id),
  "profile-email",
];
const declaredProfileControlIds = [
  ...profileScreenStaticSource.matchAll(
    /<FormField className="profile-field" label="[^"]+" controlId="([^"]+)"/g,
  ),
].map((match) => match[1]);
assert.deepEqual(
  declaredProfileControlIds,
  expectedProfileControlIds,
  "los seis controlId son literales, unicos y conservan el orden de los campos",
);
assert.equal(new Set(declaredProfileControlIds).size, 6, "los seis controlId deben ser unicos");

for (const { label, id, errorKey } of validatableProfileFields) {
  const fieldMatch = profileScreenStaticSource.match(new RegExp(
    `<FormField className="profile-field" label="${label}" controlId="${id}" error=\\{fieldErrors\\.${errorKey}\\}>([\\s\\S]*?)<\\/FormField>`,
  ));
  assert.ok(fieldMatch, `el campo ${label} debe conservar su error y controlId exactos`);
  const fieldSource = fieldMatch[1];
  assert.match(fieldSource, new RegExp(`\\bid="${id}"`), `${label}: controlId e id deben coincidir`);
  assert.match(
    fieldSource,
    new RegExp(`aria-invalid=\\{Boolean\\(fieldErrors\\.${errorKey}\\)\\}`),
    `${label}: aria-invalid depende solo de su error`,
  );
  assert.match(
    fieldSource,
    new RegExp(`aria-describedby=\\{fieldErrors\\.${errorKey} \\? "${id}-error" : undefined\\}`),
    `${label}: aria-describedby solo existe cuando hay error y apunta al small determinista`,
  );
}

const emailFieldMatch = profileScreenStaticSource.match(
  /<FormField className="profile-field" label="Correo" controlId="profile-email">([\s\S]*?)<\/FormField>/,
);
assert.ok(emailFieldMatch, "Correo conserva FormField con controlId literal");
assert.match(emailFieldMatch[1], /\bid="profile-email"/);
assert.match(emailFieldMatch[1], /\breadOnly\b/);
assert.match(emailFieldMatch[1], /aria-readonly="true"/);
assert.doesNotMatch(emailFieldMatch[1], /\berror=|aria-describedby|aria-invalid|fieldErrors/);

const renderedProfileControlIds = [
  ...profileScreenStaticSource.matchAll(
    /\bid="(profile-(?:first-name|last-name|birth-date|gender|phone-number|email))"/g,
  ),
].map((match) => match[1]);
assert.deepEqual(
  renderedProfileControlIds,
  expectedProfileControlIds,
  "cada control renderizado declara exactamente el mismo id literal que su FormField",
);
assert.equal(new Set(renderedProfileControlIds).size, 6, "los seis id de controles deben ser unicos");

// CONTRATO ESTATICO 3D (P3-48B — COMPROBACIONES SOURCE-BASED: leen el codigo fuente; NO renderizan
// React ni verifican el anuncio real de un lector de pantalla). Los mensajes dinamicos pasan a la
// primitive compartida StatusMessage, conservando clases, condiciones, textos y orden del DOM.
const statusMessageStaticSource = readFileSync("src/ui/feedback/status-message.tsx", "utf8");
assert.equal(
  (statusMessageStaticSource.match(/^export function StatusMessage\b/gm) ?? []).length,
  1,
  "una sola definicion productiva de StatusMessage",
);
// Semantica explicita: polite para estados neutros, alert para errores inequivocos.
assert.match(statusMessageStaticSource, /role="status" aria-live="polite"/);
assert.match(statusMessageStaticSource, /role="alert"/);
// El spread no puede degradar la semantica: role/aria-live se omiten del tipo y se aplican despues.
assert.match(statusMessageStaticSource, /Omit<HTMLAttributes<HTMLParagraphElement>, "role" \| "aria-live" \| "children">/);
const statusMessageStaticCode = statusMessageStaticSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
for (const forbidden of [/useState|useEffect/, /dangerouslySetInnerHTML/, /onClick/, /useRouter|navigate/]) {
  assert.doesNotMatch(statusMessageStaticCode, forbidden, `StatusMessage no debe incorporar ${forbidden}`);
}

// Profile ya no duplica el markup migrado.
assert.match(profileScreenStaticSource, /import \{ StatusMessage \} from "@\/ui\/feedback\/status-message";/);
assert.match(avatarEditorStaticSource, /import \{ StatusMessage \} from "@\/ui\/feedback\/status-message";/);
assert.doesNotMatch(profileScreenStaticSource, /<p className="profile-form-status"|<p className="profile-avatar-status"/);
assert.doesNotMatch(avatarEditorStaticSource, /<p className="profile-avatar-status"/);
assert.equal((profileScreenStaticSource.match(/<StatusMessage\b/g) ?? []).length, 5, "los cinco mensajes de ProfileScreen migran");
assert.equal((avatarEditorStaticSource.match(/<StatusMessage\b/g) ?? []).length, 1, "el mensaje del editor de avatar migra");

// Paridad exacta de cada mensaje: clase, condicion y texto.
assert.match(
  profileScreenStaticSource,
  /\{\(statusMessage \|\| externalError\) && \(\s*<StatusMessage className="profile-avatar-status">\{statusMessage \|\| externalError\}<\/StatusMessage>/,
  "se conserva la prioridad statusMessage || externalError",
);
assert.match(profileScreenStaticSource, /\{isLoading && <StatusMessage className="profile-form-status">Cargando datos personales\.\.\.<\/StatusMessage>\}/);
assert.match(profileScreenStaticSource, /\{!canEdit && <StatusMessage className="profile-form-status">Inicia sesión para guardar tu perfil\.<\/StatusMessage>\}/);
assert.equal(
  (profileScreenStaticSource.match(/\{statusMessage && <StatusMessage className="profile-form-status">\{statusMessage\}<\/StatusMessage>\}/g) ?? []).length,
  2,
  "los dos mensajes de statusMessage (edicion y lectura) se conservan",
);
// El unico origen inequivocamente de error usa la semantica de error.
assert.match(
  avatarEditorStaticSource,
  /\{error && <StatusMessage tone="error" className="profile-avatar-status">\{error\}<\/StatusMessage>\}/,
);
// Los mensajes ambiguos NO se clasifican como error.
assert.doesNotMatch(profileScreenStaticSource, /tone="error"/, "sin clasificacion insegura de mensajes ambiguos");
// `profile-inline-notice` queda fuera de alcance: no es un mensaje simple sino un aviso con accion.
assert.match(profileScreenStaticSource, /<div className="profile-inline-notice">/);

// La logica de negocio y los payloads no cambian con esta migracion.
assert.match(profileScreenStaticSource, /buildProfilePersonalDataPayload\(/);
assert.match(profileScreenStaticSource, /validateAvatarSourceFile\(file\)/);

// CONTRATO ESTATICO 3C (P3-47B — comprobaciones SOURCE-BASED, no cobertura de render): Profile
// consume la primitive compartida TextInput solo en los cuatro controles autorizados, conservando
// intactos value, onChange, maxLength, placeholder, inputMode, autoComplete, readOnly y
// aria-readonly.
const textInputStaticSource = readFileSync("src/ui/forms/text-input.tsx", "utf8");
assert.equal(
  (textInputStaticSource.match(/^export function TextInput\b/gm) ?? []).length,
  1,
  "existe una sola definicion productiva de TextInput",
);
assert.match(textInputStaticSource, /InputHTMLAttributes<HTMLInputElement>/);
assert.match(textInputStaticSource, /type = "text"/, "default explicito y seguro para texto");
// La primitive no aporta label, error, validacion ni estado: eso lo compone FormField/el consumidor.
const textInputStaticCode = textInputStaticSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const forbidden of [/<label/, /\buseState\b|\buseEffect\b/, /\berror\b/, /dangerouslySetInnerHTML/]) {
  assert.doesNotMatch(textInputStaticCode, forbidden, `TextInput no debe incorporar ${forbidden}`);
}

assert.match(profileScreenStaticSource, /import \{ TextInput \} from "@\/ui\/forms\/text-input";/);
assert.equal(
  (profileScreenStaticSource.match(/<TextInput\b/g) ?? []).length,
  4,
  "solo los cuatro controles autorizados migran a TextInput",
);
assert.match(profileScreenStaticSource, /<TextInput\s+value=\{values\.firstName\}[\s\S]*?maxLength=\{80\}/);
assert.match(profileScreenStaticSource, /<TextInput\s+value=\{values\.lastName\}[\s\S]*?maxLength=\{120\}/);
assert.match(
  profileScreenStaticSource,
  /<TextInput\s+value=\{values\.phoneNumber\}[\s\S]*?maxLength=\{30\}[\s\S]*?placeholder="\+56 9 1234 5678"[\s\S]*?inputMode="tel"[\s\S]*?autoComplete="tel"/,
);
assert.match(
  profileScreenStaticSource,
  /<TextInput value=\{profile\.email \?\? "No disponible"\} readOnly aria-readonly="true" id="profile-email" \/>/,
);
// Fecha y genero permanecen NATIVOS en P3-47B.
assert.match(profileScreenStaticSource, /<input\s+type="date"\s+value=\{values\.birthDate\}/, "el input de fecha sigue nativo");
assert.doesNotMatch(profileScreenStaticSource, /<TextInput[^>]*type="date"/, "la fecha no debe migrar en P3-47B");
assert.match(profileScreenStaticSource, /<select\s+value=\{values\.gender\}/, "el select de genero sigue nativo");
// El input de archivo del avatar tampoco entra en alcance.
assert.match(profileScreenStaticSource, /<input\s+ref=\{fileInputRef\}[\s\S]*?type="file"/);

// CONTRATO ESTATICO 4: el source conserva el wiring de validacion, transformacion y fallback.
assert.match(profileScreenStaticSource, /validateAvatarSourceFile\(file\)/);
assert.match(avatarEditorStaticSource, /exportAvatarImage\(\{/);
assert.match(userAvatarStaticSource, /const \[imgFailed, setImgFailed\] = useState\(false\)/);
assert.match(userAvatarStaticSource, /profile\.avatarUrl && !imgFailed/);
assert.match(userAvatarStaticSource, /setImgFailed\(true\)/);
assert.match(appStaticSource, /createEmptyProfileAvatarState\(\)/);
assert.match(appStaticSource, /selectProfileAvatarPath\(/);
assert.match(appStaticSource, /mergeProfileAvatarMetadata\(current, avatar\)/);

// CONTRATO ESTATICO 5: el handler declara la secuencia de restauracion al cancelar.
const cancelSection = extractStaticSourceSection(profileScreenStaticSource, "  function cancelEdition", "  return (");
assertStaticMarkersInOrder(cancelSection, [
  "setValues(initialValues)",
  "setFieldErrors({})",
  'setStatusMessage("")',
  "setIsEditing(false)",
]);

// CONTRATO ESTATICO 6: los handlers declaran limpieza antes de exponer otra identidad.
const applySessionSection = extractStaticSourceSection(appStaticSource, "  function applySessionState", "  function clearUserSessionState");
assertStaticMarkersInOrder(applySessionSection, [
  "advanceSessionDataIdentity",
  "setSupabaseUser(authState.user)",
  "setProfilePersonalData(null)",
  "setProfileAvatar(createEmptyProfileAvatarState())",
]);
const clearSessionSection = extractStaticSourceSection(appStaticSource, "  function clearUserSessionState", "  function clearBrowserStorageScope");
assertStaticMarkersInOrder(clearSessionSection, [
  "advanceSessionDataIdentity",
  "setSupabaseUser(null)",
  "setProfilePersonalData(null)",
  "setProfileAvatar(createEmptyProfileAvatarState())",
]);

// CONTRATO ESTATICO 7: browser APIs, repositories y side effects permanecen en adaptadores React.
assert.match(appStaticSource, /getProfilePersonalData\(\)/);
assert.match(appStaticSource, /updateProfilePersonalData\(input\)/);
assert.match(appStaticSource, /uploadProfileAvatar\(file\)/);
assert.match(appStaticSource, /document\.addEventListener\("visibilitychange"/);
assert.match(appStaticSource, /window\.addEventListener\("focus"/);
assert.match(profileScreenStaticSource, /useRef<HTMLInputElement \| null>/);
assert.match(profileScreenStaticSource, /type="file"/);
assert.doesNotMatch(profileAvatarStaticSource, /useState|useEffect|getSupabaseBrowserClient|document\.|window\./);
assert.doesNotMatch(profileViewModelStaticSource, /useState|useEffect|getSupabaseBrowserClient|document\.|window\./);

// CONTRATO ESTATICO 8: no quedan implementaciones locales de reglas puras extraidas.
assert.doesNotMatch(appStaticSource, /avatarPath:\s*null,\s*avatarUrl:\s*null,\s*avatarUpdatedAt:\s*null/);
for (const helperName of [
  "buildProfileViewModelFromSources",
  "createEmptyProfileAvatarState",
  "selectProfileAvatarPath",
  "mergeProfileAvatarMetadata",
]) {
  assert.doesNotMatch(appStaticSource, new RegExp(`(?:function|const)\\s+${helperName}\\b`));
}

assert.match(packageStaticSource, /tsx src\/lib\/profile\/profile-integration-contract\.test\.ts/);

console.log("profile static integration source contract tests passed");
