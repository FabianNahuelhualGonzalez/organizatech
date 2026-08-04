import type {
  ContextualBackDecision,
  ContextualNavigationDecision,
  ContextualNavigationState,
  Screen,
} from "@/lib/navigation/app-navigation";
import type { ScreenTransition } from "@/lib/navigation/app-navigation-transition";
import type { DataMode } from "@/lib/supabase/session";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";

export interface AppNavigationPersistenceContext {
  dataMode: DataMode;
  userId?: string;
  activeStorageScope: BrowserStorageScope | null;
  hasRoutinePlan: boolean;
  isEditingRoutinePlan: boolean;
  hasStartedTraining: boolean;
  readiness: { skipped: boolean } | null;
}

export interface AppNavigationNavigatePorts {
  hasRoutinePlan: boolean;
  prepareRoutineEditor(): boolean;
  clearTrainingCompletionSummary(): void;
  tryRestoreActiveWorkout(): boolean;
  clearTrainingStart(): void;
  setRoutineEditorEditing(editing: boolean): void;
  closeMenu(): void;
}

export interface AppNavigationReentryPorts {
  tryRestoreActiveWorkout(): boolean;
  closeMenu(): void;
}

export interface AppNavigationBackPorts {
  hasStartedTraining: boolean;
  hasReadiness: boolean;
  isEditingRoutinePlan: boolean;
  hasRoutinePlan: boolean;
  routineEditorReturnScreen: Screen | null;
  pauseTraining(): void;
  stopTraining(): void;
  clearReadiness(): void;
  closeRoutineEditor(): void;
  clearRoutineEditorReturnScreen(): void;
  closeMenu(): void;
}

export interface AppNavigationRestorePorts {
  beforeRestoreAttempt(scope: BrowserStorageScope | null): void;
  restoreRoutineDraft(mode: DataMode, userId?: string): boolean;
  restoreWorkoutDraft(mode: DataMode, userId?: string): boolean;
  clearTrainingStart(): void;
  closeMenu(): void;
}

export interface AppNavigationController {
  readonly state: ContextualNavigationState;
  readonly screen: Screen;
  readonly history: readonly Screen[];
  applyNavigation(navigation: ContextualNavigationState): void;
  transition(transition: ScreenTransition): void;
  reset(screen: Screen): void;
  navigate(nextScreen: Screen, ports: AppNavigationNavigatePorts): ContextualNavigationDecision;
  back(ports: AppNavigationBackPorts): ContextualBackDecision;
  reenterActiveWorkout(ports: AppNavigationReentryPorts): boolean;
  restoreActiveFlow(
    mode: DataMode,
    userId: string | undefined,
    ports: AppNavigationRestorePorts,
  ): boolean;
}

export function applyActiveWorkoutReentry(
  restored: boolean,
  ports: {
    resetToWorkout(): void;
    closeMenu(): void;
  },
): boolean {
  if (!restored) return false;
  ports.resetToWorkout();
  ports.closeMenu();
  return true;
}

export function applyContextualBackDecision(
  decision: ContextualBackDecision,
  ports: AppNavigationBackPorts,
  applyNavigation: (navigation: ContextualNavigationState) => void,
): void {
  if (decision.pauseTraining) ports.pauseTraining();
  if (decision.stopTraining) ports.stopTraining();
  if (decision.clearReadiness) ports.clearReadiness();
  if (decision.closeRoutineEditor) ports.closeRoutineEditor();
  if (decision.clearRoutineEditorReturnScreen) ports.clearRoutineEditorReturnScreen();
  if (decision.navigationChanged) applyNavigation(decision.navigation);
  if (decision.closeMenu) ports.closeMenu();
}

export function resolveNavigationTransition(
  current: ContextualNavigationState,
  transition: ScreenTransition,
): ContextualNavigationState {
  if (transition.historyPolicy === "reset") {
    return { screen: transition.screen, history: [] };
  }
  return { screen: transition.screen, history: [...current.history] };
}
