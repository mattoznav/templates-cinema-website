import { showtimesFor, showtimesOn } from "../lib/client";
import { audio, dayKey, longDate, time, upcomingDays } from "../lib/format";
import type { Showtime } from "../lib/types";
import { esc } from "./html";

interface MovieInfo {
  title: string;
  poster: string;
  runtime: string;
  genres: string[];
}

const tz = () => document.documentElement.dataset.tz ?? "UTC";

function chip(s: Showtime): string {
  const extras = [s.hall_format !== "Standard" ? s.hall_format : s.hall_name, s.subtitles ? "Original version" : ""]
    .filter(Boolean)
    .join(", ");
  const label = `${time(s.starts_at, tz())}, ${s.hall_name}, ${audio(s.language, s.subtitles)}`;
  return `<a class="chip" href="/book/?showtime=${s.id}" aria-label="Get tickets for ${esc(s.movie_title)} at ${esc(label)}"${
    s.is_bookable ? "" : ' aria-disabled="true" tabindex="-1"'
  }>
    <span class="chip__time">${time(s.starts_at, tz())}</span>
    <span class="chip__meta">${esc(extras)}</span>
  </a>`;
}

function movieRow(slug: string, info: MovieInfo | undefined, shows: Showtime[]): string {
  const title = info?.title ?? shows[0].movie_title;
  const meta = info ? [info.runtime, info.genres.slice(0, 2).join(", ")].filter(Boolean).join("  /  ") : "";
  return `<article class="row">
    <a class="row__poster" href="/films/${slug}/" tabindex="-1" aria-hidden="true">
      ${info ? `<img src="${esc(info.poster)}" alt="" loading="lazy" width="92" height="138" />` : ""}
    </a>
    <div class="row__text">
      <h3 class="row__title"><a href="/films/${slug}/">${esc(title)}</a></h3>
      <p class="row__meta">${esc(meta)}</p>
      <div class="row__chips">${shows.map(chip).join("")}</div>
    </div>
  </article>`;
}

function errorState(retry: string): string {
  return `<div class="programme__empty">
    <p>Showtimes could not be loaded. Check your connection and try again.</p>
    <button class="btn btn--ghost" type="button" data-retry="${retry}">Try again</button>
  </div>`;
}

async function renderDay(root: HTMLElement, body: HTMLElement, movies: Record<string, MovieInfo>, day: string) {
  body.setAttribute("aria-busy", "true");
  try {
    const shows = await showtimesOn(day);
    const groups = new Map<string, Showtime[]>();
    for (const s of shows) groups.set(s.movie, [...(groups.get(s.movie) ?? []), s]);
    const upcoming = shows.some((s) => s.is_bookable);

    if (!shows.length || !upcoming) {
      const days = root.querySelectorAll<HTMLButtonElement>(".day");
      const next = [...days].findIndex((d) => d.dataset.day === day) + 1;
      body.innerHTML = `<div class="programme__empty">
        <p>No more screenings on this day.</p>
        ${next && days[next] ? `<button class="btn btn--ghost" type="button" data-goto-day="${days[next].dataset.day}">See ${esc(days[next].querySelector(".day__weekday")?.textContent?.toLowerCase() ?? "the next day")}</button>` : ""}
      </div>`;
    } else {
      // Films with a screening still to come first, in order of their next show
      const rows = [...groups.entries()].sort(([, a], [, b]) => {
        const next = (list: Showtime[]) => list.find((s) => s.is_bookable)?.starts_at ?? "9";
        return next(a).localeCompare(next(b));
      });
      body.innerHTML = rows.map(([slug, list]) => movieRow(slug, movies[slug], list)).join("");
    }
  } catch {
    body.innerHTML = errorState(day);
  }
  body.removeAttribute("aria-busy");
}

async function renderMovie(body: HTMLElement, slug: string) {
  try {
    const shows = await showtimesFor(slug);
    const byDay = new Map<string, Showtime[]>();
    for (const s of shows.filter((s) => s.is_bookable)) {
      const key = dayKey(new Date(s.starts_at), tz());
      byDay.set(key, [...(byDay.get(key) ?? []), s]);
    }
    body.innerHTML = byDay.size
      ? [...byDay.values()]
          .map(
            (list) => `<div class="row row--day">
              <h3 class="programme__day-title">${esc(longDate(list[0].starts_at, tz()))}</h3>
              <div class="row__chips">${list.map(chip).join("")}</div>
            </div>`,
          )
          .join("")
      : `<div class="programme__empty"><p>No screenings scheduled at the moment.</p></div>`;
  } catch {
    body.innerHTML = errorState(slug);
  }
}

export function initProgrammes() {
  document.querySelectorAll<HTMLElement>("[data-programme]").forEach((root) => {
    const body = root.querySelector<HTMLElement>("[data-body]")!;
    const movies: Record<string, MovieInfo> = JSON.parse(root.querySelector("[data-movies]")?.textContent ?? "{}");

    if (root.dataset.programme === "movie") {
      const slug = root.dataset.movie!;
      renderMovie(body, slug);
      body.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("[data-retry]")) renderMovie(body, slug);
      });
      return;
    }

    const strip = root.querySelector<HTMLElement>("[data-days-strip]")!;
    const days = upcomingDays(Number(root.dataset.days ?? 7), tz());
    strip.innerHTML = days
      .map(
        (d, i) => `<button class="day" type="button" role="tab" data-day="${d.key}" aria-selected="${i === 0}">
          <span class="day__weekday">${d.weekday}</span><span class="day__date">${d.day}</span>
        </button>`,
      )
      .join("");

    const select = (day: string) => {
      strip.querySelectorAll<HTMLButtonElement>(".day").forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.day === day));
        if (b.dataset.day === day) b.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      renderDay(root, body, movies, day);
    };

    strip.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".day");
      if (btn) select(btn.dataset.day!);
    });
    body.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const day = target.closest<HTMLElement>("[data-goto-day]")?.dataset.gotoDay ?? target.closest<HTMLElement>("[data-retry]")?.dataset.retry;
      if (day) select(day);
    });

    renderDay(root, body, movies, days[0].key);
  });
}
