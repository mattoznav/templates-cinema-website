import backIcon from "@phosphor-icons/core/assets/regular/arrow-left.svg?raw";
import wheelchairIcon from "@phosphor-icons/core/assets/regular/wheelchair.svg?raw";
import removeIcon from "@phosphor-icons/core/assets/regular/x.svg?raw";
import {
  ApiError,
  cancelBooking,
  checkout,
  completeFakePayment,
  createBooking,
  getBooking,
  isSignedIn,
  seatMap,
  type Checkout,
} from "../lib/client";
import { audio, longDate, money, time } from "../lib/format";
import type { Booking, SeatMap } from "../lib/types";
import { esc } from "./html";
import { withBase } from "../lib/paths";

const MAX_SEATS = 10;
const CONFIRM_TIMEOUT_MS = 45_000;

type Step = "seats" | "account" | "pay" | "confirming" | "done" | "error";
type Seat = SeatMap["seats"][number];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const tz = () => document.documentElement.dataset.tz ?? "UTC";
const currency = () => document.documentElement.dataset.currency ?? "EUR";
const icon = (svg: string, size = 14) => svg.replace("<svg ", `<svg width="${size}" height="${size}" aria-hidden="true" `);

let map: SeatMap | null = null;
let booking: Booking | null = null;
let payment: Checkout | null = null;
let countdown: number | undefined;
/** seat id -> ticket type code */
const picks = new Map<number, string>();

function show(step: Step) {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => (el.hidden = el.dataset.step !== step));
}

function fail(title: string, text: string) {
  $("[data-error-title]").textContent = title;
  $("[data-error-text]").textContent = text;
  show("error");
}

function message(selector: string, text: string | null) {
  const el = $(selector);
  el.textContent = text ?? "";
  el.hidden = !text;
}

// Header and seat map

function renderHead(m: SeatMap) {
  const s = m.showtime;
  $("[data-head]").innerHTML = `
    <a class="book__back" href="${withBase(`/films/${esc(s.movie)}/`)}">${icon(backIcon, 16)} Back to the film</a>
    <h1 class="book__title">${esc(s.movie_title)}</h1>
    <p class="book__when">${esc(longDate(s.starts_at, tz()))}, ${time(s.starts_at, tz())}. ${esc(s.hall_name)}${
      s.hall_format !== "Standard" ? ` (${esc(s.hall_format)})` : ""
    }. ${esc(audio(s.language, s.subtitles))}.</p>`;
  document.title = `${s.movie_title} tickets | ${document.title.split(" | ").pop()}`;
}

function seatLabel(seat: Seat) {
  const type = seat.type === "standard" ? "" : `, ${seat.type === "wheelchair" ? "wheelchair space" : seat.type}`;
  const state = seat.status === "available" ? money(seat.price, currency()) : "taken";
  return `Row ${seat.row}, seat ${seat.number}${type}, ${state}`;
}

function renderSeats(m: SeatMap, readOnly = false) {
  const rows = new Map<string, Seat[]>();
  for (const seat of m.seats) rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
  // Two aisles split each row into a centre block and two sides
  const aisle = Math.max(2, Math.floor(m.seats_per_row / 4));
  const aisles = new Set([aisle, m.seats_per_row - aisle]);

  $("[data-seats]").innerHTML = [...rows.entries()]
    .map(([row, seats]) => {
      const cells = seats
        .map((seat) => {
          const mine = picks.has(seat.id);
          const free = seat.status === "available" || mine;
          const btn = `<button type="button" class="seat${seat.type === "premium" ? " seat--premium" : ""}" data-seat="${seat.id}"
            data-status="${mine ? "available" : seat.status}" aria-pressed="${mine}" aria-label="${esc(seatLabel(seat))}"
            ${!free || readOnly ? "disabled" : ""}>${seat.type === "wheelchair" ? icon(wheelchairIcon) : ""}</button>`;
          return aisles.has(seat.number) ? `${btn}<span class="map__aisle"></span>` : btn;
        })
        .join("");
      return `<div class="map__row"><span class="map__label">${row}</span>${cells}<span class="map__label">${row}</span></div>`;
    })
    .join("");
}

// Picks panel

function renderPicks() {
  if (!map) return;
  const seats = map.seats.filter((s) => picks.has(s.id));
  const types = map.ticket_types;
  let total = 0;
  $("[data-picks]").innerHTML = seats
    .map((seat) => {
      const chosen = types.find((t) => t.code === picks.get(seat.id)) ?? types[0];
      const price = Math.max(0, Number(seat.price) + Number(chosen.price_delta));
      total += price;
      return `<li>
        <span class="pick__seat">${esc(seat.label)}</span>
        <select data-pick-type="${seat.id}" aria-label="Ticket type for seat ${esc(seat.label)}">
          ${types.map((t) => `<option value="${esc(t.code)}"${t.code === chosen.code ? " selected" : ""}>${esc(t.name)}</option>`).join("")}
        </select>
        <span class="mono">${money(price, currency())}</span>
        <button type="button" class="pick__remove" data-remove="${seat.id}" aria-label="Remove seat ${esc(seat.label)}">${icon(removeIcon, 16)}</button>
      </li>`;
    })
    .join("");
  $("[data-empty-pick]").hidden = seats.length > 0;
  $("[data-total]").hidden = seats.length === 0;
  $("[data-total-value]").textContent = money(total, currency());
  $<HTMLButtonElement>("[data-continue]").disabled = seats.length === 0;
}

function toggle(seatId: number) {
  message("[data-seats-error]", null);
  if (picks.has(seatId)) picks.delete(seatId);
  else if (picks.size >= MAX_SEATS) return message("[data-seats-error]", `You can book up to ${MAX_SEATS} seats at a time.`);
  else picks.set(seatId, map?.ticket_types[0]?.code ?? "adult");
  const btn = $(`[data-seat="${seatId}"]`);
  btn.setAttribute("aria-pressed", String(picks.has(seatId)));
  renderPicks();
}

async function loadMap(showtimeId: number) {
  map = await seatMap(showtimeId);
  // Seats taken by someone else since the last look leave the selection
  for (const seat of map.seats) if (seat.status !== "available" && picks.has(seat.id) && !booking) picks.delete(seat.id);
  renderHead(map);
  renderSeats(map);
  renderPicks();
}

// Holding seats and paying

async function hold() {
  if (!map) return;
  if (!isSignedIn()) return show("account");
  const button = $<HTMLButtonElement>("[data-continue]");
  button.disabled = true;
  try {
    booking = await createBooking(
      map.showtime.id,
      [...picks.entries()].map(([seat, ticket_type]) => ({ seat, ticket_type })),
    );
    history.replaceState(null, "", `?booking=${booking.id}`);
    await startPayment();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return show("account");
    show("seats");
    if (err instanceof ApiError && err.status === 409) {
      const taken = (err.data.seats as string[] | undefined) ?? [];
      await loadMap(map.showtime.id);
      message("[data-seats-error]", `${taken.length > 1 ? "Seats" : "Seat"} ${taken.join(", ")} just went to someone else. Pick again.`);
    } else {
      message("[data-seats-error]", err instanceof ApiError ? err.message : "Could not reach the cinema. Try again.");
    }
  } finally {
    button.disabled = picks.size === 0;
  }
}

function startCountdown(expiresAt: string) {
  window.clearInterval(countdown);
  const out = $("[data-countdown]");
  const tick = () => {
    const left = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    out.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
    $("[data-hold]").toggleAttribute("data-urgent", left < 60_000);
    if (left === 0) {
      window.clearInterval(countdown);
      fail("Time is up", "Your seats were released because the payment was not completed in time. Pick your seats again to book.");
      const again = document.querySelector<HTMLAnchorElement>('[data-step="error"] a');
      if (again && booking) again.href = withBase(`/book/?showtime=${booking.showtime.id}`);
      if (again) again.textContent = "Pick seats again";
    }
  };
  tick();
  countdown = window.setInterval(tick, 1000);
}

async function startPayment() {
  if (!booking) return;
  $("[data-summary]").innerHTML = booking.seats
    .map(
      (s) => `<li><span class="pick__seat">${esc(s.seat)}</span><span>${esc(map?.ticket_types.find((t) => t.code === s.ticket_type)?.name ?? s.ticket_type)}</span><span class="mono">${money(s.price, booking!.currency)}</span></li>`,
    )
    .join("");
  $("[data-pay-total]").textContent = money(booking.total, booking.currency);
  startCountdown(booking.expires_at);
  message("[data-pay-error]", null);
  show("pay");
  if (map) renderSeats(map, true);

  payment = await checkout(booking.id);
  const label = `Pay ${money(payment.amount, payment.currency)}`;
  if (payment.provider === "fake") {
    $("[data-fake]").hidden = false;
    $("[data-fake-pay]").textContent = label;
  } else {
    $("[data-stripe]").hidden = false;
    $("[data-stripe-pay]").textContent = label;
    await mountStripe(payment);
  }
}

async function payFake(outcome: "succeeded" | "failed") {
  if (!payment) return;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-fake] button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    const result = await completeFakePayment(payment.payment_id, outcome);
    if (result.booking_status === "confirmed") return finish();
    message("[data-pay-error]", "Your card was declined. No money was taken. Try again or use another card.");
    payment = await checkout(booking!.id); // a fresh attempt for the retry
  } catch (err) {
    message("[data-pay-error]", err instanceof ApiError ? err.message : "Payment could not be completed. Try again.");
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// Stripe: loaded only when the backend uses it

declare global {
  interface Window {
    Stripe?: (key: string) => any;
  }
}

let stripe: any;
let elements: any;

function loadStripeJs(): Promise<void> {
  if (window.Stripe) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Stripe could not be loaded."));
    document.head.append(script);
  });
}

async function mountStripe(p: Checkout) {
  await loadStripeJs();
  stripe = window.Stripe!(p.publishable_key!);
  elements = stripe.elements({
    clientSecret: p.client_secret,
    appearance: { theme: "night", variables: { colorPrimary: "#ffcf4a", borderRadius: "8px" } },
  });
  elements.create("payment").mount("[data-stripe-element]");
}

async function payStripe(e: SubmitEvent) {
  e.preventDefault();
  const button = $<HTMLButtonElement>("[data-stripe-pay]");
  button.disabled = true;
  const { error } = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: location.href } });
  button.disabled = false;
  if (error) return message("[data-pay-error]", error.message ?? "Payment could not be completed.");
  // Stripe confirms to the backend through a webhook: wait for it
  show("confirming");
  const started = Date.now();
  while (Date.now() - started < CONFIRM_TIMEOUT_MS) {
    const latest = await getBooking(booking!.id);
    if (latest.status === "confirmed") return finish(latest);
    if (latest.status !== "pending") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  fail(
    "Still confirming",
    "Your payment went through but the confirmation is taking longer than usual. Your tickets will appear in your account shortly.",
  );
}

async function finish(latest?: Booking) {
  window.clearInterval(countdown);
  booking = latest ?? (await getBooking(booking!.id));
  $("[data-reference]").textContent = booking.reference;
  show("done");
}

async function cancelHold() {
  if (!booking) return;
  const showtimeId = booking.showtime.id;
  try {
    await cancelBooking(booking.id);
  } catch {
    // Already expired or cancelled: either way the seats are free again
  }
  window.clearInterval(countdown);
  booking = null;
  payment = null;
  picks.clear();
  $("[data-fake]").hidden = true;
  $("[data-stripe]").hidden = true;
  history.replaceState(null, "", `?showtime=${showtimeId}`);
  await loadMap(showtimeId);
  show("seats");
}

// Entry point

async function resume(bookingId: number) {
  if (!isSignedIn()) {
    show("account");
    window.addEventListener("auth-change", () => isSignedIn() && resume(bookingId), { once: true });
    return;
  }
  booking = await getBooking(bookingId);
  for (const s of booking.seats) {
    const seat = (map ??= await seatMap(booking.showtime.id)).seats.find((x) => x.label === s.seat);
    if (seat) picks.set(seat.id, s.ticket_type);
  }
  renderHead(map!);
  renderSeats(map!, true);
  if (booking.status === "confirmed") return finish(booking);
  if (booking.status !== "pending" || new Date(booking.expires_at) <= new Date()) {
    return fail("This booking has expired", "The seats were released. Pick them again to book.");
  }
  await startPayment();
}

export async function initBooking() {
  const params = new URLSearchParams(location.search);
  const showtimeId = Number(params.get("showtime"));
  const bookingId = Number(params.get("booking"));

  $("[data-seats]").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-seat]");
    if (btn && !btn.disabled) toggle(Number(btn.dataset.seat));
  });
  $("[data-picks]").addEventListener("change", (e) => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>("[data-pick-type]");
    if (select) picks.set(Number(select.dataset.pickType), select.value);
    renderPicks();
  });
  $("[data-picks]").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
    if (btn) toggle(Number(btn.dataset.remove));
  });
  $("[data-continue]").addEventListener("click", hold);
  $("[data-to-seats]").addEventListener("click", () => show("seats"));
  $("[data-fake-pay]").addEventListener("click", () => payFake("succeeded"));
  $("[data-fake-decline]").addEventListener("click", () => payFake("failed"));
  $<HTMLFormElement>("[data-stripe]").addEventListener("submit", payStripe);
  $("[data-cancel-hold]").addEventListener("click", cancelHold);
  // Signing in from the account step carries straight on with the booking
  window.addEventListener("auth-change", () => {
    if (isSignedIn() && !$('[data-step="account"]').hidden && !booking && map) hold();
  });

  try {
    if (bookingId) return await resume(bookingId);
    if (!showtimeId) return fail("No showtime selected", "Pick a film and a time from the programme to book seats.");
    await loadMap(showtimeId);
    if (!map!.showtime.is_bookable) {
      renderSeats(map!, true);
      return fail("This show has started", "Online booking closes when the film begins. Pick another time.");
    }
    show("seats");
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return fail("Showtime not found", "This showtime does not exist anymore. Pick another one.");
    fail("Booking unavailable", "Could not reach the cinema. Check your connection and try again.");
  }
}
