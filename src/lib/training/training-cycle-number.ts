interface TrainingCycleNumberCandidate {
  cycleNumber: number;
}

export function calculateNextTrainingCycleNumber(cycles: TrainingCycleNumberCandidate[]) {
  const cycleNumbers = cycles
    .map((cycle) => cycle.cycleNumber)
    .filter((cycleNumber) => Number.isInteger(cycleNumber) && cycleNumber > 0);

  return Math.max(0, ...cycleNumbers) + 1;
}
