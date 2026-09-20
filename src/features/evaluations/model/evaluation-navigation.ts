export interface EvaluationOpenRequest {
  readonly ownerUserId: string;
  readonly assignmentId: string | null;
  readonly sequence: number;
}

export function createEvaluationOpenRequest(
  current: EvaluationOpenRequest | null,
  ownerUserId: string,
  assignmentId: string | null,
): EvaluationOpenRequest {
  return {
    ownerUserId,
    assignmentId,
    sequence: current?.ownerUserId === ownerUserId ? current.sequence + 1 : 1,
  };
}
