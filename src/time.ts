export type DatePrecision = "day" | "month" | "year";

export interface InferredDate {
  date: string;
  precision: DatePrecision;
}

export interface InferredDateRange {
  start: string;
  end: string;
}

export function normalizeDate(value: string): InferredDate | null {
  const trimmed = value.normalize("NFKC").trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][\s\S]*)?$/.exec(trimmed);
  if (day) return validDate(day[1]!, day[2]!, day[3]!, "day");
  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) return validDate(month[1]!, month[2]!, "01", "month");
  const year = /^(\d{4})$/.exec(trimmed);
  if (year) return validDate(year[1]!, "01", "01", "year");
  return null;
}

export function inferDate(values: Array<string | null | undefined>): InferredDate | null {
  for (const raw of values) {
    if (!raw) continue;
    const value = raw.normalize("NFKC");
    const patterns: Array<{ expression: RegExp; precision: DatePrecision }> = [
      { expression: /(?:^|\D)(20\d{2}|19\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?:\D|$)/, precision: "day" },
      { expression: /(?:^|\D)(20\d{2}|19\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月\s*(0?[1-9]|[12]\d|3[01])\s*日?/, precision: "day" },
      { expression: /(?:^|\D)(20\d{2}|19\d{2})[-/.](0?[1-9]|1[0-2])(?:\D|$)/, precision: "month" },
      { expression: /(?:^|\D)(20\d{2}|19\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月/, precision: "month" },
      { expression: /(?:^|\D)(20\d{2}|19\d{2})\s*年(?:\D|$)/, precision: "year" },
    ];
    for (const pattern of patterns) {
      const match = pattern.expression.exec(value);
      if (!match) continue;
      const inferred = validDate(match[1]!, match[2] ?? "01", match[3] ?? "01", pattern.precision);
      if (inferred) return inferred;
    }
  }
  return null;
}

export function inferDateRange(values: Array<string | null | undefined>): InferredDateRange | null {
  const dates = values.flatMap((value) => {
    if (!value) return [];
    return value.split(/\r?\n/).map((line) => inferDate([line])?.date).filter((date): date is string => Boolean(date));
  }).sort();
  if (dates.length === 0) return null;
  return { start: dates[0]!, end: dates[dates.length - 1]! };
}

export function periodBucket(date: string | null): string | null {
  return date;
}

function validDate(yearValue: string, monthValue: string, dayValue: string, precision: DatePrecision): InferredDate | null {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const normalizedYear = String(year).padStart(4, "0");
  const normalizedMonth = String(month).padStart(2, "0");
  const normalizedDay = String(day).padStart(2, "0");
  const normalized = precision === "year"
    ? normalizedYear
    : precision === "month"
      ? `${normalizedYear}-${normalizedMonth}`
      : `${normalizedYear}-${normalizedMonth}-${normalizedDay}`;
  return { date: normalized, precision };
}
