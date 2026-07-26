export interface ExerciseDraft {
  weight: string;
  rir: string;
  reps: Array<number | "">;
  registered: boolean;
  observation: string;
}
