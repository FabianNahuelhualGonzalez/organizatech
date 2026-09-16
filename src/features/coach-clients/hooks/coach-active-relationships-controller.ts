import type { CoachActiveRelationshipsController, CoachActiveRelationshipsControllerInput,
  CoachActiveRelationshipsCursor, CoachActiveRelationshipsItem,
} from "./coach-active-relationships-controller-contract";
import { createCoachClientListController, readCoachClientListString,
  readCoachClientListTimestamp } from "./internal/coach-client-list-controller";

const activeShape = Object.freeze({
  totalField: "totalActive" as const,
  timestamp: (position: CoachActiveRelationshipsCursor) => position.linkedAt,
  copyCursor: (value: unknown): CoachActiveRelationshipsCursor => Object.freeze({
    id: readCoachClientListString(value, "id"), linkedAt: readCoachClientListTimestamp(value, "linkedAt"),
  }),
  copyItem: (value: unknown): CoachActiveRelationshipsItem => Object.freeze({
    id: readCoachClientListString(value, "id"), linkedAt: readCoachClientListTimestamp(value, "linkedAt"),
    studentName: readCoachClientListString(value, "studentName"), studentEmail: readCoachClientListString(value, "studentEmail"),
  }),
});

/** One independent active-list instance, backed only by validated consented episode snapshots. */
export function createCoachActiveRelationshipsController(
  input: CoachActiveRelationshipsControllerInput,
): CoachActiveRelationshipsController {
  return createCoachClientListController(input, activeShape);
}
