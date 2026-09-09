import type {
  TrainingCycleBuilderOrigin,
  TrainingCycleDraftViewModel,
  TrainingCycleSaveDraftInput,
} from "../components/training-cycle-builder-contracts";
import { mapBuilderDraftDaysToRpcPlan } from "../data/training-cycle-rpc-mappers";
import { TrainingCycleTransportError } from "../data/training-cycle-rpc-types";
import { buildTrainingCycleSaveDraftInput, getTrainingCycleDraftValidation } from "./training-cycle-builder-state";
import type { TrainingCycleBuilderAction } from "./training-cycle-builder-state";
import type { TrainingCycleDraftAutosaveClaim, TrainingCycleDraftAutosaveOwner } from "./training-cycle-draft-autosave";

/** Valida antes de anunciar una escritura. Un campo en edición no es un fallo del servidor. */
export function prepareTrainingCycleDraftSave(
  draft: TrainingCycleDraftViewModel,
  origin: TrainingCycleBuilderOrigin,
): TrainingCycleSaveDraftInput | null {
  if (!getTrainingCycleDraftValidation(draft).canSave) return null;
  try {
    const input = buildTrainingCycleSaveDraftInput(draft, origin);
    mapBuilderDraftDaysToRpcPlan(input.days);
    return input;
  } catch (error) {
    if (error instanceof TrainingCycleTransportError
      && (error.code === "invalid_input" || error.code === "incomplete_plan" || error.code === "invalid_response")) {
      return null;
    }
    throw error;
  }
}

export async function requestTrainingCycleDraftSave(input: {
  readonly draft: TrainingCycleDraftViewModel;
  readonly origin: TrainingCycleBuilderOrigin;
  readonly owner: TrainingCycleDraftAutosaveOwner;
  readonly dispatch: (action: TrainingCycleBuilderAction) => void;
  readonly claim?: TrainingCycleDraftAutosaveClaim;
}) {
  const claim = input.claim ?? input.owner.claim(input.draft.draftId);
  if (!claim || !input.owner.ownsClaim(claim)) return;
  const payload = prepareTrainingCycleDraftSave(input.draft, input.origin);
  if (!payload) {
    input.dispatch({ type: "set_save_state", state: "pending", errorMessage: null });
    return;
  }
  input.dispatch({ type: "set_save_state", state: "saving", errorMessage: null });
  await input.owner.request(payload, claim);
}
