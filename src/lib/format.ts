/** Formatting shared by pages (build time) and scripts (browser). */

const LOCALE = "en-GB";

export function money(amount: string | number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(Number(amount));
}

export function runtime(minutes: number | null): string {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function time(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

export function longDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone }).format(
    new Date(iso),
  );
}

export function releaseDate(date: string | null): string {
  if (!date) return "";
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "YYYY-MM-DD" of a moment, in the venue's timezone. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}

/** Today and the next days, as day keys plus short labels for a date strip. */
export function upcomingDays(count: number, timeZone: string): { key: string; weekday: string; day: string }[] {
  // Count calendar days from noon UTC, so daylight saving changes never skip or repeat a day
  const today = new Date(`${dayKey(new Date(), timeZone)}T12:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(today + i * 86_400_000);
    const weekday =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" }).format(date);
    const day = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
    return { key: date.toISOString().slice(0, 10), weekday, day };
  });
}

const languageNames = new Intl.DisplayNames([LOCALE], { type: "language" });

export function language(code: string): string {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "English", or "Korean, English subtitles" for original versions. */
export function audio(lang: string, subtitles: string): string {
  return subtitles ? `${language(lang)}, ${language(subtitles)} subtitles` : language(lang);
}

export function list(items: string[]): string {
  return new Intl.ListFormat(LOCALE, { style: "long", type: "conjunction" }).format(items);
}
