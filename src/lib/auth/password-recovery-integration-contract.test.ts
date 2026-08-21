import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const recoverySource = readFileSync("src/lib/auth/password-recovery-session.ts", "utf8");
const storageSource = readFileSync("src/lib/storage/browser-storage.ts", "utf8");

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontró el inicio: ${startMarker}`);
  assert.ok(end > start, `No se encontró el final: ${endMarker}`);
  return source.slice(start, end);
}

const bootstrapSource = sourceSection(
  appSource,
  "    async function bootstrapSession()",
  "    void bootstrapSession();",
);
const updateHandlerSource = sourceSection(
  appSource,
  "  async function handleUpdatePassword",
  "  function prepareRoutineBuilderStateFromExercises",
);
const bootstrapCatchSource = sourceSection(
  bootstrapSource,
  "      } catch (error) {",
  "      } finally {",
);
const completionSource = sourceSection(
  appSource,
  "  function completePasswordRecoveryUpdate",
  "  useEffect(() => {",
);

assert.match(appSource, /screen === "nueva-password" && isPasswordRecoveryConfirmed/);
assert.match(bootstrapSource, /resolvePasswordRecoverySessionDecision\([\s\S]*?event: "bootstrap"/);
assert.match(bootstrapSource, /recoveryDecision === "invalid"[\s\S]*?invalidatePasswordRecoverySession\(\)/);
assert.match(bootstrapSource, /recoveryDecision === "confirmed"[\s\S]*?confirmPasswordRecoverySession\(authState\.session\)/);
assert.match(appSource, /event === "PASSWORD_RECOVERY" \|\| event === "INITIAL_SESSION" \|\| event === "SIGNED_IN"/);
assert.match(appSource, /hasPasswordRecoveryCallbackError\(\{\s*error,\s*errorCode,\s*errorDescription,?\s*\}\)/);
assert.match(appSource, /return getBrowserAuthCallbackUrl\(PASSWORD_RECOVERY_FLOW\);/);
assert.match(appSource, /hashParams\.get\("type"\) === "recovery" && accessToken/);
assert.match(appSource, /authState\.session\?\.access_token === recoveryCallbackAccessToken/);
assert.match(appSource, /session\?\.access_token === recoveryCallbackAccessToken/);
assert.match(appSource, /confirmPasswordRecoveryFlow\(recoveryUserId\)/);
assert.match(appSource, /const initialPasswordRecoveryRouteStateRef = useRef/);
assert.equal(
  (sourceSection(appSource, "export function OrganizatechApp", "  const [sessionName, setSessionName]")
    .match(/getPasswordRecoveryRouteState\(\)/g) ?? []).length,
  1,
);
assert.match(bootstrapSource, /const recoveryState = initialPasswordRecoveryRouteState;/);
assert.match(bootstrapCatchSource, /sessionLookup: "error"/);
assert.match(bootstrapCatchSource, /setIsAuthLoading\(true\)/);
assert.doesNotMatch(bootstrapCatchSource, /invalidatePasswordRecoverySession|clearPasswordRecovery/);

assert.match(updateHandlerSource, /!confirmedUserId[\s\S]*?!isPasswordRecoveryConfirmed[\s\S]*?passwordRecoveryStateRef\.current !== "confirmed"/);
assert.match(updateHandlerSource, /tryAcquireActiveWorkoutOperation\(passwordRecoveryUpdateOwnerRef\)/);
assert.match(updateHandlerSource, /const operationOwner = tryAcquireActiveWorkoutOperation\(passwordRecoveryUpdateOwnerRef\);\s*\n\s*if \(!operationOwner\) return;/);
assert.match(updateHandlerSource, /isActiveWorkoutOperationCurrent\([\s\S]*?passwordRecoveryUpdateOwnerRef/);
assert.match(updateHandlerSource, /finalizeActiveWorkoutOperation\([\s\S]*?passwordRecoveryUpdateOwnerRef/);
assert.match(updateHandlerSource, /isTerminalOperationCurrent:[\s\S]*?sessionDataMountedRef\.current[\s\S]*?isSessionOperationOwner/);
assert.match(updateHandlerSource, /releaseSessionOperationOwner\(/);
assert.doesNotMatch(updateHandlerSource, /Symbol\(/);
assert.match(updateHandlerSource, /executePasswordRecoveryUpdate\(\{/);
assert.match(updateHandlerSource, /getSession: \(\) => supabase\.auth\.getSession\(\)/);
assert.equal((appSource.match(/supabase\.auth\.updateUser\(/g) ?? []).length, 1);
assert.match(updateHandlerSource, /updateUser: \(attributes\) => supabase\.auth\.updateUser\(attributes\)/);

const getSessionIndex = recoverySource.indexOf("await input.auth.getSession()");
const updateUserIndex = recoverySource.indexOf("await input.auth.updateUser({ password: input.password })");
assert.ok(getSessionIndex >= 0 && updateUserIndex > getSessionIndex, "getSession debe preceder al write allowlisted");
assert.match(recoverySource, /if \(sessionResult\.error \|\| !sessionResult\.data\.session\) return \{ kind: "invalid-recovery" \};/);
assert.match(recoverySource, /if \(!input\.isOperationCurrent\(\)\) return \{ kind: "stale" \};/);
assert.match(recoverySource, /const confirmedUserId = normalizePasswordRecoveryUserId\(input\.confirmedUserId\)/);
assert.match(recoverySource, /normalizePasswordRecoveryUserId\(sessionResult\.data\.session\.user\.id\) !== confirmedUserId/);
assert.match(recoverySource, /const signOutResult = await input\.auth\.signOut\(\);\s*\n\s*if \(!input\.isTerminalOperationCurrent\(\)\)/);
assert.match(recoverySource, /if \(signOutResult\.error\) return \{ kind: "sign-out-error", error: signOutResult\.error \};/);
assert.match(recoverySource, /input\.storedRecoveryStatus === "confirmed"/);
assert.match(recoverySource, /storedRecoveryUserId === sessionUserId/);
assert.match(recoverySource, /input\.event === "PASSWORD_RECOVERY"[\s\S]*?sessionUserId \? "confirmed" : "invalid"/);

assert.match(completionSource, /if \(!passwordUpdateSuccessRef\.current\) return false;/);
assert.match(completionSource, /setNewPassword\(""\)[\s\S]*?setNewPasswordConfirm\(""\)/);
assert.match(completionSource, /clearPasswordRecoveryUrl\(\)[\s\S]*?clearUserSessionState\(/);
assert.match(appSource, /event === "SIGNED_OUT"[\s\S]*?completePasswordRecoveryUpdate\(previousStorageScope\)/);
assert.match(updateHandlerSource, /completePasswordRecoveryUpdate\(recoveryStorageScope\)/);

assert.match(storageSource, /PASSWORD_RECOVERY_STORAGE_VERSION = 2/);
assert.match(storageSource, /status: "pending"/);
assert.match(storageSource, /status: "confirmed"/);
assert.match(storageSource, /normalizePasswordRecoveryUserId\(value: unknown\)/);
assert.match(storageSource, /userId: normalizedUserId/);
assert.doesNotMatch(storageSource, /accessToken|refreshToken|access_token|refresh_token|fingerprint/i);

console.log("password-recovery integration contract tests passed");
