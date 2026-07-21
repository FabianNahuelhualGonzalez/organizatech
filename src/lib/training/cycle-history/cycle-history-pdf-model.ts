import { buildCycleHistoryPdfFilename } from "@/lib/training/cycle-history/cycle-history-filename";
import { buildCycleHistoryMetricsSummary, describeCycleHistoryVolumeProgress } from "@/lib/training/cycle-history/cycle-history-metrics";
import { paginateCycleHistoryWeeks } from "@/lib/training/cycle-history/cycle-history-pagination";
import type {
  CycleHistoryBreakdown,
  CycleHistoryCycleMetadata,
  CycleHistoryExerciseBreakdown,
  CycleHistoryMetricsSummary,
  CycleHistoryPersonalData,
} from "@/lib/training/cycle-history/cycle-history-types";

export interface CycleHistoryPdfPersonalDataSection {
  fullName: string | null;
  email: string | null;
  birthDate: string | null;
  age: number | null;
  gender: string | null;
  phoneNumber: string | null;
}

export interface CycleHistoryPdfCycleSection {
  cycleId: string;
  name: string;
  cycleNumber: number;
  cycleType: string | null;
  status: CycleHistoryCycleMetadata["status"];
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  durationWeeks: number | null;
  weeksWithDataCount: number;
}

export interface CycleHistoryPdfMetricsSection extends CycleHistoryMetricsSummary {
  volumeProgressText: string;
}

export interface CycleHistoryPdfRoutineSection {
  routineId: string;
  routineName: string;
  exercises: CycleHistoryExerciseBreakdown[];
  weekBlocks: number[][];
}

export interface CycleHistoryPdfModel {
  generatedAt: string;
  filename: string;
  personalData: CycleHistoryPdfPersonalDataSection;
  cycle: CycleHistoryPdfCycleSection;
  metrics: CycleHistoryPdfMetricsSection;
  routines: CycleHistoryPdfRoutineSection[];
}

export function calculateAgeAtDate(birthDate: string | null, referenceDate: string): number | null {
  const birth = parseDateKey(birthDate);
  const reference = parseDateKey(referenceDate);
  if (!birth || !reference) return null;

  let age = reference.year - birth.year;
  if (reference.month < birth.month || (reference.month === birth.month && reference.day < birth.day)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function buildCycleHistoryPdfModel(input: {
  cycle: CycleHistoryCycleMetadata;
  breakdown: CycleHistoryBreakdown;
  personalData: CycleHistoryPersonalData;
  generatedAt: string;
  weeksPerBlock?: number;
}): CycleHistoryPdfModel {
  const metricsSummary = buildCycleHistoryMetricsSummary(input.breakdown);
  const fullName = joinNameParts(input.personalData.firstName, input.personalData.lastName);

  const routines: CycleHistoryPdfRoutineSection[] = input.breakdown.routines.map((routine) => {
    const routineWeeks = new Set<number>();
    for (const exercise of routine.exercises) {
      for (const week of Object.keys(exercise.weeks)) {
        routineWeeks.add(Number(week));
      }
    }

    return {
      routineId: routine.routineId,
      routineName: routine.routineName,
      exercises: routine.exercises,
      weekBlocks: paginateCycleHistoryWeeks(Array.from(routineWeeks), input.weeksPerBlock),
    };
  });

  return {
    generatedAt: input.generatedAt,
    filename: buildCycleHistoryPdfFilename({ cycleNumber: input.cycle.cycleNumber, generatedAt: input.generatedAt }),
    personalData: {
      fullName,
      email: input.personalData.email,
      birthDate: input.personalData.birthDate,
      age: calculateAgeAtDate(input.personalData.birthDate, input.generatedAt),
      gender: input.personalData.gender,
      phoneNumber: input.personalData.phoneNumber,
    },
    cycle: {
      cycleId: input.cycle.cycleId,
      name: input.cycle.name,
      cycleNumber: input.cycle.cycleNumber,
      cycleType: input.cycle.cycleType,
      status: input.cycle.status,
      plannedStartDate: input.cycle.plannedStartDate,
      plannedEndDate: input.cycle.plannedEndDate,
      durationWeeks: input.cycle.durationWeeks,
      weeksWithDataCount: input.breakdown.weeksWithData.length,
    },
    metrics: {
      ...metricsSummary,
      volumeProgressText: describeCycleHistoryVolumeProgress(metricsSummary.volumeProgress),
    },
    routines,
  };
}

function joinNameParts(firstName: string | null, lastName: string | null): string | null {
  const parts = [firstName, lastName].map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" ") : null;
}

function parseDateKey(value: string | null): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}
