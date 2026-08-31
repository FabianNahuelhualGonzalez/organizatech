import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import ts from "typescript";
import { legacyAppShellLayoutAst } from "@/features/app-shell/test-support/legacy-app-shell-layout-ast";

const TRAIN_UI_02_LAYOUT_ALLOWANCE = {
  ignoredDirectConditionalElements: [
    "CalendarRemindersProductiveBoundary",
    "TrainingCycleBuilderProductiveBoundary",
  ],
  ignoredConjunctiveGuardIdentifiers: ["isTrainingCycleProductVisible"],
  ignoredAttributesByElement: {
    GuidedTrainingScreen: [
      "latestExercisePerformanceLoading",
      "latestExercisePerformanceStatus",
      "retryExerciseHistory",
      "saveCompletedTrainingStatus",
      "retrySaveCompletedTraining",
      "advancedExecution",
    ],
    TrainingCompletionSummaryScreen: ["advancedExecutionSync"],
  },
} as const;

const BASE_SHA = "920ab40bb3cdf887e6bc57643b0f160d6a9e9195";
const files = {
  root: "src/components/organizatech-app.tsx",
  profileController: "src/features/profile/model/profile-controller.ts",
  profileHook: "src/features/profile/hooks/useProfileController.ts",
  profileRepository: "src/lib/profile/profile-repository.ts",
  avatarRepository: "src/lib/profile/profile-avatar-repository.ts",
  notificationsController: "src/features/notifications/model/notifications-controller.ts",
  notificationsHook: "src/features/notifications/hooks/useNotificationsController.ts",
  legacyController: "src/features/cycle-history/model/legacy-cycle-history-controller.ts",
  legacyHook: "src/features/cycle-history/hooks/useLegacyCycleHistoryController.ts",
  appFlowStorage: "src/lib/storage/app-flow-storage.ts",
  cycleAppController: "src/lib/training/cycle-history/cycle-history-app-controller.ts",
} as const;

type Sources = Record<keyof typeof files, string>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceExactlyOnce(source: string, find: string, replacement: string, label: string) {
  assert.equal(
    source.split(find).length - 1,
    1,
    `${label}: el patrón de mutación debe existir exactamente una vez`,
  );
  return source.replace(find, replacement);
}

const NOTIFICATIONS_REF_SYNC = "  onOpenIntentRef.current = input.onOpenIntent;";
const NOTIFICATIONS_HOOK_END = "  };\n}\n\nexport type NotificationsBoundary";

function insertAfterExactlyOnce(source: string, anchor: string, insertion: string, label: string) {
  const mutated = replaceExactlyOnce(source, anchor, `${anchor}\n${insertion}`, label);
  assert.equal(
    mutated.split(insertion).length - 1,
    1,
    `${label}: la inserción adversarial debe aparecer exactamente una vez`,
  );
  return mutated;
}

function readSources(base = "."): Sources {
  return Object.fromEntries(
    Object.entries(files).map(([key, path]) => [key, readFileSync(join(base, path), "utf8")]),
  ) as Sources;
}

function parseSource(path: string, source: string) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function assertNoParseDiagnostics(path: string, source: string, label: string) {
  const sourceFile = parseSource(path, source) as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  };
  assert.equal(
    sourceFile.parseDiagnostics.length,
    0,
    `${label}: la mutación debe conservar sintaxis TypeScript válida`,
  );
}

function moduleSpecifiers(path: string, source: string) {
  const sourceFile = parseSource(path, source);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) specifiers.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveLocalModule(fromPath: string, specifier: string) {
  const base = specifier.startsWith("@/")
    ? join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? normalize(join(dirname(fromPath), specifier))
      : null;
  if (!base) return null;
  const candidates = extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];
  return candidates.find((candidate) => {
    try {
      readFileSync(candidate, "utf8");
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

function assertWorkoutShareUnreachable(overrides: Map<string, string>) {
  const pending: string[] = [files.root];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    assert.doesNotMatch(path, /share-workout|workout-share/i, `Workout Share alcanzable desde ${path}`);
    const source = overrides.get(path) ?? readFileSync(path, "utf8");
    for (const specifier of moduleSpecifiers(path, source)) {
      assert.doesNotMatch(specifier, /share-workout|workout-share/i, `Workout Share importado por ${path}`);
      const resolved = resolveLocalModule(path, specifier);
      if (resolved) pending.push(resolved);
    }
  }
}

function namedFunctionAst(path: string, source: string, functionName: string) {
  const sourceFile = parseSource(path, source);
  const declaration = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === functionName
  ));
  assert.ok(declaration, `se encontró ${functionName} en ${path}`);
  const serialize = (node: ts.Node): unknown => {
    const children = node.getChildren(sourceFile);
    return children.length === 0
      ? [node.kind, node.getText(sourceFile)]
      : [node.kind, children.map(serialize)];
  };
  return JSON.stringify(serialize(declaration));
}

function assertTrainingDataPreparedProfileWiringAst(source: string) {
  const sourceFile = parseSource(files.root, source);
  const declarations: ts.VariableDeclaration[] = [];
  const profileCalls: ts.CallExpression[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === "trainingDataPrepared") declarations.push(node);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useProfileController"
    ) profileCalls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.equal(
    declarations.length,
    1,
    "trainingDataPrepared debe tener exactamente una declaración ejecutable",
  );
  const declaration = declarations[0];
  const declarationList = declaration.parent;
  assert.ok(ts.isVariableDeclarationList(declarationList));
  assert.ok(
    (declarationList.flags & ts.NodeFlags.Const) !== 0,
    "trainingDataPrepared debe declararse como const",
  );
  const initializer = declaration.initializer;
  assert.ok(
    initializer &&
      ts.isCallExpression(initializer) &&
      ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === "isTrainingDataProfilePrepared" &&
      initializer.arguments.length === 1 &&
      ts.isIdentifier(initializer.arguments[0]) &&
      initializer.arguments[0].text === "trainingDataState",
    "trainingDataPrepared debe usar exactamente isTrainingDataProfilePrepared(trainingDataState)",
  );

  assert.equal(profileCalls.length, 1, "useProfileController debe tener una única conexión productiva");
  const profileInput = profileCalls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(profileInput), "Profile debe recibir un objeto de entrada explícito");
  const consumers = profileInput.properties.filter((property) => (
    (ts.isShorthandPropertyAssignment(property) && property.name.text === "trainingDataPrepared") ||
    (ts.isPropertyAssignment(property) &&
      property.name.getText(sourceFile) === "trainingDataPrepared" &&
      ts.isIdentifier(property.initializer) &&
      property.initializer.text === "trainingDataPrepared")
  ));
  assert.equal(
    consumers.length,
    1,
    "Profile debe consumir directamente el trainingDataPrepared canónico",
  );
}

function validate(sources: Sources) {
  const overrides = new Map<string, string>(
    Object.entries(files).map(([key, path]) => [path, sources[key as keyof Sources]]),
  );
  const rootImports = moduleSpecifiers(files.root, sources.root);
  assert.ok(rootImports.includes("@/features/profile/hooks/useProfileController"));
  assert.ok(rootImports.includes("@/features/notifications/hooks/useNotificationsController"));
  assert.ok(rootImports.includes("@/features/cycle-history/hooks/useLegacyCycleHistoryController"));
  for (const forbidden of [
    "@/lib/profile/profile-repository",
    "@/lib/profile/profile-avatar-repository",
    "@/lib/notifications/notification-model",
    "@/lib/notifications/notification-state",
  ]) assert.equal(rootImports.includes(forbidden), false, `root no importa ${forbidden}`);
  assert.doesNotMatch(sources.root, /loadSeenNotificationRecords|saveSeenNotificationRecords|loadCycleHistory|saveCycleHistory/);
  assert.doesNotMatch(sources.root, /profileSaveInFlightRef|profileAvatarUploadInFlightRef|setSeenNotificationRecords|setCycleHistory/);
  assert.doesNotMatch(sources.root, /createTrainingCycleSnapshot/);
  assert.doesNotMatch(sources.root, /interface (?:TrainingCycleSnapshot|LegacyCycleHistorySnapshot) \{/);
  assert.doesNotMatch(sources.root, /ShareWorkoutCard|workout-share/);
  assertTrainingDataPreparedProfileWiringAst(sources.root);

  assert.match(sources.profileController, /readRequestIds\[lane\] === owner\.requestId/);
  assert.match(sources.profileController, /const requestId = readRequestIds\[lane\] \+ 1/);
  const refreshProfileStart = sources.profileController.indexOf("    async refreshProfile() {");
  const refreshAvatarStart = sources.profileController.indexOf("    async refreshAvatar", refreshProfileStart);
  assert.ok(refreshProfileStart >= 0 && refreshAvatarStart > refreshProfileStart);
  const refreshProfileSection = sources.profileController.slice(refreshProfileStart, refreshAvatarStart);
  const combinedLoadingIndex = refreshProfileSection.indexOf("profilePersonalDataLoading: true,");
  const combinedAvatarLoadingIndex = refreshProfileSection.indexOf("profileAvatarLoading: true,");
  const firstProfileAwaitIndex = refreshProfileSection.indexOf("await input.source.readProfile(profileOwner.userId)");
  assert.ok(combinedLoadingIndex >= 0 && combinedAvatarLoadingIndex > combinedLoadingIndex);
  assert.ok(firstProfileAwaitIndex > combinedAvatarLoadingIndex, "ambos loading se publican antes del primer await");
  assert.match(refreshProfileSection, /const profileOwner = beginRead\("profile"\);/);
  assert.match(refreshProfileSection, /const avatarOwner = beginRead\("avatar"\);/);
  assert.match(refreshProfileSection, /const ownsProfileLoading = isReadCurrent\("profile", profileOwner\);/);
  assert.match(refreshProfileSection, /const ownsAvatarLoading = isReadCurrent\("avatar", avatarOwner\);/);
  assert.match(sources.profileController, /input\.source\.saveProfile\(allowlistedInput, owner\.userId\)/);
  assert.doesNotMatch(sources.profileController, /\{ \.\.\.profileInput \}/);
  const profileUploadSection = sources.profileController.slice(
    sources.profileController.indexOf("async uploadAvatar(file)"),
    sources.profileController.indexOf("invalidateIdentity()", sources.profileController.indexOf("async uploadAvatar(file)")),
  );
  assert.match(profileUploadSection, /readRequestIds\.avatar \+= 1;/);
  assert.match(profileUploadSection, /profileAvatarLoading: false/);
  assert.doesNotMatch(profileUploadSection, /profilePersonalData:[^\n]*avatarUrl/);
  assert.doesNotMatch(sources.profileController, /sessionName|access_token|refresh_token|getSupabaseBrowserClient/);
  assert.match(sources.profileRepository, /getProfilePersonalData\([\s\S]*expectedUserId/);
  assert.equal(
    (sources.profileRepository.match(/getAuthenticatedProfileClient\(expectedUserId\)/g) ?? []).length,
    2,
  );
  assert.match(sources.profileRepository, /assertExpectedProfileUser\(supabase, expectedUserId \?\? userId\)/);
  assert.match(sources.avatarRepository, /getCurrentProfileAvatar\([\s\S]*expectedUserId/);
  assert.match(sources.avatarRepository, /getAuthenticatedProfileAvatarClient\(expectedUserId\)/);
  assert.match(sources.profileHook, /trainingDataPrepared/);
  assert.doesNotMatch(sources.root, /setSessionName\(profile|setSessionName\(result\.value/);

  assert.match(sources.notificationsController, /activeScope === owner\.scope/);
  assert.match(sources.notificationsController, /identityVersion === owner\.identityVersion/);
  assert.match(sources.notificationsController, /owner\.token\.scope === owner\.scope/);
  assert.ok((sources.notificationsController.match(/isCapturedOwnerCurrent\(owner\)/g) ?? []).length >= 5);
  assert.match(sources.notificationsController, /const openReplayGuards = new Map<string, symbol>\(\)/);
  assert.match(sources.notificationsController, /const replayGuard = acquireOpenReplayGuard\(owner, intent\);/);
  assert.match(sources.notificationsController, /if \(!replayGuard\) return false;/);
  assert.match(sources.notificationsController, /queueMicrotask\(\(\) => \{/);
  assert.ok((sources.notificationsController.match(/openReplayGuards\.clear\(\)/g) ?? []).length >= 2);
  const transitionIndex = sources.notificationsController.indexOf("markNotificationsSeen(seenRecords, ids)");
  const storageIndex = sources.notificationsController.indexOf("input.storage.save(persistable, owner.scope)");
  const ownerValidationIndex = sources.notificationsController.indexOf(
    "if (!isCapturedOwnerCurrent(owner)) return false;",
    transitionIndex,
  );
  assert.ok(transitionIndex >= 0 && ownerValidationIndex > transitionIndex && storageIndex > ownerValidationIndex);
  assert.doesNotMatch(sources.notificationsHook, /setSeenNotificationRecords|set[A-Za-z]+\(\(current\)/);
  assert.doesNotMatch(sources.root, /function markNotificationsSeen/);
  assert.doesNotMatch(sources.root, /function openNotificationTarget\s*\(/);

  assert.doesNotMatch(sources.appFlowStorage, /as TCycleSnapshot|as LegacyCycleHistorySnapshot/);
  assert.match(sources.legacyController, /projectLegacyCycleHistorySnapshot\(value: unknown\)/);
  assert.doesNotMatch(sources.legacyController, /\{\s*\.\.\.(?:record|snapshot)\b/);
  assert.match(sources.legacyController, /normalizeTrainingPlanInput\(rawPlan\)\.plan/);
  assert.match(sources.legacyController, /input\.storage\.save\(nextHistory\.map\(serializeLegacyCycleHistorySnapshot\), scope\)/);
  assert.doesNotMatch(sources.legacyController, /sharedLegacyController|globalLegacyController|createContext\(|zustand/);
  assert.match(sources.cycleAppController, /lifecycleVersion \+= 1;[\s\S]*listRequestId \+= 1;[\s\S]*detailRequestId \+= 1;[\s\S]*coordinator\.invalidateAll\(\)/);

  for (const uiPath of [
    "src/components/profile/ProfileScreen.tsx",
    "src/components/profile/ProfileAvatarEditor.tsx",
    "src/features/notifications/components/NotificationPanel.tsx",
    "src/features/notifications/components/NotificationGroup.tsx",
  ]) {
    const imports = moduleSpecifiers(uiPath, readFileSync(uiPath, "utf8"));
    assert.equal(imports.some((specifier) => /supabase|repository|storage|data-source/.test(specifier)), false);
  }

  assertWorkoutShareUnreachable(overrides);
}

const sources = readSources();
validate(sources);

const baselineRoot = execFileSync("git", ["show", `${BASE_SHA}:${files.root}`], { encoding: "utf8" });
const baselineLayout = legacyAppShellLayoutAst(files.root, baselineRoot, TRAIN_UI_02_LAYOUT_ALLOWANCE);
// TRAIN-UI-02 sólo sustituye el loading booleano por estados y retries tipados en Guided.
// El resto del fallback legacy conserva props, callbacks, pantallas y orden del baseline P3-45.
assert.equal(
  legacyAppShellLayoutAst(files.root, sources.root, TRAIN_UI_02_LAYOUT_ALLOWANCE),
  baselineLayout,
);
const unexpectedGuidedProp = sources.root.replace(
  "<GuidedTrainingScreen",
  "<GuidedTrainingScreen trainUi02UnexpectedProp",
);
assert.notEqual(
  legacyAppShellLayoutAst(files.root, unexpectedGuidedProp, TRAIN_UI_02_LAYOUT_ALLOWANCE),
  baselineLayout,
  "cualquier prop adicional de GuidedTrainingScreen sigue bloqueada",
);
const profileScreenPath = "src/components/profile/ProfileScreen.tsx";
assert.equal(
  namedFunctionAst(profileScreenPath, readFileSync(profileScreenPath, "utf8"), "ProfileScreen"),
  namedFunctionAst(
    profileScreenPath,
    execFileSync("git", ["show", `${BASE_SHA}:${profileScreenPath}`], { encoding: "utf8" }),
    "ProfileScreen",
  ),
);
for (const visualPath of [
  "src/components/profile/ProfileAvatarEditor.tsx",
  "src/features/notifications/components/NotificationPanel.tsx",
  "src/features/notifications/components/NotificationGroup.tsx",
  "src/components/training/cycle-history/CycleHistoryProductiveContainer.tsx",
]) {
  assert.equal(
    readFileSync(visualPath, "utf8"),
    execFileSync("git", ["show", `${BASE_SHA}:${visualPath}`], { encoding: "utf8" }),
    `${visualPath} conserva paridad byte a byte con el baseline`,
  );
}
const completionSummaryPath = "src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx";
const completionSummary = readFileSync(completionSummaryPath, "utf8");
assert.match(completionSummary, /advancedExecutionSync\?: ReactNode/);
assert.match(
  completionSummary,
  /\{advancedExecutionSync \?\? null\}/,
);
assert.doesNotMatch(completionSummary, /ShareWorkoutCard|workout-share|navigator/);

const sourceProbes: Array<{
  name: string;
  target: keyof Sources;
  mutate(source: string): string;
}> = [
  {
    name: "volver a acoplar Profile al snapshot legacy crítico",
    target: "root",
    mutate: (source) => source.replace(
      'const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);',
      'const trainingDataPrepared = trainingDataState.appData.status === "ready";',
    ),
  },
  {
    name: "engañar el contrato con comentario canónico y booleano constante",
    target: "root",
    mutate: (source) => source.replace(
      "  const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);",
      "  // const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);\n  const trainingDataPrepared = true;",
    ),
  },
  {
    name: "engañar el contrato con string canónico y booleano constante",
    target: "root",
    mutate: (source) => source.replace(
      "  const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);",
      '  const trainingDataPreparedMarker = "const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);";\n  const trainingDataPrepared = true;',
    ),
  },
  {
    name: "consumir un alias desconectado en Profile",
    target: "root",
    mutate: (source) => source
      .replace(
        "  const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);",
        "  const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);\n  const disconnectedTrainingDataPrepared = true;",
      )
      .replace(
        "    trainingDataPrepared,",
        "    trainingDataPrepared: disconnectedTrainingDataPrepared,",
      ),
  },
  {
    name: "desconectar Profile y dejar el símbolo sólo en comentario",
    target: "root",
    mutate: (source) => source.replace(
      "    trainingDataPrepared,",
      "    // trainingDataPrepared,\n    trainingDataPrepared: true,",
    ),
  },
  {
    name: "omitir expectedUserId",
    target: "profileRepository",
    mutate: (source) => source.replace("getAuthenticatedProfileClient(expectedUserId)", "getAuthenticatedProfileClient()"),
  },
  {
    name: "leer scope dentro de updater",
    target: "notificationsHook",
    mutate: (source) => `${source}\nsetSeenNotificationRecords((current) => current);\n`,
  },
  {
    name: "reintroducir I/O dentro de updater",
    target: "notificationsHook",
    mutate: (source) => `${source}\nsetRecords((current) => { localStorage.setItem("x", "y"); return current; });\n`,
  },
  {
    name: "usar scope global actual",
    target: "notificationsController",
    mutate: (source) => source.replace("activeScope === owner.scope", "activeScope !== null"),
  },
  {
    name: "cargar history mediante cast directo",
    target: "appFlowStorage",
    mutate: (source) => source.replace(") ?? [];", ") as LegacyCycleHistorySnapshot[] ?? [];"),
  },
  {
    name: "propagar spread de JSON crudo",
    target: "legacyController",
    mutate: (source) => source.replace("    id: snapshot.id,", "    ...snapshot,\n    id: snapshot.id,"),
  },
  {
    name: "compartir controller global",
    target: "legacyController",
    mutate: (source) => `${source}\nconst sharedLegacyController = createLegacyCycleHistoryController;\n`,
  },
  {
    name: "conectar ShareWorkoutCard",
    target: "root",
    mutate: (source) => `import { ShareWorkoutCard } from "@/features/progress/components/share-workout-card";\n${source}`,
  },
];

for (const probe of sourceProbes) {
  const mutated = probe.mutate(sources[probe.target]);
  assert.notEqual(mutated, sources[probe.target], `probe efectivo: ${probe.name}`);
  assert.throws(
    () => validate({ ...sources, [probe.target]: mutated }),
    `la suite registrada falla: ${probe.name}`,
  );
}

const runtimeProbes: Array<{
  name: string;
  path: keyof typeof files;
  testPath: string;
  find: string;
  replacement: string;
}> = [
  {
    name: "quitar stale guard Profile",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: "readRequestIds[lane] === owner.requestId &&",
    replacement: "true &&",
  },
  {
    name: "reutilizar requestId anterior",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: "const requestId = readRequestIds[lane] + 1;",
    replacement: "const requestId = readRequestIds[lane];",
  },
  {
    name: "setLoading false sin owner",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: 'const ownsProfileLoading = isReadCurrent("profile", profileOwner);\n        const ownsAvatarLoading = isReadCurrent("avatar", avatarOwner);',
    replacement: "const ownsProfileLoading = true;\n        const ownsAvatarLoading = true;",
  },
  {
    name: "mover avatar loading después del primer await",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '        profileAvatarLoading: true,\n        profileAvatarError: "",\n      });\n      try {\n        const profile = await input.source.readProfile(profileOwner.userId);',
    replacement: '        profileAvatarError: "",\n      });\n      try {\n        const profile = await input.source.readProfile(profileOwner.userId);\n        publish({ profileAvatarLoading: true });',
  },
  {
    name: "payload Profile con spread",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: "const allowlistedInput: ProfilePersonalDataInput = {\n        firstName: profileInput.firstName,\n        lastName: profileInput.lastName,\n        birthDate: profileInput.birthDate,\n        gender: profileInput.gender,\n        phoneNumber: profileInput.phoneNumber,\n      };",
    replacement: "const allowlistedInput: ProfilePersonalDataInput = { ...profileInput };",
  },
  {
    name: "persistir avatarUrl",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: "profilePersonalData: mergeProfileAvatarMetadata(snapshot.profilePersonalData, result.value),",
    replacement: "profilePersonalData: { ...mergeProfileAvatarMetadata(snapshot.profilePersonalData, result.value)!, avatarUrl: result.value.avatarUrl } as ProfilePersonalData,",
  },
  {
    name: "omitir read de avatar_path",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '  const { data, error } = await supabase\n    .from("profiles")\n    .select("avatar_path,avatar_updated_at")\n    .eq("id", userId)\n    .maybeSingle();',
    replacement: '  const { data, error } = await supabase\n    .from("profiles")\n    .select("avatar_updated_at")\n    .eq("id", userId)\n    .maybeSingle();',
  },
  {
    name: "omitir expectedUserId en read de avatar",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '  async function getCurrentProfileAvatar(\n    expectedUserId: string | undefined = undefined,\n    metadata: ProfileAvatarMetadata | undefined = undefined,\n  ): Promise<ProfileAvatarState> {\n    const { supabase, userId } = await getAuthenticatedProfileAvatarClient(expectedUserId);',
    replacement: '  async function getCurrentProfileAvatar(\n    expectedUserId: string | undefined = undefined,\n    metadata: ProfileAvatarMetadata | undefined = undefined,\n  ): Promise<ProfileAvatarState> {\n    const { supabase, userId } = await getAuthenticatedProfileAvatarClient();',
  },
  {
    name: "eliminar revalidación post-read de avatar",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '    await assertExpectedProfileAvatarUser(supabase, expectedUserId ?? userId);\n    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);',
    replacement: '    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);',
  },
  {
    name: "eliminar revalidación post-signed URL",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);\n    await assertExpectedProfileAvatarUser(supabase, expectedUserId ?? userId);\n    return mapProfileAvatarState(row, avatarUrl);',
    replacement: '    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);\n    return mapProfileAvatarState(row, avatarUrl);',
  },
  {
    name: "omitir expectedUserId en upload de avatar",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '  async function uploadProfileAvatar(\n    file: File,\n    expectedUserId: string | undefined = undefined,\n  ): Promise<ProfileAvatarState> {\n    const validation = validateProfileAvatarFile(file as ProfileAvatarFileLike);\n    if (!validation.ok) {\n      throw new ProfileAvatarRepositoryError(validation.error);\n    }\n\n    const { supabase, userId } = await getAuthenticatedProfileAvatarClient(expectedUserId);',
    replacement: '  async function uploadProfileAvatar(\n    file: File,\n    expectedUserId: string | undefined = undefined,\n  ): Promise<ProfileAvatarState> {\n    const validation = validateProfileAvatarFile(file as ProfileAvatarFileLike);\n    if (!validation.ok) {\n      throw new ProfileAvatarRepositoryError(validation.error);\n    }\n\n    const { supabase, userId } = await getAuthenticatedProfileAvatarClient();',
  },
  {
    name: "eliminar revalidación post-Storage del upload",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '    await assertExpectedProfileAvatarUser(supabase, userId);\n    const avatarUpdatedAt = new Date().toISOString();',
    replacement: '    const avatarUpdatedAt = new Date().toISOString();',
  },
  {
    name: "eliminar revalidación post-Postgres del upload",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '    if (updateError) throw new ProfileAvatarRepositoryError("No se pudo subir la foto de perfil.", updateError);\n    await assertExpectedProfileAvatarUser(supabase, userId);\n\n    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);',
    replacement: '    if (updateError) throw new ProfileAvatarRepositoryError("No se pudo subir la foto de perfil.", updateError);\n\n    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);',
  },
  {
    name: "eliminar revalidación post-signed URL del upload",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);\n    await assertExpectedProfileAvatarUser(supabase, userId);\n    return mapProfileAvatarState(data as ProfileAvatarRow, avatarUrl);',
    replacement: '    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);\n    return mapProfileAvatarState(data as ProfileAvatarRow, avatarUrl);',
  },
  {
    name: "publicar null después de URL válida",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '      publish({\n        profileAvatar: avatar,\n        profileAvatarError: "",\n        profileAvatarResetKey: avatar.avatarUrl\n          ? snapshot.profileAvatarResetKey + 1\n          : snapshot.profileAvatarResetKey,\n      });\n      return avatar;',
    replacement: '      publish({\n        profileAvatar: avatar,\n        profileAvatarError: "",\n        profileAvatarResetKey: avatar.avatarUrl\n          ? snapshot.profileAvatarResetKey + 1\n          : snapshot.profileAvatarResetKey,\n      });\n      publish({ profileAvatar: createEmptyProfileAvatarState() });\n      return avatar;',
  },
  {
    name: "tratar nueva generación del mismo usuario como continuidad",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '    return token.userId && token.scope ? `${token.generation}:${token.userId}:${token.scope}` : null;',
    replacement: '    return token.userId && token.scope ? `${token.userId}:${token.scope}` : null;',
  },
  {
    name: "omitir refresh de avatar en bootstrap",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '        await runAvatarRead(\n          avatarOwner,\n          { force: true, avatarPath: profile.avatarPath },\n          false,\n          authorizedMetadata,\n        );',
    replacement: '        await Promise.resolve(null);',
  },
  {
    name: "cachear bootstrap aunque falle el avatar",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '        if (\n          profile &&\n          configuredIdentityKey === identityKey &&\n          !snapshot.profileAvatarLoading &&\n          !snapshot.profileAvatarError\n        ) bootstrapIdentityKey = identityKey;',
    replacement: '        if (profile && configuredIdentityKey === identityKey) bootstrapIdentityKey = identityKey;',
  },
  {
    name: "devolver path sin generar signed URL",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '    const avatarUrl = await createCanonicalSignedUrl(supabase, avatarPath);\n    await assertExpectedProfileAvatarUser(supabase, expectedUserId ?? userId);\n    return mapProfileAvatarState(row, avatarUrl);',
    replacement: '    const avatarUrl = avatarPath;\n    await assertExpectedProfileAvatarUser(supabase, expectedUserId ?? userId);\n    return mapProfileAvatarState(row, avatarUrl);',
  },
  {
    name: "aceptar signed URL vacía como éxito",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '  const signedUrl = data.signedUrl?.trim();\n  if (!signedUrl) throw new ProfileAvatarRepositoryError("No se pudo obtener la foto de perfil.");\n  return signedUrl;',
    replacement: '  return data.signedUrl || null;',
  },
  {
    name: "guardar signed URL como path canónico",
    path: "avatarRepository",
    testPath: "src/lib/profile/profile-avatar.test.ts",
    find: '    const updatePayload = buildProfileAvatarUpdatePayload(userId, avatarUpdatedAt);',
    replacement: '    const updatePayload = { ...buildProfileAvatarUpdatePayload(userId, avatarUpdatedAt), avatar_path: "https://signed.invalid/avatar" };',
  },
  {
    name: "eliminar publicación del resultado de upload",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '          profileAvatar: result.value,',
    replacement: '          profileAvatar: snapshot.profileAvatar,',
  },
  {
    name: "permitir que finally stale apague loading actual de avatar",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '      if (isReadCurrent("avatar", owner)) publish({ profileAvatarLoading: false });',
    replacement: '      publish({ profileAvatarLoading: false });',
  },
  {
    name: "no invalidar read anterior al publicar upload",
    path: "profileController",
    testPath: "src/features/profile/model/profile-controller.test.ts",
    find: '        if (!isWriteCurrent(uploadOwner, owner)) return false;\n        readRequestIds.avatar += 1;\n        lastAvatarRefreshAt = now();',
    replacement: '        if (!isWriteCurrent(uploadOwner, owner)) return false;\n        lastAvatarRefreshAt = now();',
  },
  {
    name: "eliminar replay guard de Notifications",
    path: "notificationsController",
    testPath: "src/features/notifications/model/notifications-controller.test.ts",
    find: "          const replayGuard = acquireOpenReplayGuard(owner, intent);\n          if (!replayGuard) return false;",
    replacement: '          const replayGuard = { key: "guard-disabled", guard: Symbol("guard-disabled") };',
  },
  {
    name: "guardar antes de validar owner",
    path: "notificationsController",
    testPath: "src/features/notifications/model/notifications-controller.test.ts",
    find: "if (!owner || ids.length === 0 || !isCapturedOwnerCurrent(owner)) return false;\n        const nextRecords = markNotificationsSeen(seenRecords, ids);\n        if (!isCapturedOwnerCurrent(owner)) return false;",
    replacement: "if (!owner || ids.length === 0) return false;\n        const nextRecords = markNotificationsSeen(seenRecords, ids);",
  },
  {
    name: "scope global en Notifications",
    path: "notificationsController",
    testPath: "src/features/notifications/model/notifications-controller.test.ts",
    find: "owner.token.scope === owner.scope &&",
    replacement: "true &&",
  },
  {
    name: "eliminar invalidación list/detail/PDF",
    path: "cycleAppController",
    testPath: "src/lib/training/cycle-history/cycle-history-app-controller.test.ts",
    find: "      lifecycleVersion += 1;\n      listRequestId += 1;\n      detailRequestId += 1;\n      coordinator.invalidateAll();",
    replacement: "      coordinator.invalidateAll();",
  },
];

const contractProbes: Array<{
  name: string;
  path: string;
  testPath: string;
  mutate(source: string): string;
  shouldPass?: boolean;
  expectedFailureText?: string;
  verifyRestoredBaseline?: boolean;
}> = [
  {
    name: "N7 Notifications callback no-op",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "callback debe declarar exactamente un parámetro",
    verifyRestoredBaseline: true,
    mutate: (source) => {
      const mutated = replaceExactlyOnce(
        source,
        "      return commands.open(notification, (intent) => onOpenIntentRef.current(intent));",
        "      return commands.open(notification, () => undefined);",
        "N7 Notifications callback no-op",
      );
      assertNoParseDiagnostics(files.notificationsHook, mutated, "N7 Notifications callback no-op");
      return mutated;
    },
  },
  {
    name: "N8 Notifications segunda escritura condicional",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe tener exactamente una escritura total",
    verifyRestoredBaseline: true,
    mutate: (source) => {
      const mutated = insertAfterExactlyOnce(
        source,
        NOTIFICATIONS_REF_SYNC,
        "  if (input.scope) {\n    onOpenIntentRef.current = () => undefined;\n  }",
        "N8 Notifications segunda escritura condicional",
      );
      assertNoParseDiagnostics(files.notificationsHook, mutated, "N8 Notifications segunda escritura condicional");
      return mutated;
    },
  },
  {
    name: "N9 Notifications sincronización posterior al return",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe ejecutarse antes del return productivo",
    verifyRestoredBaseline: true,
    mutate: (source) => {
      const withoutCanonicalSync = replaceExactlyOnce(
        source,
        `${NOTIFICATIONS_REF_SYNC}\n`,
        "",
        "N9 remueve sincronización canónica",
      );
      const mutated = replaceExactlyOnce(
        withoutCanonicalSync,
        NOTIFICATIONS_HOOK_END,
        `  };\n${NOTIFICATIONS_REF_SYNC}\n}\n\nexport type NotificationsBoundary`,
        "N9 mueve sincronización después del return",
      );
      assert.equal(
        mutated.split(NOTIFICATIONS_REF_SYNC).length - 1,
        1,
        "N9 debe conservar una única sincronización total",
      );
      assertNoParseDiagnostics(
        files.notificationsHook,
        mutated,
        "N9 Notifications sincronización posterior al return",
      );
      return mutated;
    },
  },
  {
    name: "Notifications callback sin parámetros",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "callback debe declarar exactamente un parámetro",
    mutate: (source) => replaceExactlyOnce(
      source,
      "(intent) => onOpenIntentRef.current(intent)",
      "() => onOpenIntentRef.current(notification)",
      "Notifications callback sin parámetros",
    ),
  },
  {
    name: "Notifications callback con dos parámetros",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "callback debe declarar exactamente un parámetro",
    mutate: (source) => replaceExactlyOnce(
      source,
      "(intent) => onOpenIntentRef.current(intent)",
      "(intent, extra) => onOpenIntentRef.current(intent)",
      "Notifications callback con dos parámetros",
    ),
  },
  {
    name: "Notifications callback reenvía otra variable",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe reenviar exactamente el Identifier recibido",
    mutate: (source) => replaceExactlyOnce(
      source,
      "(intent) => onOpenIntentRef.current(intent)",
      "(intent) => onOpenIntentRef.current(notification)",
      "Notifications callback reenvía otra variable",
    ),
  },
  {
    name: "Notifications callback usa otro ref",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "receiver debe ser onOpenIntentRef.current",
    mutate: (source) => replaceExactlyOnce(
      source,
      "(intent) => onOpenIntentRef.current(intent)",
      "(intent) => otherRef.current(intent)",
      "Notifications callback usa otro ref",
    ),
  },
  {
    name: "Notifications callback llama current sin argumento",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "onOpenIntentRef.current requiere un argumento",
    mutate: (source) => replaceExactlyOnce(
      source,
      "(intent) => onOpenIntentRef.current(intent)",
      "(intent) => onOpenIntentRef.current()",
      "Notifications callback llama current sin argumento",
    ),
  },
  {
    name: "Notifications callback agrega otra operación",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "callback de bloque debe contener una única operación",
    mutate: (source) => replaceExactlyOnce(
      source,
      "(intent) => onOpenIntentRef.current(intent)",
      "(intent) => { doSomethingElse(); return onOpenIntentRef.current(intent); }",
      "Notifications callback agrega otra operación",
    ),
  },
  {
    name: "Notifications ref desconectado del port vigente",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "onOpenIntentRef debe inicializarse con useRef(input.onOpenIntent)",
    mutate: (source) => replaceExactlyOnce(
      source,
      "  const onOpenIntentRef = useRef(input.onOpenIntent);",
      "  const onOpenIntentRef = useRef(() => undefined);",
      "Notifications ref desconectado del port vigente",
    ),
  },
  {
    name: "Notifications segunda escritura dentro de else",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe tener exactamente una escritura total",
    mutate: (source) => insertAfterExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  if (input.scope) {\n    void 0;\n  } else {\n    onOpenIntentRef.current = () => undefined;\n  }",
      "Notifications segunda escritura dentro de else",
    ),
  },
  {
    name: "Notifications segunda escritura dentro de callback",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe tener exactamente una escritura total",
    mutate: (source) => insertAfterExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  queueMicrotask(() => {\n    onOpenIntentRef.current = () => undefined;\n  });",
      "Notifications segunda escritura dentro de callback",
    ),
  },
  {
    name: "Notifications segunda escritura posterior al return",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe tener exactamente una escritura total",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_HOOK_END,
      "  };\n  onOpenIntentRef.current = () => undefined;\n}\n\nexport type NotificationsBoundary",
      "Notifications segunda escritura posterior al return",
    ),
  },
  {
    name: "Notifications segunda escritura con el mismo port",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe tener exactamente una escritura total",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      `${NOTIFICATIONS_REF_SYNC}\n${NOTIFICATIONS_REF_SYNC}`,
      "Notifications segunda escritura con el mismo port",
    ),
  },
  {
    name: "Notifications segunda escritura mediante ternario",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe tener exactamente una escritura total",
    mutate: (source) => insertAfterExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  input.scope ? (onOpenIntentRef.current = () => undefined) : undefined;",
      "Notifications segunda escritura mediante ternario",
    ),
  },
  {
    name: "Notifications escritura computada de current",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "la única escritura debe ser onOpenIntentRef.current = input.onOpenIntent",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      '  onOpenIntentRef["current"] = input.onOpenIntent;',
      "Notifications escritura computada de current",
    ),
  },
  {
    name: "Notifications escritura computada con expresión equivalente",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "la única escritura debe ser onOpenIntentRef.current = input.onOpenIntent",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      '  onOpenIntentRef["cur" + "rent"] = input.onOpenIntent;',
      "Notifications escritura computada con expresión equivalente",
    ),
  },
  {
    name: "Notifications escritura con optional chain",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "la única escritura debe ser onOpenIntentRef.current = input.onOpenIntent",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  onOpenIntentRef?.current = input.onOpenIntent;",
      "Notifications escritura con optional chain",
    ),
  },
  {
    name: "Notifications alias del ref no oculta una segunda escritura",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "binding único y sólo sus usos canónicos",
    mutate: (source) => insertAfterExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  const hiddenIntentRef = onOpenIntentRef;\n  hiddenIntentRef.current = () => undefined;",
      "Notifications alias del ref no oculta una segunda escritura",
    ),
  },
  {
    name: "Notifications binding del ref debe permanecer const",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe ser un const directo del cuerpo principal",
    mutate: (source) => replaceExactlyOnce(
      source,
      "  const onOpenIntentRef = useRef(input.onOpenIntent);",
      "  let onOpenIntentRef = useRef(input.onOpenIntent);",
      "Notifications binding del ref debe permanecer const",
    ),
  },
  {
    name: "Notifications binding homónimo anidado no autoriza",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "binding único y sólo sus usos canónicos",
    mutate: (source) => insertAfterExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  const unusedFactory = () => {\n    const onOpenIntentRef = { current: input.onOpenIntent };\n    return onOpenIntentRef;\n  };\n  void unusedFactory;",
      "Notifications binding homónimo anidado no autoriza",
    ),
  },
  {
    name: "Notifications sincronización con otro valor",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "la única escritura debe ser onOpenIntentRef.current = input.onOpenIntent",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  onOpenIntentRef.current = () => undefined;",
      "Notifications sincronización con otro valor",
    ),
  },
  {
    name: "Notifications sincronización única anidada en if",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe ser un statement directo del cuerpo principal",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  if (input.scope) {\n    onOpenIntentRef.current = input.onOpenIntent;\n  }",
      "Notifications sincronización única anidada en if",
    ),
  },
  {
    name: "Notifications sincronización única dentro de función diferida",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    expectedFailureText: "debe ser un statement directo del cuerpo principal",
    mutate: (source) => replaceExactlyOnce(
      source,
      NOTIFICATIONS_REF_SYNC,
      "  queueMicrotask(() => {\n    onOpenIntentRef.current = input.onOpenIntent;\n  });",
      "Notifications sincronización única dentro de función diferida",
    ),
  },
  {
    name: "reinstalar TrainingCycleSnapshot en el root",
    path: files.root,
    testPath: "src/lib/training/training-plan-type-integration-contract.test.ts",
    mutate: (source) => `${source}\ninterface TrainingCycleSnapshot { plan: never; }\n`,
  },
  {
    name: "desconectar NotificationPanel del controller",
    path: files.root,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    mutate: (source) => replaceExactlyOnce(
      source,
      "onOpenNotification={openNotificationTarget}",
      "onOpenNotification={() => undefined}",
      "desconectar NotificationPanel del controller",
    ),
  },
  {
    name: "reinstalar openNotificationTarget como owner del root",
    path: files.root,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    mutate: (source) => `${source}\nfunction openNotificationTarget() {}\n`,
  },
  {
    name: "desconectar foreground Profile del App Shell",
    path: files.root,
    testPath: "src/features/app-shell/app-shell-visual-integration-contract.test.ts",
    mutate: (source) => source.replace(
      "void refreshProfileAvatar();",
      "void Promise.resolve();",
    ),
  },
  {
    name: "reinstalar refreshProfileAvatar legacy en el root",
    path: files.root,
    testPath: "src/features/app-shell/app-shell-visual-integration-contract.test.ts",
    mutate: (source) => `${source}\nfunction refreshProfileAvatar() {}\n`,
  },
  {
    name: "Profile desconectado con marcador sólo en comentario",
    path: files.profileHook,
    testPath: "src/features/app-shell/app-shell-visual-integration-contract.test.ts",
    mutate: (source) => source.replace(
      "    refreshProfileAvatar: controller.foreground,",
      "    refreshProfileAvatar: async () => null,\n    // refreshProfileAvatar: controller.foreground,",
    ),
  },
  {
    name: "Notifications desconectado con marcador sólo en comentario",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    mutate: (source) => replaceExactlyOnce(
      source,
      "    openNotificationTarget(notification: AppNotification) {\n      return commands.open(notification, (intent) => onOpenIntentRef.current(intent));\n    },",
      "    openNotificationTarget(notification: AppNotification) {\n      // return commands.open(notification, (intent) => onOpenIntentRef.current(intent));\n      return false;\n    },",
      "Notifications desconectado con marcador sólo en comentario",
    ),
  },
  {
    name: "Profile marker dentro de string no autoriza",
    path: files.profileHook,
    testPath: "src/features/app-shell/app-shell-visual-integration-contract.test.ts",
    mutate: (source) => source.replace(
      "    refreshProfileAvatar: controller.foreground,",
      '    refreshProfileAvatar: "controller.foreground" as never,',
    ),
  },
  {
    name: "Notifications marker dentro de string no autoriza",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    mutate: (source) => replaceExactlyOnce(
      source,
      "      return commands.open(notification, (intent) => onOpenIntentRef.current(intent));",
      '      return "commands.open(notification, (intent) => onOpenIntentRef.current(intent))" as never;',
      "Notifications marker dentro de string no autoriza",
    ),
  },
  {
    name: "Profile símbolo correcto en función no conectada",
    path: files.profileHook,
    testPath: "src/features/app-shell/app-shell-visual-integration-contract.test.ts",
    mutate: (source) => source.replace(
      "    refreshProfileAvatar: controller.foreground,",
      "    refreshProfileAvatar: async () => null,",
    ) + "\nfunction unusedProfileMarker(controller: ProfileController) { return controller.foreground; }\n",
  },
  {
    name: "Notifications símbolo correcto en función no conectada",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    mutate: (source) => replaceExactlyOnce(
      source,
      "      return commands.open(notification, (intent) => onOpenIntentRef.current(intent));",
      "      return false;",
      "Notifications símbolo correcto en función no conectada",
    ) + `
function unusedNotificationMarker(
  commands: { open: (notification: unknown, callback: (intent: unknown) => unknown) => unknown },
  notification: unknown,
  onOpenIntentRef: { current: (intent: unknown) => unknown },
) {
  return commands.open(notification, (intent) => onOpenIntentRef.current(intent));
}
`,
  },
  {
    name: "Profile comentario inocuo conserva wiring AST válido",
    path: files.profileHook,
    testPath: "src/features/app-shell/app-shell-visual-integration-contract.test.ts",
    shouldPass: true,
    mutate: (source) => source.replace(
      "    refreshProfileAvatar: controller.foreground,",
      "    refreshProfileAvatar: controller.foreground,\n    // comentario inocuo: refresh de avatar conectado",
    ),
  },
  {
    name: "Notifications comentario inocuo conserva wiring AST válido",
    path: files.notificationsHook,
    testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    shouldPass: true,
    mutate: (source) => replaceExactlyOnce(
      source,
      "      return commands.open(notification, (intent) => onOpenIntentRef.current(intent));",
      "      // comentario inocuo junto al wiring correcto\n      return commands.open(notification, (intent) => onOpenIntentRef.current(intent));",
      "Notifications comentario inocuo conserva wiring AST válido",
    ),
  },
];

const mutationDirectory = mkdtempSync(join(tmpdir(), "organizatech-p3-45-"));
const astContractProbeResults: Array<{ name: string; exitCode: number }> = [];
const runtimeProbeResults: string[] = [];
try {
  cpSync("src", join(mutationDirectory, "src"), { recursive: true });
  cpSync("tsconfig.json", join(mutationDirectory, "tsconfig.json"));
  cpSync("package.json", join(mutationDirectory, "package.json"));
  const avatarMigrationPath = "supabase/migrations/20260713000001_p0_h_profile_avatar_hardening.sql";
  mkdirSync(join(mutationDirectory, "supabase/migrations"), { recursive: true });
  cpSync(avatarMigrationPath, join(mutationDirectory, avatarMigrationPath));
  symlinkSync(resolve("node_modules"), join(mutationDirectory, "node_modules"), "dir");
  const tsx = resolve("node_modules/.bin/tsx");
  for (const baselineContract of [
    {
      name: "baseline Profile AST contract",
      testPath: "src/features/app-shell/app-shell-visual-integration-contract.test.ts",
    },
    {
      name: "baseline Notifications AST contract",
      testPath: "src/features/notifications/notification-panel-visual-integration-contract.test.ts",
    },
  ]) {
    execFileSync(tsx, [baselineContract.testPath], {
      cwd: mutationDirectory,
      encoding: "utf8",
      stdio: "pipe",
    });
    astContractProbeResults.push({ name: baselineContract.name, exitCode: 0 });
  }
  for (const baselineRuntimeTest of [
    "src/features/profile/model/profile-controller.test.ts",
    "src/lib/profile/profile-avatar.test.ts",
  ]) {
    execFileSync(tsx, ["--test", baselineRuntimeTest], {
      cwd: mutationDirectory,
      encoding: "utf8",
      stdio: "pipe",
    });
  }
  for (const probe of runtimeProbes) {
    const path = join(mutationDirectory, files[probe.path]);
    const original = readFileSync(path, "utf8");
    const mutated = replaceExactlyOnce(original, probe.find, probe.replacement, probe.name);
    writeFileSync(path, mutated, "utf8");
    assert.throws(
      () => execFileSync(tsx, ["--test", probe.testPath], {
        cwd: mutationDirectory,
        encoding: "utf8",
        stdio: "pipe",
      }),
      `runtime debe fallar: ${probe.name}`,
    );
    writeFileSync(path, original, "utf8");
    assert.equal(readFileSync(path, "utf8"), original, `restauración byte a byte: ${probe.name}`);
    runtimeProbeResults.push(probe.name);
  }
  for (const probe of contractProbes) {
    const path = join(mutationDirectory, probe.path);
    const original = readFileSync(path, "utf8");
    const originalHash = sha256(original);
    const mutated = probe.mutate(original);
    assert.notEqual(mutated, original, `probe efectivo: ${probe.name}`);
    writeFileSync(path, mutated, "utf8");
    let exitCode = 0;
    let failureOutput = "";
    try {
      execFileSync(tsx, [probe.testPath], {
        cwd: mutationDirectory,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      const details = error as {
        status?: unknown;
        stdout?: unknown;
        stderr?: unknown;
        message?: unknown;
      };
      const status = details.status;
      exitCode = typeof status === "number" ? status : 1;
      failureOutput = [details.stdout, details.stderr, details.message]
        .filter((value): value is string => typeof value === "string")
        .join("\n");
    } finally {
      writeFileSync(path, original, "utf8");
    }
    const restored = readFileSync(path, "utf8");
    assert.equal(restored, original, `restauración byte a byte: ${probe.name}`);
    assert.equal(sha256(restored), originalHash, `restauración SHA-256: ${probe.name}`);
    if (probe.shouldPass) {
      assert.equal(exitCode, 0, `contrato debe aceptar comentario inocuo: ${probe.name}`);
    } else {
      assert.notEqual(exitCode, 0, `contrato debe fallar: ${probe.name}`);
    }
    if (probe.expectedFailureText) {
      assert.ok(
        failureOutput.includes(probe.expectedFailureText),
        `el fallo debe provenir de la regla AST esperada: ${probe.name}`,
      );
    }
    astContractProbeResults.push({ name: probe.name, exitCode });
    if (probe.verifyRestoredBaseline) {
      execFileSync(tsx, [probe.testPath], {
        cwd: mutationDirectory,
        encoding: "utf8",
        stdio: "pipe",
      });
      astContractProbeResults.push({
        name: `${probe.name} baseline restaurado`,
        exitCode: 0,
      });
    }
  }
} finally {
  rmSync(mutationDirectory, { recursive: true, force: true });
}
assert.equal(existsSync(mutationDirectory), false, "se eliminaron los temporales de mutation probes");

console.log(
  "P3-45 runtime mutation probes killed:",
  runtimeProbeResults.join(" | "),
);
console.log(
  "P3-45 AST contract probes:",
  astContractProbeResults.map(({ name, exitCode }) => `${name}=${exitCode}`).join(" | "),
);
console.log("P3-45 boundary, visual, import/reachability and mutation contracts passed");
