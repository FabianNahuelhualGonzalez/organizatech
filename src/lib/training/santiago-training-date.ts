const SANTIAGO_TIME_ZONE = "America/Santiago";

export function normalizeEntryDateKey(value: string) {
  return value.slice(0, 10);
}

export function getSantiagoDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SANTIAGO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
