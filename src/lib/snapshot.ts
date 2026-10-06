/**
 * Showcase mode, build time: capture the programme and the seat maps from the
 * backend, so the published site can run without it (see src/lib/showcase.ts).
 *
 * Hall layouts are stored once; each showtime only keeps the seats that were
 * taken, which is enough to rebuild the exact seat map response.
 */
import { all, catalog, get } from "./catalog";
import { dayKey } from "./format";
import type { SeatMap, Showtime, Snapshot } from "./types";

/** Same window as the backend's SCHEDULE_DAYS */
const SCHEDULE_DAYS = 14;
const CONCURRENCY = 8;

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

let cache: Promise<Snapshot> | undefined;

export function snapshot(): Promise<Snapshot> {
  cache ??= (async () => {
    const { venue, seatTypes, ticketTypes } = await catalog();
    const takenOn = dayKey(new Date(), venue.timezone);
    // Count calendar days from noon UTC, so daylight saving changes never skip or repeat a day
    const first = new Date(`${takenOn}T12:00:00Z`).getTime();
    const days = Array.from({ length: SCHEDULE_DAYS }, (_, i) => new Date(first + i * 86_400_000).toISOString().slice(0, 10));
    // Every showtime of each day, including the ones that already started today
    const showtimes = (await mapLimited(days, (day) => all<Showtime>(`/showtimes/?date=${day}`))).flat();
    const maps = await mapLimited(showtimes, (s) => get<SeatMap>(`/showtimes/${s.id}/seats/`));

    const halls: Snapshot["halls"] = {};
    for (const map of maps) {
      halls[map.showtime.hall] ??= {
        rows: map.rows,
        seats_per_row: map.seats_per_row,
        seats: map.seats.map((seat) => [seat.id, seat.row, seat.number, seat.label, seat.type]),
      };
    }
    return {
      taken_on: takenOn,
      timezone: venue.timezone,
      currency: venue.currency,
      ticket_types: maps[0]?.ticket_types ?? ticketTypes,
      seat_types: Object.fromEntries(seatTypes.map((t) => [t.code, t.surcharge])),
      halls,
      showtimes: maps.map((map) => ({
        ...map.showtime,
        taken: Object.fromEntries(
          map.seats.flatMap((seat) => (seat.status === "available" ? [] : [[seat.id, seat.status] as const])),
        ),
      })),
    };
  })();
  return cache;
}
