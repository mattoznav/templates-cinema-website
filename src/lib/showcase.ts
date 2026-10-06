/**
 * Showcase mode: an in-browser stand-in for the cinema backend.
 *
 * The published demo is a static site, so there is no server to talk to.
 * `api()` in client.ts sends every request here instead, and this module
 * answers like the backend would: same paths, same response shapes, same
 * errors and the same booking rules (see the backend's apps/bookings/services.py,
 * apps/payments/services.py and config/settings.py).
 *
 * - The programme and seat maps come from a snapshot taken at build time
 *   (src/lib/snapshot.ts). Dates are moved forward by whole days so the
 *   snapshot always starts today, keeping each show's local time.
 * - Accounts, bookings, payments and tickets live in this browser only
 *   (localStorage, or memory when storage is unavailable).
 * - Passwords are stored as salted SHA-256 hashes. That is enough for a demo
 *   that never leaves the browser, not for a real user database.
 * - Payments always use the fake provider: no money moves.
 *
 * This file is only loaded when the site is built with PUBLIC_SHOWCASE=true.
 */
import { withBase } from "./paths";
import type { Showtime, Snapshot } from "./types";

// Same values as the backend settings
const BOOKING_HOLD_MINUTES = 10;
const BOOKING_MAX_SEATS = 10;
const CANCELLATION_CUTOFF_HOURS = 2;
const SCHEDULE_DAYS = 14;
const PAGE_SIZE = 50;
const ACCESS_TOKEN_MINUTES = 30;
const REFRESH_TOKEN_DAYS = 14;
// No 0/O or 1/I: references are read out loud at the box office
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const STORE_KEY = "cinema.showcase";
const MINUTE = 60_000;
const DAY = 86_400_000;

export interface Reply {
  status: number;
  data: unknown;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(String(status));
  }
}

const notFound = (model: string) => new HttpError(404, { detail: `No ${model} matches the given query.` });

// Stored state

interface StoredUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  salt: string;
  hash: string;
}

interface StoredSeat {
  seat_id: number;
  seat: string;
  row: string;
  number: number;
  seat_type: string;
  ticket_type: string;
  price: string;
  active: boolean;
  ticket: { code: string; checked_in_at: string | null } | null;
}

interface StoredBooking {
  id: number;
  reference: string;
  user: number;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  /** The show as it was when booked, so the booking keeps its date whatever the snapshot does later */
  showtime: {
    id: number;
    starts_at: string;
    movie: { slug: string; title: string };
    hall: { id: number; name: string; format: string };
  };
  seats: StoredSeat[];
  total: string;
  currency: string;
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

interface StoredPayment {
  id: number;
  booking: number;
  status: "pending" | "succeeded" | "failed" | "cancelled" | "refunded";
  amount: string;
  currency: string;
  provider_ref: string;
}

interface State {
  version: 1;
  next: { user: number; booking: number; payment: number };
  users: StoredUser[];
  /** token -> owner and expiry */
  tokens: Record<string, { user: number; kind: "access" | "refresh"; expires: number }>;
  bookings: StoredBooking[];
  payments: StoredPayment[];
}

let memory: State | null = null;

function fresh(): State {
  return { version: 1, next: { user: 1, booking: 1, payment: 1 }, users: [], tokens: {}, bookings: [], payments: [] };
}

function load(): State {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (stored?.version === 1) return stored as State;
  } catch {
    // Storage blocked or unreadable: fall back to memory
  }
  return memory ?? fresh();
}

function save(state: State) {
  memory = state;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the data lasts as long as the page
  }
}

// Random values and hashing

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newReference(): string {
  const values = crypto.getRandomValues(new Uint8Array(8));
  return [...values].map((b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Dates in the venue's timezone

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(ms: number, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Milliseconds to add to UTC to get the local time at that moment */
function utcOffset(ms: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

/** The moment a local date and time happens in the timezone */
function fromWallClock(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - utcOffset(guess, timeZone);
  const second_ = guess - utcOffset(first, timeZone);
  return utcOffset(first, timeZone) === utcOffset(second_, timeZone) ? second_ : first;
}

const pad = (n: number, size = 2) => String(n).padStart(size, "0");

/** ISO 8601 in the venue's timezone, as the backend writes dates */
function iso(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  const offset = Math.round(utcOffset(ms, timeZone) / MINUTE);
  const fraction = ms % 1000 ? `.${pad(ms % 1000, 3)}000` : "";
  const zone = offset === 0 ? "Z" : `${offset > 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${fraction}${zone}`;
}

function dayKey(ms: number, timeZone: string): string {
  const w = wallClock(ms, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Same local time, a whole number of days later */
function addDays(ms: number, days: number, timeZone: string): number {
  const w = wallClock(ms, timeZone);
  const date = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return fromWallClock(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), w.hour, w.minute, w.second, timeZone);
}

// The snapshot, moved to today

let snapshotRequest: Promise<Snapshot> | undefined;

function fetchSnapshot(): Promise<Snapshot> {
  snapshotRequest ??= fetch(withBase("/showcase/snapshot.json")).then((res) => {
    if (!res.ok) throw new Error(`The showcase data could not be loaded (${res.status}).`);
    return res.json() as Promise<Snapshot>;
  });
  // Let a later request try again after a network error
  snapshotRequest.catch(() => (snapshotRequest = undefined));
  return snapshotRequest;
}

type Show = Omit<Showtime, "is_bookable"> & { start: number; taken: Snapshot["showtimes"][number]["taken"] };

let shiftedFor: { days: number; shows: Show[] } | undefined;

/** The snapshot's showtimes, moved so the day it was taken becomes today */
function shows(snap: Snapshot): Show[] {
  const tz = snap.timezone;
  const days = Math.round((Date.parse(`${dayKey(Date.now(), tz)}T00:00:00Z`) - Date.parse(`${snap.taken_on}T00:00:00Z`)) / DAY);
  if (shiftedFor?.days !== days) {
    const list = snap.showtimes.map(({ is_bookable: _, ...s }) => {
      const start = addDays(Date.parse(s.starts_at), days, tz);
      const end = start + (Date.parse(s.ends_at) - Date.parse(s.starts_at));
      return { ...s, start, starts_at: iso(start, tz), ends_at: iso(end, tz) };
    });
    shiftedFor = { days, shows: list };
  }
  return shiftedFor.shows;
}

const showtimeJson = ({ start, taken: _, ...s }: Show): Showtime => ({ ...s, is_bookable: start > Date.now() });
const start_ = (s: { starts_at: string }) => Date.parse(s.starts_at);

/** A booking belongs to a show when both the id and the date match */
const sameShow = (b: StoredBooking, s: Show) => b.showtime.id === s.id && start_(b.showtime) === s.start;

// Money: work in cents, write like a Decimal with two places

const cents = (value: string | number) => Math.round(Number(value) * 100);
const decimal = (value: number) => (value / 100).toFixed(2);

// Booking rules

function releaseExpired(state: State) {
  const now = Date.now();
  for (const b of state.bookings) {
    if (b.status === "pending" && Date.parse(b.expires_at) <= now) {
      b.status = "expired";
      for (const seat of b.seats) seat.active = false;
    }
  }
}

/** Seat id -> "held" or "sold" for every seat that cannot be picked, leaving out the `except` bookings */
function takenSeats(state: State, show: Show, except: StoredBooking[] = []): Map<number, "held" | "sold"> {
  const taken = new Map(Object.entries(show.taken).map(([id, status]) => [Number(id), status]));
  for (const b of state.bookings) {
    if (!sameShow(b, show) || except.includes(b)) continue;
    for (const seat of b.seats) if (seat.active) taken.set(seat.seat_id, b.status === "confirmed" ? "sold" : "held");
  }
  return taken;
}

function closeBooking(b: StoredBooking, status: StoredBooking["status"], tz: string) {
  for (const seat of b.seats) seat.active = false;
  b.status = status;
  b.cancelled_at = iso(Date.now(), tz);
}

function canCancel(b: StoredBooking): boolean {
  if (b.status === "pending") return true;
  return b.status === "confirmed" && Date.now() < start_(b.showtime) - CANCELLATION_CUTOFF_HOURS * 3_600_000;
}

function bookingJson(b: StoredBooking) {
  const seats = [...b.seats].sort((x, y) => x.row.localeCompare(y.row) || x.number - y.number);
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    showtime: b.showtime,
    seats: seats.map((s) => ({ seat: s.seat, seat_type: s.seat_type, ticket_type: s.ticket_type, price: s.price, ticket: s.ticket })),
    total: b.total,
    currency: b.currency,
    expires_at: b.expires_at,
    created_at: b.created_at,
    confirmed_at: b.confirmed_at,
    cancelled_at: b.cancelled_at,
    can_cancel: canCancel(b),
    customer: null,
    payments: null,
  };
}

/** Mark a paid booking as confirmed and issue its tickets. False when the seats are gone. */
function confirm(state: State, snap: Snapshot, b: StoredBooking): boolean {
  if (b.status === "confirmed") return true;
  if (b.status !== "pending" && b.status !== "expired") return false;
  if (b.status === "expired") {
    // Paid after the deadline: keep the booking only if the seats are still free
    const show = shows(snap).find((s) => sameShow(b, s));
    const taken = show ? takenSeats(state, show) : new Map();
    if (b.seats.some((s) => taken.has(s.seat_id))) return false;
    for (const s of b.seats) s.active = true;
  }
  b.status = "confirmed";
  b.confirmed_at = iso(Date.now(), snap.timezone);
  for (const s of b.seats) if (s.active) s.ticket = { code: randomHex(16), checked_in_at: null };
  return true;
}

// Accounts

function userJson(u: StoredUser) {
  return { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name, is_staff: false };
}

function issueToken(state: State, user: number, kind: "access" | "refresh"): string {
  const now = Date.now();
  for (const [token, t] of Object.entries(state.tokens)) if (t.expires <= now) delete state.tokens[token];
  const token = randomHex(32);
  state.tokens[token] = { user, kind, expires: now + (kind === "access" ? ACCESS_TOKEN_MINUTES * MINUTE : REFRESH_TOKEN_DAYS * DAY) };
  return token;
}

function authenticate(state: State, token: string | null): StoredUser | null {
  if (!token) return null;
  const t = state.tokens[token];
  const user = t && t.kind === "access" && t.expires > Date.now() ? state.users.find((u) => u.id === t.user) : undefined;
  if (!user) {
    throw new HttpError(401, {
      detail: "Given token not valid for any token type",
      code: "token_not_valid",
      messages: [{ token_class: "AccessToken", token_type: "access", message: "Token is invalid" }],
    });
  }
  return user;
}

function signedIn(user: StoredUser | null): StoredUser {
  if (!user) throw new HttpError(401, { detail: "Authentication credentials were not provided." });
  return user;
}

/** Django's email normalisation: the domain is case-insensitive */
function normalizeEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? email : email.slice(0, at) + email.slice(at).toLowerCase();
}

// A short list standing in for Django's 20,000 common passwords
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop",
  "iloveyou", "sunshine", "princess", "football", "baseball", "welcome1", "admin123", "letmein1", "abc12345",
  "11111111", "00000000", "passw0rd", "trustno1", "superman", "starwars", "whatever", "computer",
]);

/** Multiset overlap ratio, like difflib.SequenceMatcher.quick_ratio() */
function quickRatio(a: string, b: string): number {
  const counts = new Map<string, number>();
  for (const ch of b) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let matches = 0;
  for (const ch of a) {
    const n = counts.get(ch) ?? 0;
    if (n > 0) {
      matches++;
      counts.set(ch, n - 1);
    }
  }
  return a.length + b.length ? (2 * matches) / (a.length + b.length) : 1;
}

/** Django's default password validators, in the same order and wording */
function passwordProblems(password: string, email: string): string[] {
  const problems: string[] = [];
  const lower = password.toLowerCase();
  const maxSimilarity = 0.7;
  const parts = [...email.toLowerCase().split(/\W+/), email.toLowerCase()];
  const similar = parts.some((part) => {
    const tooShort = lower.length >= 10 * part.length && part.length < (maxSimilarity / 2) * lower.length;
    return !tooShort && quickRatio(lower, part) >= maxSimilarity;
  });
  if (similar) problems.push("The password is too similar to the email address.");
  if (password.length < 8) problems.push("This password is too short. It must contain at least 8 characters.");
  if (COMMON_PASSWORDS.has(lower.trim())) problems.push("This password is too common.");
  if (/^\d+$/.test(password)) problems.push("This password is entirely numeric.");
  return problems;
}

type Body = Record<string, unknown>;

function text(body: Body, field: string, errors: Record<string, string[]>, { optional = false, max = 0, trim = true } = {}): string {
  const value = body[field];
  if (value === undefined) {
    if (!optional) errors[field] = ["This field is required."];
    return "";
  }
  if (value === null) {
    errors[field] = ["This field may not be null."];
    return "";
  }
  if (typeof value === "object") {
    errors[field] = ["Not a valid string."];
    return "";
  }
  const s = trim ? String(value).trim() : String(value);
  if (!s && !optional) errors[field] = ["This field may not be blank."];
  else if (max && s.length > max) errors[field] = [`Ensure this field has no more than ${max} characters.`];
  return s;
}

async function register(state: State, body: Body): Promise<Reply> {
  const errors: Record<string, string[]> = {};
  let email = text(body, "email", errors, { max: 254 });
  const password = text(body, "password", errors);
  const first_name = text(body, "first_name", errors, { optional: true, max: 150 });
  const last_name = text(body, "last_name", errors, { optional: true, max: 150 });
  if (email && !errors.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = ["Enter a valid email address."];
    else if (state.users.some((u) => u.email === normalizeEmail(email))) errors.email = ["user with this email already exists."];
  }
  if (Object.keys(errors).length) throw new HttpError(400, errors);
  const problems = passwordProblems(password, email);
  if (problems.length) throw new HttpError(400, { non_field_errors: problems });

  email = normalizeEmail(email);
  const salt = randomHex(16);
  const user: StoredUser = { id: state.next.user++, email, first_name, last_name, salt, hash: await hashPassword(password, salt) };
  state.users.push(user);
  const refresh = issueToken(state, user.id, "refresh");
  return { status: 201, data: { user: userJson(user), access: issueToken(state, user.id, "access"), refresh } };
}

async function obtainToken(state: State, body: Body): Promise<Reply> {
  const errors: Record<string, string[]> = {};
  const email = text(body, "email", errors);
  const password = text(body, "password", errors, { trim: false });
  if (Object.keys(errors).length) throw new HttpError(400, errors);
  const user = state.users.find((u) => u.email === email);
  if (!user || (await hashPassword(password, user.salt)) !== user.hash) {
    throw new HttpError(401, { detail: "No active account found with the given credentials" });
  }
  return { status: 200, data: { refresh: issueToken(state, user.id, "refresh"), access: issueToken(state, user.id, "access") } };
}

function refreshToken(state: State, body: Body): Reply {
  const errors: Record<string, string[]> = {};
  const refresh = text(body, "refresh", errors);
  if (Object.keys(errors).length) throw new HttpError(400, errors);
  const t = state.tokens[refresh];
  if (!t || t.kind !== "refresh") throw new HttpError(401, { detail: "Token is invalid", code: "token_not_valid" });
  if (t.expires <= Date.now()) throw new HttpError(401, { detail: "Token is expired", code: "token_not_valid" });
  return { status: 200, data: { access: issueToken(state, t.user, "access") } };
}

// Programme

function paginate<T>(items: T[], path: string, params: URLSearchParams) {
  const page = Number(params.get("page") ?? 1);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new HttpError(404, { detail: "Invalid page." });
  const link = (n: number) => {
    const next = new URLSearchParams(params);
    if (n === 1) next.delete("page");
    else next.set("page", String(n));
    const query = next.toString();
    return `${path}${query ? `?${query}` : ""}`;
  };
  return {
    count: items.length,
    next: page < pages ? link(page + 1) : null,
    previous: page > 1 ? link(page - 1) : null,
    results: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

function listShowtimes(snap: Snapshot, params: URLSearchParams, path: string) {
  const tz = snap.timezone;
  let list = shows(snap);
  const day = params.get("date");
  if (day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    const valid = match && dayKey(Date.UTC(+match[1], +match[2] - 1, +match[3], 12), "UTC") === day;
    if (!valid) throw new HttpError(400, { date: "Use the YYYY-MM-DD format." });
    const from = fromWallClock(+match[1], +match[2], +match[3], 0, 0, 0, tz);
    list = list.filter((s) => s.start >= from && s.start < from + DAY);
  } else {
    const now = Date.now();
    list = list.filter((s) => s.start >= now && s.start < now + SCHEDULE_DAYS * DAY);
  }
  const movie = params.get("movie");
  if (movie) list = list.filter((s) => s.movie === movie);
  const hall = params.get("hall");
  if (hall) list = list.filter((s) => String(s.hall) === hall);
  list = [...list].sort((a, b) => a.start - b.start || a.hall - b.hall);
  return paginate(list.map(showtimeJson), path, params);
}

function findShow(snap: Snapshot, id: string): Show {
  const show = /^\d+$/.test(id) ? shows(snap).find((s) => s.id === Number(id)) : undefined;
  if (!show) throw notFound("Showtime");
  return show;
}

function seatMap(state: State, snap: Snapshot, show: Show) {
  releaseExpired(state);
  const hall = snap.halls[show.hall];
  const taken = takenSeats(state, show);
  return {
    showtime: showtimeJson(show),
    rows: hall.rows,
    seats_per_row: hall.seats_per_row,
    ticket_types: snap.ticket_types,
    seats: hall.seats.map(([id, row, number, label, type]) => ({
      id,
      row,
      number,
      label,
      type,
      price: (cents(show.price) + cents(snap.seat_types[type] ?? 0)) / 100,
      status: taken.get(id) ?? "available",
    })),
  };
}

// Bookings

function holdSeats(state: State, snap: Snapshot, user: StoredUser, body: Body): Reply {
  // Field validation, as the serializer does it
  const errors: Record<string, unknown> = {};
  const raw = body.showtime;
  let show: Show | undefined;
  if (raw === undefined) errors.showtime = ["This field is required."];
  else if (raw === null) errors.showtime = ["This field may not be null."];
  else if (typeof raw === "object" || typeof raw === "boolean") errors.showtime = [`Incorrect type. Expected pk value, received ${Array.isArray(raw) ? "list" : typeof raw === "boolean" ? "bool" : "dict"}.`];
  else {
    show = shows(snap).find((s) => String(s.id) === String(raw).trim());
    if (!show) errors.showtime = [`Invalid pk "${raw}" - object does not exist.`];
  }
  const picks = body.seats;
  if (picks === undefined) errors.seats = ["This field is required."];
  else if (!Array.isArray(picks)) errors.seats = { non_field_errors: [`Expected a list of items but got type "${picks === null ? "NoneType" : typeof picks === "object" ? "dict" : typeof picks}".`] };
  else {
    const itemErrors = picks.map((p) => {
      if (typeof p !== "object" || p === null || Array.isArray(p)) return { non_field_errors: ["Invalid data. Expected a dictionary, but got " + (Array.isArray(p) ? "list" : typeof p) + "."] };
      const e: Record<string, string[]> = {};
      if (p.seat === undefined) e.seat = ["This field is required."];
      else if (!Number.isInteger(Number(p.seat)) || p.seat === null || p.seat === "") e.seat = ["A valid integer is required."];
      if (p.ticket_type !== undefined && !/^[-a-zA-Z0-9_]+$/.test(String(p.ticket_type))) {
        e.ticket_type = ['Enter a valid "slug" consisting of letters, numbers, underscores or hyphens.'];
      }
      return e;
    });
    if (itemErrors.some((e) => Object.keys(e).length)) errors.seats = itemErrors;
  }
  if (Object.keys(errors).length || !show || !Array.isArray(picks)) throw new HttpError(400, errors);

  const hall = Object.entries(snap.halls);
  const seatsById = new Map<number, { hall: number; row: string; number: number; label: string; type: string }>();
  for (const [hallId, h] of hall) for (const [id, row, number, label, type] of h.seats) seatsById.set(id, { hall: Number(hallId), row, number, label, type });
  const requests = picks.map((p: { seat: unknown; ticket_type?: unknown }) => {
    const id = Number(p.seat);
    const seat = seatsById.get(id);
    if (!seat) throw new HttpError(400, { seats: [`Seat ${id} does not exist.`] });
    const code = String(p.ticket_type ?? "adult");
    const ticketType = snap.ticket_types.find((t) => t.code === code);
    if (!ticketType) throw new HttpError(400, { seats: [`Unknown ticket type '${code}'.`] });
    return { id, ...seat, ticketType };
  });

  // The booking rules
  const tz = snap.timezone;
  const now = Date.now();
  if (show.start <= now) throw new HttpError(400, { detail: "This showtime has already started." });
  if (!requests.length) throw new HttpError(400, { detail: "Pick at least one seat." });
  if (requests.length > BOOKING_MAX_SEATS) throw new HttpError(400, { detail: `You can book up to ${BOOKING_MAX_SEATS} seats at a time.` });
  if (new Set(requests.map((r) => r.id)).size !== requests.length) throw new HttpError(400, { detail: "Each seat can only be picked once." });
  if (requests.some((r) => r.hall !== show.hall)) throw new HttpError(400, { detail: "Some seats are not in this showtime's hall." });

  releaseExpired(state);
  // Picking new seats for the same show replaces the previous unpaid selection
  const previous = state.bookings.filter((b) => b.user === user.id && b.status === "pending" && sameShow(b, show));
  const blocked = takenSeats(state, show, previous);
  if (requests.some((r) => blocked.has(r.id))) {
    // Nothing changes, so the previous selection still counts as taken in the answer
    const taken = takenSeats(state, show);
    throw new HttpError(409, {
      detail: `These seats are no longer available: ${requests.filter((r) => taken.has(r.id)).map((r) => r.label).join(", ")}.`,
      seats: requests.filter((r) => taken.has(r.id)).map((r) => r.label),
    });
  }
  for (const b of previous) closeBooking(b, "cancelled", tz);

  const seats: StoredSeat[] = requests.map((r) => ({
    seat_id: r.id,
    seat: r.label,
    row: r.row,
    number: r.number,
    seat_type: r.type,
    ticket_type: r.ticketType.code,
    price: decimal(Math.max(0, cents(show.price) + cents(snap.seat_types[r.type] ?? 0) + cents(r.ticketType.price_delta))),
    active: true,
    ticket: null,
  }));
  const booking: StoredBooking = {
    id: state.next.booking++,
    reference: newReference(),
    user: user.id,
    status: "pending",
    showtime: {
      id: show.id,
      starts_at: show.starts_at,
      movie: { slug: show.movie, title: show.movie_title },
      hall: { id: show.hall, name: show.hall_name, format: show.hall_format },
    },
    seats,
    total: decimal(seats.reduce((sum, s) => sum + cents(s.price), 0)),
    currency: snap.currency,
    expires_at: iso(now + BOOKING_HOLD_MINUTES * MINUTE, tz),
    created_at: iso(now, tz),
    confirmed_at: null,
    cancelled_at: null,
  };
  state.bookings.push(booking);
  return { status: 201, data: bookingJson(booking) };
}

function ownBooking(state: State, user: StoredUser, id: string): StoredBooking {
  const booking = /^\d+$/.test(id) ? state.bookings.find((b) => b.id === Number(id) && b.user === user.id) : undefined;
  if (!booking) throw notFound("Booking");
  return booking;
}

function cancel(state: State, snap: Snapshot, booking: StoredBooking): Reply {
  if (booking.status === "cancelled" || booking.status === "expired") throw new HttpError(400, { detail: "This booking is no longer active." });
  if (booking.status === "confirmed") {
    if (Date.now() > start_(booking.showtime) - CANCELLATION_CUTOFF_HOURS * 3_600_000) {
      throw new HttpError(400, { detail: `Bookings can be cancelled up to ${CANCELLATION_CUTOFF_HOURS} hours before the show.` });
    }
    if (booking.seats.some((s) => s.ticket?.checked_in_at)) throw new HttpError(400, { detail: "Tickets already used at the door cannot be cancelled." });
    // The fake provider refunds instantly
    for (const p of state.payments) if (p.booking === booking.id && p.status === "succeeded") p.status = "refunded";
  }
  closeBooking(booking, "cancelled", snap.timezone);
  return { status: 200, data: bookingJson(booking) };
}

// Payments, with the fake provider

function checkout(state: State, booking: StoredBooking): Reply {
  if (booking.status !== "pending" || Date.parse(booking.expires_at) <= Date.now()) {
    throw new HttpError(409, { detail: "This booking can no longer be paid. Pick your seats again." });
  }
  // A new attempt replaces any unfinished one
  for (const p of state.payments) if (p.booking === booking.id && p.status === "pending") p.status = "cancelled";
  const payment: StoredPayment = {
    id: state.next.payment++,
    booking: booking.id,
    status: "pending",
    amount: booking.total,
    currency: booking.currency,
    provider_ref: `fake_${randomHex(16)}`,
  };
  state.payments.push(payment);
  return {
    status: 201,
    data: {
      payment_id: payment.id,
      provider: "fake",
      amount: Number(payment.amount),
      currency: payment.currency,
      client_secret: `${payment.provider_ref}_secret`,
    },
  };
}

function completeFakePayment(state: State, snap: Snapshot, user: StoredUser, body: Body): Reply {
  const errors: Record<string, string[]> = {};
  const id = body.payment_id;
  if (id === undefined) errors.payment_id = ["This field is required."];
  else if (id === null || id === "" || !Number.isInteger(Number(id))) errors.payment_id = ["A valid integer is required."];
  const outcome = body.outcome ?? "succeeded";
  if (outcome !== "succeeded" && outcome !== "failed") errors.outcome = [`"${outcome}" is not a valid choice.`];
  if (Object.keys(errors).length) throw new HttpError(400, errors);

  const payment = state.payments.find((p) => p.id === Number(id) && state.bookings.find((b) => b.id === p.booking)?.user === user.id);
  if (!payment) throw notFound("Payment");
  const booking = state.bookings.find((b) => b.id === payment.booking)!;

  // Same steps as the backend's payments.services.handle_event
  if (payment.status !== "succeeded" && payment.status !== "refunded") {
    if (outcome === "failed") {
      if (payment.status === "pending") payment.status = "failed";
    } else {
      // Money was taken, even if this attempt had been replaced: honour it
      payment.status = "succeeded";
      const alreadyPaid = booking.status === "confirmed";
      // Paid twice, or paid too late for seats that are now gone: give it back
      if (alreadyPaid || !confirm(state, snap, booking)) payment.status = "refunded";
    }
  }
  return { status: 200, data: { payment_status: payment.status, booking_status: booking.status } };
}

// Routing

const methodNotAllowed = (method: string) => new HttpError(405, { detail: `Method "${method}" not allowed.` });

async function route(state: State, method: string, path: string, params: URLSearchParams, body: Body, token: string | null): Promise<Reply> {
  const parts = path.split("/").filter(Boolean);
  const is = (...pattern: string[]) => parts.length === pattern.length && pattern.every((p, i) => p === "*" || p === parts[i]);
  const only = (...methods: string[]) => {
    if (!methods.includes(method)) throw methodNotAllowed(method);
  };

  // Token views do not authenticate the request: a stale token must not block signing in
  if (is("auth", "token")) {
    only("POST");
    return obtainToken(state, body);
  }
  if (is("auth", "token", "refresh")) {
    only("POST");
    return refreshToken(state, body);
  }

  const user = authenticate(state, token);
  if (is("health")) return { status: 200, data: { status: "ok" } };
  if (is("auth", "register")) {
    only("POST");
    return register(state, body);
  }
  if (is("auth", "me")) {
    only("GET", "PUT", "PATCH");
    const me = signedIn(user);
    if (method !== "GET") {
      const errors: Record<string, string[]> = {};
      const partial = method === "PATCH";
      if (body.first_name !== undefined || !partial) me.first_name = text(body, "first_name", errors, { optional: true, max: 150 });
      if (body.last_name !== undefined || !partial) me.last_name = text(body, "last_name", errors, { optional: true, max: 150 });
      if (Object.keys(errors).length) throw new HttpError(400, errors);
    }
    return { status: 200, data: userJson(me) };
  }

  const snap = await fetchSnapshot();
  if (is("ticket-types")) {
    only("GET");
    return { status: 200, data: snap.ticket_types };
  }
  if (is("payments", "config")) {
    only("GET");
    return { status: 200, data: { provider: "fake" } };
  }
  if (is("showtimes")) {
    only("GET");
    return { status: 200, data: listShowtimes(snap, params, path) };
  }
  if (is("showtimes", "*")) {
    only("GET");
    return { status: 200, data: showtimeJson(findShow(snap, parts[1])) };
  }
  if (is("showtimes", "*", "seats")) {
    only("GET");
    return { status: 200, data: seatMap(state, snap, findShow(snap, parts[1])) };
  }

  if (is("bookings")) {
    only("GET", "POST");
    const me = signedIn(user);
    if (method === "POST") return holdSeats(state, snap, me, body);
    let mine = state.bookings.filter((b) => b.user === me.id);
    const status = params.get("status");
    if (status) mine = mine.filter((b) => b.status === status);
    mine.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    return { status: 200, data: paginate(mine.map(bookingJson), path, params) };
  }
  if (is("bookings", "*")) {
    only("GET");
    return { status: 200, data: bookingJson(ownBooking(state, signedIn(user), parts[1])) };
  }
  if (is("bookings", "*", "checkout")) {
    only("POST");
    return checkout(state, ownBooking(state, signedIn(user), parts[1]));
  }
  if (is("bookings", "*", "cancel")) {
    only("POST");
    return cancel(state, snap, ownBooking(state, signedIn(user), parts[1]));
  }
  if (is("payments", "fake", "complete")) {
    only("POST");
    return completeFakePayment(state, snap, signedIn(user), body);
  }

  throw new HttpError(404, { detail: "Not found." });
}

/**
 * Answer one API request. `path` is relative to the API root, as passed to
 * `api()`, for example "/showtimes/?date=2026-01-31".
 */
export async function handle(method: string, path: string, body: unknown, token: string | null): Promise<Reply> {
  const [pathname, query = ""] = path.split("?");
  const state = load();
  try {
    const reply = await route(state, method.toUpperCase(), pathname, new URLSearchParams(query), (body ?? {}) as Body, token);
    if (method.toUpperCase() !== "GET" || pathname.includes("/seats")) save(state);
    return reply;
  } catch (err) {
    if (err instanceof HttpError) {
      save(state);
      return { status: err.status, data: err.data };
    }
    throw err;
  }
}
