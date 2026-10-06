/**
 * Browser-side API client: live showtimes, seat maps, accounts and bookings.
 *
 * Tokens are kept in localStorage for simplicity. For production, consider
 * moving the refresh token to an httpOnly cookie set by the backend.
 *
 * Built with PUBLIC_SHOWCASE=true, requests go to an in-browser stand-in for the
 * backend instead (src/lib/showcase.ts), so the static demo works on its own.
 */
import type { Booking, Paginated, SeatMap, Showtime } from "./types";

const SHOWCASE = import.meta.env.PUBLIC_SHOWCASE === "true";
// The showcase never calls the backend, so its address stays out of that build
export const API_URL = SHOWCASE ? "" : (import.meta.env.PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/$/, "");
const STORAGE_KEY = "cinema.auth";

interface Tokens {
  access: string;
  refresh: string;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(ApiError.describe(data) || `Request failed (${status}).`);
  }

  /** Turn DRF error payloads into one readable sentence. */
  static describe(data: Record<string, unknown>): string {
    if (typeof data.detail === "string") return data.detail;
    return Object.values(data)
      .flat()
      .filter((v) => typeof v === "string")
      .join(" ");
  }
}

function readTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeTokens(tokens: Tokens | null) {
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode: the session lasts as long as the page
  }
  window.dispatchEvent(new CustomEvent("auth-change"));
}

export function isSignedIn(): boolean {
  return readTokens() !== null;
}

interface Reply {
  status: number;
  data: Record<string, unknown>;
}

/** One round trip to the backend, or to its in-browser stand-in in showcase mode. */
async function send(path: string, method: string, body: unknown, access: string | null): Promise<Reply> {
  if (SHOWCASE) {
    // Loaded on demand, and left out of normal builds entirely
    const { handle } = await import("./showcase");
    return (await handle(method, path, body, access)) as Reply;
  } else {
    const res = await fetch(path.startsWith("http") ? path : `${API_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(access && { Authorization: `Bearer ${access}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: res.status === 204 ? {} : await res.json().catch(() => ({})) };
  }
}

async function refreshAccess(tokens: Tokens): Promise<Tokens | null> {
  const res = await send("/auth/token/refresh/", "POST", { refresh: tokens.refresh }, null);
  if (res.status !== 200) return null;
  const next = { ...tokens, ...res.data } as Tokens;
  writeTokens(next);
  return next;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const method = options.method ?? "GET";
  let tokens = options.auth ? readTokens() : null;
  let res = await send(path, method, options.body, tokens?.access ?? null);
  if (res.status === 401 && tokens) {
    tokens = await refreshAccess(tokens);
    if (!tokens) writeTokens(null);
    else res = await send(path, method, options.body, tokens.access);
  }
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, res.data);
  return res.data as T;
}

// Accounts

export async function signIn(email: string, password: string) {
  writeTokens(await api<Tokens>("/auth/token/", { method: "POST", body: { email, password } }));
}

export async function register(fields: { email: string; password: string; first_name: string; last_name: string }) {
  const { access, refresh } = await api<Tokens & { user: User }>("/auth/register/", { method: "POST", body: fields });
  writeTokens({ access, refresh });
}

export function signOut() {
  writeTokens(null);
}

export const me = () => api<User>("/auth/me/", { auth: true });

// Programme

export const showtimesOn = (day: string) => api<Paginated<Showtime>>(`/showtimes/?date=${day}`).then((p) => p.results);

export const showtimesFor = (movie: string) =>
  api<Paginated<Showtime>>(`/showtimes/?movie=${encodeURIComponent(movie)}`).then((p) => p.results);

export const seatMap = (showtime: number) => api<SeatMap>(`/showtimes/${showtime}/seats/`);

// Bookings and payments

export const createBooking = (showtime: number, seats: { seat: number; ticket_type: string }[]) =>
  api<Booking>("/bookings/", { method: "POST", body: { showtime, seats }, auth: true });

export const getBooking = (id: number) => api<Booking>(`/bookings/${id}/`, { auth: true });

export const myBookings = () => api<Paginated<Booking>>("/bookings/", { auth: true }).then((p) => p.results);

export const cancelBooking = (id: number) => api<Booking>(`/bookings/${id}/cancel/`, { method: "POST", auth: true });

export interface Checkout {
  payment_id: number;
  provider: "fake" | "stripe";
  amount: string;
  currency: string;
  client_secret: string;
  publishable_key?: string;
}

export const checkout = (booking: number) => api<Checkout>(`/bookings/${booking}/checkout/`, { method: "POST", auth: true });

export const completeFakePayment = (payment_id: number, outcome: "succeeded" | "failed") =>
  api<{ payment_status: string; booking_status: string }>("/payments/fake/complete/", {
    method: "POST",
    body: { payment_id, outcome },
    auth: true,
  });
