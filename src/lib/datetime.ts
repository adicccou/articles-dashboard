const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function coerceDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDisplayTime(value: string | Date | null | undefined): string {
  const date = coerceDate(value);
  if (!date) return "";

  let hour = date.getHours();
  const minute = date.getMinutes().toString().padStart(2, "0");
  const meridiem = hour >= 12 ? "pm" : "am";
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute}${meridiem}`;
}

export function formatDisplayDateTime(value: string | Date | null | undefined): string {
  const date = coerceDate(value);
  if (!date) return "";
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}, ${formatDisplayTime(date)}`;
}

export function formatDisplayDate(value: string | Date | null | undefined, includeYear = true): string {
  const date = coerceDate(value);
  if (!date) return "";
  const base = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return includeYear ? `${base}, ${date.getFullYear()}` : base;
}

export function formatMonthYear(value: Date): string {
  return `${MONTHS_LONG[value.getMonth()]} ${value.getFullYear()}`;
}

export function formatWeekdayShort(value: Date): string {
  return value.toLocaleString("en-US", { weekday: "short" });
}

export function formatMonthDay(value: Date): string {
  return `${MONTHS_SHORT[value.getMonth()]} ${value.getDate()}`;
}

export function formatWeekRange(first: Date, last: Date): string {
  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  if (sameMonth) {
    return `${formatMonthDay(first)} - ${last.getDate()}, ${last.getFullYear()}`;
  }
  return `${formatMonthDay(first)} - ${formatMonthDay(last)}, ${last.getFullYear()}`;
}
