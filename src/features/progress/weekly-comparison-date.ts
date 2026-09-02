const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatWeeklyComparisonDate(value: string) {
  const civilDate = CIVIL_DATE_PATTERN.exec(value);
  if (civilDate) {
    const [, year, month, day] = civilDate;
    return `${day}-${month}-${year}`;
  }

  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
