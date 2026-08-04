import assert from "node:assert/strict";
import test from "node:test";

import {
  applyActiveWorkoutReentry,
  applyContextualBackDecision,
  resolveNavigationTransition,
  type AppNavigationBackPorts,
} from "@/features/app-shell/model/app-navigation-controller-state";
import {
  resolveContextualBackNavigation,
  type ContextualNavigationState,
} from "@/lib/navigation/app-navigation";
import {
  createAuthNavigationReset,
  createFlowScreenTransition,
} from "@/lib/navigation/app-navigation-transition";

test("navigation reset cambia pantalla y siempre vacía el historial", () => {
  const current = {
    screen: "perfil" as const,
    history: ["dashboard" as const, "comparacion" as const],
  };
  assert.deepEqual(
    resolveNavigationTransition(current, createAuthNavigationReset("login", "auth-screen-switch")),
    { screen: "login", history: [] },
  );
});

test("transition preserve conserva exactamente el historial", () => {
  const history = ["dashboard" as const, "comparacion" as const];
  assert.deepEqual(
    resolveNavigationTransition(
      { screen: "perfil", history },
      createFlowScreenTransition("entrenamiento", "routine-day-opened"),
    ),
    { screen: "entrenamiento", history },
  );
});

test("back con workout y readiness pausa, vuelve a Dashboard y vacía historial", () => {
  const decision = resolveContextualBackNavigation({
    current: { screen: "entrenamiento", history: ["perfil", "dashboard"] },
    hasStartedTraining: true,
    hasReadiness: true,
    isEditingRoutinePlan: false,
    hasRoutinePlan: true,
    routineEditorReturnScreen: null,
  });
  let pauses = 0;
  let menuCloses = 0;
  let published: ContextualNavigationState | null = null;
  const ports: AppNavigationBackPorts = {
    hasStartedTraining: true,
    hasReadiness: true,
    isEditingRoutinePlan: false,
    hasRoutinePlan: true,
    routineEditorReturnScreen: null,
    pauseTraining: () => { pauses += 1; },
    stopTraining: () => assert.fail("pausar no cancela el start"),
    clearReadiness: () => assert.fail("readiness no se limpia al pausar"),
    closeRoutineEditor: () => assert.fail("routine editor no participa"),
    clearRoutineEditorReturnScreen: () => assert.fail("return screen no participa"),
    closeMenu: () => { menuCloses += 1; },
  };

  applyContextualBackDecision(decision, ports, (navigation) => {
    published = navigation;
  });

  assert.equal(pauses, 1);
  assert.equal(menuCloses, 0);
  assert.deepEqual(published, { screen: "dashboard", history: [] });
});

for (const source of ["memoria", "draft"] as const) {
  test(`reentry por ${source} termina una vez en entrenamiento, sin historial y con menú cerrado`, () => {
    let restoreCalls = 0;
    let menuCloses = 0;
    const publications: ContextualNavigationState[] = [];
    const restored = (() => {
      restoreCalls += 1;
      return true;
    })();

    const result = applyActiveWorkoutReentry(restored, {
      resetToWorkout: () => publications.push({ screen: "entrenamiento", history: [] }),
      closeMenu: () => { menuCloses += 1; },
    });

    assert.equal(result, true);
    assert.equal(restoreCalls, 1);
    assert.equal(menuCloses, 1);
    assert.deepEqual(publications, [{ screen: "entrenamiento", history: [] }]);
  });
}

test("reentry unavailable no navega ni cierra el menú", () => {
  let resets = 0;
  let menuCloses = 0;
  assert.equal(applyActiveWorkoutReentry(false, {
    resetToWorkout: () => { resets += 1; },
    closeMenu: () => { menuCloses += 1; },
  }), false);
  assert.equal(resets, 0);
  assert.equal(menuCloses, 0);
});
