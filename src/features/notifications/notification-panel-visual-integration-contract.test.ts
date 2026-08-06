import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Contrato ESTÁTICO de integración de NotificationPanel (P3-07C). Sucesor del contrato de
 * preparación (eliminado en esta rama): aquel verificaba que el componente espejara el JSX
 * inline del root SIN estar cableado; este verifica lo contrario — el root delega en
 * NotificationPanel dentro del slot notificationOverlay, el JSX inline fue eliminado, y el
 * componente conserva DOM/ARIA/copy, pureza y reutilización de NotificationGroup.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontró el inicio del contrato: ${startMarker}`);
  assert.ok(end > start, `No se encontró el final del contrato: ${endMarker}`);
  return source.slice(start, end);
}

function assertInOrder(source: string, markers: readonly string[]) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker);
    assert.ok(current >= 0, `Falta el paso requerido: ${marker}`);
    assert.ok(current > previous, `El paso está fuera de orden: ${marker}`);
    previous = current;
  }
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
    current = current.expression;
  }
  return current;
}

function propertyNameText(member: ts.ObjectLiteralElementLike): string | null {
  if (!member.name) return null;
  return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
    ? member.name.text
    : null;
}

function isNamedPropertyAccess(
  expression: ts.Expression,
  receiverName: string,
  propertyName: string,
): expression is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(expression) &&
    !expression.questionDotToken &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === receiverName &&
    expression.name.text === propertyName;
}

function unwrapWriteTarget(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) current = current.expression;
  return current;
}

function isNamedWriteReceiver(expression: ts.Expression, name: string): boolean {
  const current = unwrapWriteTarget(expression);
  if (ts.isIdentifier(current)) return current.text === name;
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return isNamedWriteReceiver(current.right, name);
  }
  if (ts.isCommaListExpression(current) && current.elements.length > 0) {
    return isNamedWriteReceiver(current.elements[current.elements.length - 1], name);
  }
  if (ts.isConditionalExpression(current)) {
    return isNamedWriteReceiver(current.whenTrue, name) ||
      isNamedWriteReceiver(current.whenFalse, name);
  }
  if (
    ts.isBinaryExpression(current) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(current.operatorToken.kind)
  ) {
    return isNamedWriteReceiver(current.left, name) ||
      isNamedWriteReceiver(current.right, name);
  }
  return false;
}

function isOnOpenIntentCurrentWriteTarget(expression: ts.Expression) {
  const target = unwrapWriteTarget(expression);
  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text === "current" &&
      isNamedWriteReceiver(target.expression, "onOpenIntentRef");
  }
  return ts.isElementAccessExpression(target) &&
    isNamedWriteReceiver(target.expression, "onOpenIntentRef");
}

function findOnOpenIntentCurrentWrites(root: ts.Node) {
  const writes: ts.Node[] = [];
  const inspectWriteTarget = (target: ts.Expression, owner: ts.Node): void => {
    const unwrapped = unwrapWriteTarget(target);
    if (isOnOpenIntentCurrentWriteTarget(unwrapped)) {
      writes.push(owner);
      return;
    }
    if (ts.isArrayLiteralExpression(unwrapped)) {
      for (const element of unwrapped.elements) {
        if (ts.isOmittedExpression(element)) continue;
        inspectWriteTarget(ts.isSpreadElement(element) ? element.expression : element, owner);
      }
      return;
    }
    if (ts.isObjectLiteralExpression(unwrapped)) {
      for (const property of unwrapped.properties) {
        if (ts.isPropertyAssignment(property)) inspectWriteTarget(property.initializer, owner);
        if (ts.isSpreadAssignment(property)) inspectWriteTarget(property.expression, owner);
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) inspectWriteTarget(node.left, node);
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
    ) inspectWriteTarget(node.operand, node);
    if (ts.isDeleteExpression(node)) inspectWriteTarget(node.expression, node);
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    ) inspectWriteTarget(node.initializer, node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return writes;
}

function findHookBoundary(input: {
  path: string;
  source: string;
  functionName: string;
}) {
  const sourceFile = ts.createSourceFile(
    input.path,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    input.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const candidates = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === input.functionName
  ));
  assert.equal(candidates.length, 1, `${input.functionName}: se esperaba una función top-level inequívoca`);
  const body = candidates[0].body;
  assert.ok(body, `${input.functionName}: la función debe tener cuerpo ejecutable`);
  const returns = body.statements.filter((statement): statement is ts.ReturnStatement => (
    ts.isReturnStatement(statement)
  ));
  assert.equal(returns.length, 1, `${input.functionName}: se esperaba un único return directo del boundary`);
  const returnedExpression = returns[0].expression && unwrapExpression(returns[0].expression);
  assert.ok(
    returnedExpression && ts.isObjectLiteralExpression(returnedExpression),
    `${input.functionName}: el return directo debe ser un objeto boundary`,
  );
  return { body, returnStatement: returns[0], returnedObject: returnedExpression };
}

function assertNotificationsOpenWiring(source: string) {
  const functionName = "useNotificationsController";
  const { body, returnStatement, returnedObject } = findHookBoundary({
    path: "src/features/notifications/hooks/useNotificationsController.ts",
    source,
    functionName,
  });
  const commandDeclarations = body.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.filter((declaration) => (
      ts.isIdentifier(declaration.name) && declaration.name.text === "commands"
    ));
  });
  assert.equal(commandDeclarations.length, 1, `${functionName}: binding commands ausente o ambiguo`);
  const commandsInitializer = commandDeclarations[0].initializer &&
    unwrapExpression(commandDeclarations[0].initializer);
  assert.ok(
    commandsInitializer && ts.isCallExpression(commandsInitializer),
    `${functionName}: commands debe inicializarse con un CallExpression`,
  );
  assert.ok(
    isNamedPropertyAccess(commandsInitializer.expression, "controller", "captureCommands") &&
      commandsInitializer.arguments.length === 0,
    `${functionName}: commands debe provenir de controller.captureCommands()`,
  );

  const refDeclarations = body.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.filter((declaration) => (
      ts.isIdentifier(declaration.name) && declaration.name.text === "onOpenIntentRef"
    ));
  });
  assert.equal(refDeclarations.length, 1, `${functionName}: binding onOpenIntentRef ausente o ambiguo`);
  const refDeclarationList = refDeclarations[0].parent;
  assert.ok(
    ts.isVariableDeclarationList(refDeclarationList) &&
      (refDeclarationList.flags & ts.NodeFlags.Const) !== 0 &&
      ts.isVariableStatement(refDeclarationList.parent) &&
      refDeclarationList.parent.parent === body,
    `${functionName}: onOpenIntentRef debe ser un const directo del cuerpo principal`,
  );
  const refInitializer = refDeclarations[0].initializer && unwrapExpression(refDeclarations[0].initializer);
  assert.ok(
    refInitializer &&
      ts.isCallExpression(refInitializer) &&
      ts.isIdentifier(refInitializer.expression) &&
      refInitializer.expression.text === "useRef" &&
      refInitializer.arguments.length === 1 &&
      isNamedPropertyAccess(refInitializer.arguments[0], "input", "onOpenIntent"),
    `${functionName}: onOpenIntentRef debe inicializarse con useRef(input.onOpenIntent)`,
  );
  const refCurrentAssignments = findOnOpenIntentCurrentWrites(body);
  assert.equal(
    refCurrentAssignments.length,
    1,
    `${functionName}: onOpenIntentRef.current debe tener exactamente una escritura total`,
  );
  const refRefreshAssignment = refCurrentAssignments[0];
  assert.ok(
    ts.isBinaryExpression(refRefreshAssignment) &&
      refRefreshAssignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isNamedPropertyAccess(refRefreshAssignment.left, "onOpenIntentRef", "current") &&
      isNamedPropertyAccess(refRefreshAssignment.right, "input", "onOpenIntent"),
    `${functionName}: la única escritura debe ser onOpenIntentRef.current = input.onOpenIntent`,
  );
  const refRefreshStatement = refRefreshAssignment.parent;
  assert.ok(
    ts.isExpressionStatement(refRefreshStatement) &&
      refRefreshStatement.expression === refRefreshAssignment &&
      refRefreshStatement.parent === body,
    `${functionName}: la sincronización canónica debe ser un statement directo del cuerpo principal`,
  );
  assert.ok(
    body.statements.indexOf(refRefreshStatement) < body.statements.indexOf(returnStatement),
    `${functionName}: la sincronización canónica debe ejecutarse antes del return productivo`,
  );

  const members = returnedObject.properties.filter((member) => (
    propertyNameText(member) === "openNotificationTarget"
  ));
  assert.equal(members.length, 1, `${functionName}.openNotificationTarget: miembro ausente o ambiguo`);
  const member = members[0];
  let executableBody: ts.ConciseBody;
  if (ts.isMethodDeclaration(member)) {
    assert.ok(member.body, `${functionName}.openNotificationTarget: MethodDeclaration sin cuerpo`);
    executableBody = member.body;
  } else if (ts.isPropertyAssignment(member)) {
    const initializer = unwrapExpression(member.initializer);
    assert.ok(
      ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer),
      `${functionName}.openNotificationTarget: PropertyAssignment debe contener ArrowFunction o FunctionExpression`,
    );
    executableBody = initializer.body;
  } else {
    assert.fail(
      `${functionName}.openNotificationTarget: se esperaba MethodDeclaration o PropertyAssignment, no ${ts.SyntaxKind[member.kind]}`,
    );
  }

  let returnedCall: ts.Expression;
  if (ts.isBlock(executableBody)) {
    const returns = executableBody.statements.filter((statement): statement is ts.ReturnStatement => (
      ts.isReturnStatement(statement)
    ));
    assert.equal(returns.length, 1, `${functionName}.openNotificationTarget: se esperaba un único ReturnStatement directo`);
    assert.ok(returns[0].expression, `${functionName}.openNotificationTarget: return sin expresión`);
    returnedCall = unwrapExpression(returns[0].expression);
  } else {
    returnedCall = unwrapExpression(executableBody);
  }
  assert.ok(
    ts.isCallExpression(returnedCall),
    `${functionName}.openNotificationTarget: el resultado debe ser un CallExpression ejecutable`,
  );
  assert.ok(
    isNamedPropertyAccess(returnedCall.expression, "commands", "open"),
    `${functionName}.openNotificationTarget: debe delegar directamente en commands.open(...)`,
  );
  assert.ok(
    returnedCall.arguments.length === 2 &&
      ts.isIdentifier(returnedCall.arguments[0]) &&
      returnedCall.arguments[0].text === "notification",
    `${functionName}.openNotificationTarget: arguments de commands.open incompletos`,
  );
  const callback = unwrapExpression(returnedCall.arguments[1]);
  assert.ok(
    ts.isArrowFunction(callback) || ts.isFunctionExpression(callback),
    `${functionName}.openNotificationTarget: callback debe ser ArrowFunction o FunctionExpression`,
  );
  assert.equal(
    callback.parameters.length,
    1,
    `${functionName}.openNotificationTarget: callback debe declarar exactamente un parámetro`,
  );
  const callbackParameterDeclaration = callback.parameters[0];
  const callbackParameter = callbackParameterDeclaration.name;
  assert.ok(
    ts.isIdentifier(callbackParameter) &&
      !callbackParameterDeclaration.dotDotDotToken &&
      !callbackParameterDeclaration.initializer,
    `${functionName}.openNotificationTarget: parámetro del callback debe ser Identifier`,
  );

  let callbackOperation: ts.Expression;
  if (ts.isBlock(callback.body)) {
    assert.equal(
      callback.body.statements.length,
      1,
      `${functionName}.openNotificationTarget: callback de bloque debe contener una única operación`,
    );
    const statement = callback.body.statements[0];
    if (ts.isReturnStatement(statement)) {
      assert.ok(statement.expression, `${functionName}.openNotificationTarget: callback retorna sin expresión`);
      callbackOperation = unwrapExpression(statement.expression);
    } else if (ts.isExpressionStatement(statement)) {
      callbackOperation = unwrapExpression(statement.expression);
    } else {
      assert.fail(
        `${functionName}.openNotificationTarget: callback contiene ${ts.SyntaxKind[statement.kind]} no autorizado`,
      );
    }
  } else {
    callbackOperation = unwrapExpression(callback.body);
  }
  assert.ok(
    ts.isCallExpression(callbackOperation),
    `${functionName}.openNotificationTarget: callback debe ejecutar onOpenIntentRef.current(...)`,
  );
  assert.ok(
    isNamedPropertyAccess(callbackOperation.expression, "onOpenIntentRef", "current"),
    `${functionName}.openNotificationTarget: receiver debe ser onOpenIntentRef.current`,
  );
  assert.equal(
    callbackOperation.arguments.length,
    1,
    `${functionName}.openNotificationTarget: onOpenIntentRef.current requiere un argumento`,
  );
  assert.ok(
    ts.isIdentifier(callbackOperation.arguments[0]) &&
      callbackOperation.arguments[0].text === callbackParameter.text,
    `${functionName}.openNotificationTarget: debe reenviar exactamente el Identifier recibido`,
  );
  const refIdentifiers: ts.Identifier[] = [];
  const collectRefIdentifiers = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "onOpenIntentRef") refIdentifiers.push(node);
    ts.forEachChild(node, collectRefIdentifiers);
  };
  collectRefIdentifiers(body);
  assert.equal(
    refIdentifiers.length,
    3,
    `${functionName}: onOpenIntentRef debe conservar un binding único y sólo sus usos canónicos`,
  );
}

const appSource = readSource("src/components/organizatech-app.tsx");
const panelSource = readSource("src/features/notifications/components/NotificationPanel.tsx");
const notificationsHookSource = readSource("src/features/notifications/hooks/useNotificationsController.ts");
const notificationsControllerSource = readSource("src/features/notifications/model/notifications-controller.ts");
const packageSource = readSource("package.json");

// 1. El root importa NotificationPanel y lo usa dentro del slot notificationOverlay.
assert.match(appSource, /import \{ NotificationPanel \} from "@\/features\/notifications\/components\/NotificationPanel";/);
assert.match(appSource, /notificationOverlay=\{\s*<NotificationPanel/);

// 2. Props exactas: total completo (no métricas derivadas), arrays correctos, registros vistos,
//    mensaje vacío canónico, apertura y cierre productivos.
assert.match(appSource, /isOpen=\{isNotificationPanelOpen\}/);
assert.match(appSource, /subtitle=\{notificationPanelSubtitle\}/);
assert.match(appSource, /totalNotificationsCount=\{appNotifications\.length\}/);
assert.doesNotMatch(appSource, /totalNotificationsCount=\{(?:unseenNotificationCount|newNotifications\.length|historyNotifications\.length)/, "el estado vacio depende del total completo, no de una metrica derivada");
assert.match(appSource, /newNotifications=\{newNotifications\}/);
assert.match(appSource, /historyNotifications=\{historyNotifications\}/);
assert.match(appSource, /seenNotificationRecordsById=\{seenNotificationRecordsById\}/);
assert.match(appSource, /emptyMessage=\{NOTIFICATION_EMPTY_MESSAGE\}/);
assert.match(appSource, /onClose=\{appShell\.closeNotifications\}/);
assert.match(appSource, /onOpenNotification=\{openNotificationTarget\}/);

// 3. El JSX inline antiguo fue eliminado del root.
assert.doesNotMatch(appSource, /className="notification-backdrop"/, "el backdrop ahora vive en NotificationPanel");
assert.doesNotMatch(appSource, /className="notification-panel"/, "el panel ahora vive en NotificationPanel");
assert.doesNotMatch(appSource, /className="notification-empty"/, "el estado vacio ahora vive en NotificationPanel");
assert.doesNotMatch(appSource, /<NotificationGroup/, "los grupos se renderizan via NotificationPanel");
assert.doesNotMatch(appSource, /import \{ NotificationGroup \}/, "el root ya no importa NotificationGroup directamente");

// 4. DOM/clases/roles/ARIA del componente, con la estructura exacta del JSX original.
assert.match(panelSource, /if \(!isOpen\) return null;/);
assert.match(panelSource, /className="notification-backdrop"\s*\n\s*aria-label="Cerrar notificaciones"\s*\n\s*onClick=\{onClose\}/);
assert.match(panelSource, /className="notification-panel"/);
assert.match(panelSource, /role="dialog"/);
assert.match(panelSource, /aria-label="Notificaciones"/);
assert.match(panelSource, /className="notification-panel-header"/);
assert.match(panelSource, /<strong id=\{NOTIFICATION_PANEL_TITLE_ID\}>Notificaciones<\/strong>/);
assert.match(panelSource, /totalNotificationsCount > 0 \? \(/);
assert.match(panelSource, /className="notification-list"/);
// P3-48B (COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente; NO renderizan React ni
// verifican el anuncio real de un lector de pantalla): el estado vacio pasa a la primitive
// compartida, conservando clase, texto y condicion.
assert.match(panelSource, /import \{ EmptyState \} from "@\/ui\/feedback\/empty-state";/);
assert.match(panelSource, /<EmptyState className="notification-empty" message=\{emptyMessage\} \/>/);
assert.equal((panelSource.match(/<EmptyState\b/g) ?? []).length, 1, "un unico estado vacio");
assert.doesNotMatch(panelSource, /<p className="notification-empty"/, "no debe quedar el markup local migrado");
// La condicion de vacio no cambia.
assert.match(panelSource, /totalNotificationsCount > 0 \? \([\s\S]*?\) : \(\s*<EmptyState/);
// `drawer-empty` NO se migra: es un backdrop/boton, no un estado vacio.
assert.doesNotMatch(panelSource, /drawer-empty/);

// Semantica accesible de la primitive real (source-based).
const emptyStateSource = readSource("src/ui/feedback/empty-state.tsx");
assert.equal((emptyStateSource.match(/^export function EmptyState\b/gm) ?? []).length, 1, "una sola definicion de EmptyState");
assert.match(emptyStateSource, /role="status"/, "el estado vacio se anuncia tras la carga");
const emptyStateCode = emptyStateSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const forbidden of [/useState|useEffect/, /dangerouslySetInnerHTML/, /onClick/, /lucide-react/]) {
  assert.doesNotMatch(emptyStateCode, forbidden, `EmptyState no debe incorporar ${forbidden}`);
}

assert.doesNotMatch(panelSource, /data-section=/, "el JSX original no tenia data-section y el componente tampoco debe tenerlo");

// 5. Grupos: reutilización de NotificationGroup (exactamente 2 usos), Nuevas antes de Historial.
assert.match(panelSource, /import \{ NotificationGroup \} from "\.\/NotificationGroup";/);
assert.equal((panelSource.match(/<NotificationGroup/g) ?? []).length, 2, "exactamente dos grupos: Nuevas e Historial");
assert.ok(
  panelSource.indexOf('title="Nuevas"') >= 0 &&
  panelSource.indexOf('title="Historial"') > panelSource.indexOf('title="Nuevas"'),
  "Nuevas debe renderizarse antes de Historial",
);
assert.doesNotMatch(panelSource, /^\s*function NotificationGroup\b|^\s*function renderNotificationIcon\b/m, "no se duplican grupos ni iconos");

// 6. Pureza del componente: solo callbacks, sin estado propio, sin efectos, sin dependencias
//    prohibidas (absorbe la lista del contrato de preparación eliminado).
for (const forbidden of [
  /\buseState\b/, /\buseEffect\b/, /\buseMemo\b/, /\buseRef\b/,
  /\bwindow\.\w/, /\bdocument\.\w/, /\bsetTimeout\b/, /\bquerySelector\b/, /\bscrollIntoView\b/,
  /\bsetScreen\b/, /\bsetScreenHistory\b/,
  /\bmarkNotificationsSeen\b/, /\btoggleNotifications\b/, /\bopenNotificationTarget\b/, /\bscrollToNotificationSection\b/,
  /from ["']@\/components\/organizatech-app["']/,
  /from ["']@\/lib\/(?:data|storage|supabase|navigation)\//,
  /-repository["']/,
]) {
  assert.doesNotMatch(panelSource, forbidden, `NotificationPanel no debe contener ${forbidden}`);
}

// 7. Ownership y orden funcional externo preservados: NotificationPanel entrega el evento al
//    command público; el controller valida/seen/persiste antes de publicar el intent; el root sólo
//    implementa el port transversal de close/overrides/navegación/scroll.
assert.match(
  appSource,
  /import \{ useNotificationsController \} from "@\/features\/notifications\/hooks\/useNotificationsController";/,
);
assert.match(appSource, /const notificationsBoundary = useNotificationsController\(\{/);
assert.match(appSource, /onOpenIntent: handleNotificationOpenIntent,/);
assert.match(appSource, /openNotificationTarget,\s*\n\s*\} = notificationsBoundary;/);
assert.doesNotMatch(
  appSource,
  /function openNotificationTarget\s*\(/,
  "el root no debe recuperar ownership de openNotificationTarget",
);

assertNotificationsOpenWiring(notificationsHookSource);

const controllerCommandsSource = sourceSection(
  notificationsControllerSource,
  "    captureCommands() {",
  "    invalidateIdentity() {",
);
assertInOrder(controllerCommandsSource, [
  "if (!owner || !isCapturedOwnerCurrent(owner)) return false;",
  "const intent = resolveNotificationOpenIntent(notification);",
  "const replayGuard = acquireOpenReplayGuard(owner, intent);",
  "if (!markSeen([notification.id])) {",
  "publishIntent(intent);",
]);

const openIntentPortSource = sourceSection(
  appSource,
  "  function handleNotificationOpenIntent(intent: NotificationOpenIntent) {",
  "  function scrollToNotificationSection",
);
assertInOrder(openIntentPortSource, [
  "appShell.closeNotifications();",
  "activeWorkoutActions.clearTrainingCompletionSummary();",
  "if (intent.dashboardDayOverride)",
  "if (intent.comparisonDayOverride)",
  "navigateTo(intent.target);",
  "scrollToNotificationSection(intent.section ?? undefined);",
]);

// 8. Controlador de navegación intacto (P3-07B no se degrada).
assert.equal((appSource.match(/setScreen\(/g) ?? []).length, 0);
assert.equal((appSource.match(/setScreenHistory\(/g) ?? []).length, 0);

// 9. Registro exacto en la suite.
assert.equal(
  packageSource.split("tsx src/features/notifications/notification-panel-visual-integration-contract.test.ts").length - 1,
  1,
  "el contrato debe estar registrado exactamente una vez",
);

// -------------------------------------------------------------------------------------------
// P3-50B1 — NotificationPanel conectado al motor compartido de foco.
//
// COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente. NO ejecutan foco, teclado ni
// DOM, y NO sustituyen la QA manual en navegador (ver informe).
// -------------------------------------------------------------------------------------------
assert.match(panelSource, /import \{ useOverlayFocusManagement \} from "@\/ui\/overlays\/use-overlay-focus-management";/);
// Las aserciones estructurales se evaluan sobre el CODIGO sin comentarios: la documentacion del
// componente menciona `tabIndex={-1}` y `notification-item`, y podria satisfacerlas por accidente.
const panelCode = panelSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
// (2) El hook se invoca ANTES del return condicional por isOpen.
const panelHookIndex = panelSource.indexOf("useOverlayFocusManagement<HTMLDivElement>(");
const panelEarlyReturnIndex = panelSource.indexOf("if (!isOpen) return null;");
assert.ok(panelHookIndex >= 0 && panelEarlyReturnIndex > panelHookIndex, "el hook debe llamarse antes del early return");
// (3)(4) Ref conectado, isActive={isOpen}, id estable, aria-modal y tabIndex fallback.
assert.match(panelSource, /isActive: isOpen,\s*\n\s*onClose,\s*\n\s*canClose: true,/);
assert.match(panelCode, /ref=\{panelRef\}/);
assert.match(panelSource, /export const NOTIFICATION_PANEL_ID = "notification-panel";/);
assert.match(panelCode, /id=\{NOTIFICATION_PANEL_ID\}/);
assert.match(panelCode, /aria-modal="true"/);
assert.match(panelCode, /tabIndex=\{-1\}/);
// (10) Titulo visible asociado por aria-labelledby, sin perder el nombre accesible.
assert.match(panelSource, /export const NOTIFICATION_PANEL_TITLE_ID = "notification-panel-title";/);
assert.match(panelCode, /aria-labelledby=\{NOTIFICATION_PANEL_TITLE_ID\}/);
// (5)(6) Foco inicial por fallback natural: NO se marca un objetivo explicito en el panel.
assert.doesNotMatch(panelCode, /OVERLAY_INITIAL_FOCUS_ATTRIBUTE/, "el foco inicial debe resolverse por fallback natural");
// (11) Sin listeners, stacks ni selectores locales.
for (const forbiddenLocal of [
  /addEventListener|removeEventListener/,
  /useEffect/,
  /querySelectorAll/,
  /activeOverlayOwners|activeModalOwners/,
  /dangerouslySetInnerHTML/,
]) {
  assert.doesNotMatch(panelCode, forbiddenLocal, `el panel no debe implementar ${forbiddenLocal}`);
}
// (8) aria-controls coincidente en el trigger de la topbar.
const topbarSource = readSource("src/features/app-shell/components/app-topbar.tsx");
assert.match(topbarSource, /aria-controls=\{NOTIFICATION_PANEL_ID\}/);
assert.match(topbarSource, /import \{ NOTIFICATION_PANEL_ID \} from "@\/features\/notifications\/components\/NotificationPanel";/);
assert.match(topbarSource, /aria-expanded=\{isNotificationPanelOpen\}/, "el trigger conserva aria-expanded");

console.log("notification-panel visual integration contract tests passed");
