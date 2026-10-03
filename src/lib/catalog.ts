/**
 * Build-time data. Pages that rarely change (films, venue, prices) are
 * rendered once from the API; showtimes and seats are fetched live in the
 * browser instead (see src/lib/client.ts).
 */
import type { Genre, Hall, Movie, Paginated, SeatType, TicketType, Venue } from "./types";

export const API_URL = (import.meta.env.PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/$/, "");

async function get<T>(path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}. Is the backend running?`);
  return res.json() as Promise<T>;
}

async function all<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | null = path;
  while (next) {
    const page: Paginated<T> = await get<Paginated<T>>(next);
    items.push(...page.results);
    next = page.next;
  }
  return items;
}

// Cached per build, so every page shares one round of requests
let cache: Promise<Catalog> | undefined;

export interface Catalog {
  venue: Venue;
  movies: Movie[];
  genres: Genre[];
  halls: Hall[];
  seatTypes: SeatType[];
  ticketTypes: TicketType[];
}

export function catalog(): Promise<Catalog> {
  cache ??= (async () => {
    const [venue, showing, soon, genres, halls, seatTypes, ticketTypes] = await Promise.all([
      get<Venue>("/venue/"),
      all<Movie>("/movies/?status=now_showing"),
      all<Movie>("/movies/?status=coming_soon"),
      get<Genre[]>("/genres/"),
      get<Hall[]>("/halls/"),
      get<SeatType[]>("/seat-types/"),
      get<TicketType[]>("/ticket-types/"),
    ]);
    soon.sort((a, b) => (a.release_date ?? "").localeCompare(b.release_date ?? ""));
    const names = Object.fromEntries(genres.map((g) => [g.slug, g.name]));
    const movies = [...showing, ...soon].map((m) => ({ ...m, genre_names: m.genres.map((g) => names[g] ?? g) }));
    return { venue, movies, genres, halls, seatTypes, ticketTypes };
  })();
  return cache;
}
