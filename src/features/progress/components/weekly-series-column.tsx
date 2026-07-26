import { formatWeeklyComparisonDate } from "@/features/progress/weekly-comparison-date";
import type { WeeklyExerciseComparisonModel } from "@/lib/progress/weekly-exercise-comparison";
import { formatKg } from "@/lib/progress/weight-format";

export interface WeeklySeriesColumnProps {
  title: string;
  record: WeeklyExerciseComparisonModel["resultComparison"]["baseline"];
}

export function WeeklySeriesColumn({ title, record }: WeeklySeriesColumnProps) {
  if (!record) {
    return (
      <div className="weekly-series-column">
        <span>{title}</span>
        <div className="weekly-comparison-empty compact">Sin registro real.</div>
      </div>
    );
  }

  return (
    <div className="weekly-series-column">
      <span>{title}</span>
      <small>{formatWeeklyComparisonDate(record.date)}</small>
      {record.reps.map((reps, index) => (
        <div className="weekly-series-pill" key={`${record.entryId}-${index}`}>
          <span>S{index + 1}:</span>
          <strong>{formatKg(record.weight)} · {reps} reps</strong>
        </div>
      ))}
    </div>
  );
}
