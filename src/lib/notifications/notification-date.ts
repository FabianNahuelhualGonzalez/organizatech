const spanishMonthLabels = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const dayInMs = 24 * 60 * 60 * 1000;

export function formatNotificationDate(dateIso: string | null | undefined, now = new Date()): string {
  const date = parseNotificationDate(dateIso);
  const reference = Number.isNaN(now.getTime()) ? new Date() : now;
  if (!date) return "Hoy";

  const dateDay = startOfLocalDay(date).getTime();
  const today = startOfLocalDay(reference).getTime();
  const differenceInDays = Math.round((today - dateDay) / dayInMs);

  if (differenceInDays === 0) return "Hoy";
  if (differenceInDays === 1) return "Ayer";

  const day = date.getDate();
  const month = spanishMonthLabels[date.getMonth()] ?? "";
  if (date.getFullYear() === reference.getFullYear()) return `${day} de ${month}`;
  return `${day} de ${month} ${date.getFullYear()}`;
}

function parseNotificationDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
