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
const personalDataSection = extractStaticSourceSection(profileScreenStaticSource, "function PersonalDataSection", "function ProfileField");
assert.doesNotMatch(personalDataSection, /\bisDirty\b|\bcanSave\b/);
assert.match(personalDataSection, /<button className="button" type="submit" disabled=\{isSaving\}>/);

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
