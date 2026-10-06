# Cinema template: Website

The public website of the cinema: programme, film pages, seat selection, payment and tickets.

Astro, no UI framework. Part of the [`templates-cinema`](https://github.com/mattoznav/templates-cinema) template, inside the [`templates`](https://github.com/mattoznav/templates) collection.

Live demo: [mattoznav.github.io/templates-cinema-website](https://mattoznav.github.io/templates-cinema-website/) (a static showcase, see [Showcase mode](#showcase-mode))

## Requirements

- Node.js 22.12 or newer and npm
- The backend running locally (see its README)

## Quick start

The website needs the [backend](https://github.com/mattoznav/templates-cinema-backend) running, by default on `http://localhost:8000`.

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:4321`.

Check types and templates with `npm run check`; `npm run build` produces the static site in `dist/`.

## What is static and what is live

| Part | When it is loaded |
| --- | --- |
| Film pages, film list, venue, prices | At build time, from the API. Rebuild after editing films in the admin. |
| Showtimes, seat maps, availability | Live, in the browser, on every visit |
| Account, bookings, payments, tickets | Live, in the browser |

So the pages are fast and cacheable, while anything that changes by the minute is always current.
To publish new films automatically, trigger a rebuild from the admin (for example with a deploy hook).

## Pages

| Path | What it does |
| --- | --- |
| `/` | Featured film, today's programme, films in cinemas, coming soon, screens |
| `/programme/` | Two weeks of showtimes, day by day |
| `/films/` | All films, filterable by genre |
| `/films/<slug>/` | Film details, trailer, live showtimes |
| `/book/?showtime=<id>` | Seat map, ticket types, sign in, payment |
| `/book/?booking=<id>` | Resume paying for seats already held |
| `/account/` | Sign in or register, bookings, ticket QR codes, cancellations |
| `/visit/` | Address, screens and prices |

## Payments

The website follows whatever the backend uses:

- **Fake provider** (default): a demo panel with "Pay" and "Simulate a declined card". No money moves.
- **Stripe**: the Stripe Payment Element is loaded on demand and the page waits for the backend webhook to confirm the booking. Use test mode keys and [test cards](https://docs.stripe.com/testing) to try it.

## Showcase mode

The live demo runs on GitHub Pages, which only serves static files, so the backend is not there. Building with `PUBLIC_SHOWCASE=true` produces a site that still works end to end: programme, seat maps, sign up and sign in, booking, payment, tickets with QR codes and cancellation.

```bash
PUBLIC_SHOWCASE=true npm run build
```

The backend is still needed while building. On top of the usual catalogue, the build then:

- captures every showtime of the next 14 days (including today's past ones) and each seat map into `dist/showcase/snapshot.json` (`src/lib/snapshot.ts`, `src/pages/showcase/[file].json.ts`). Hall layouts are stored once; each showtime only keeps its taken seats;
- copies the generated posters into `dist/showcase/posters/`, so the site never points at the backend.

In the browser, `api()` (`src/lib/client.ts`) sends every request to `src/lib/showcase.ts` instead of the network. It answers like the backend, with the same responses, errors and booking rules (hold time, seat limit, prices, cancellation cutoff, replacing an unpaid selection):

| Part | In showcase mode |
| --- | --- |
| Showtimes, seat maps | From the snapshot, moved forward by whole days so it always starts today. Seats taken in the snapshot stay taken. |
| Accounts | Kept in this browser's `localStorage` (`cinema.showcase`), passwords as salted SHA-256 hashes |
| Bookings, tickets | Kept in this browser; they mark their seats as held or sold |
| Payments | Always the fake provider: no money moves |

A slim notice at the top of every page tells visitors about it. Without `PUBLIC_SHOWCASE`, none of this is built or shipped, and the site talks to the backend as usual.

## Publish on GitHub Pages

`.github/workflows/pages.yml` builds the showcase and publishes it on GitHub Pages at every push to `main` and once a day, so the captured programme stays current. The job checks out the [backend](https://github.com/mattoznav/templates-cinema-backend), loads its demo data (`manage.py bootstrap`), starts it on `localhost:8000` and builds the site against it with `PUBLIC_SHOWCASE=true`.

To use it in a copy of the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**. The workflow passes the Pages address to the build through `SITE_URL` and `BASE_PATH`, so the site works under `https://<user>.github.io/<repository>/`; with a custom domain the path is simply `/`. Internal links go through `withBase()` (`src/lib/paths.ts`) for this reason.

## Customising

- Colours, fonts and shapes are design tokens at the top of `src/styles/global.css`.
- The venue name, address and tagline come from the backend (`data/venue.csv`).
- The logo mark is in `src/components/Logo.astro` and `public/favicon.svg`.
- Set the real domain in `astro.config.mjs` (`site`).

## Structure

```
src/pages/                 Home, programme, films, booking, account, visit, 404
src/pages/showcase/        Showcase mode only: snapshot and poster files
src/components/            Header, footer, programme, poster cards, sign-in form
src/layouts/Base.astro     Page shell and the showcase notice
src/scripts/               Browser code: programme, booking flow, sign-in form
src/lib/catalog.ts         Build-time data from the API
src/lib/client.ts          Browser API client: accounts, showtimes, bookings
src/lib/snapshot.ts        Showcase mode: captures programme and seat maps at build time
src/lib/showcase.ts        Showcase mode: the backend's stand-in in the browser
src/lib/paths.ts           withBase(), for paths that must follow the site's base
src/styles/global.css      Design tokens and shared styles
.github/workflows/         GitHub Pages deployment
```

## Credits

Film facts come from Wikidata (CC0) and synopses from Wikipedia (CC BY-SA 4.0): each film page links its source. Posters are generated placeholders served by the backend. Icons are [Phosphor](https://phosphoricons.com) (MIT).

## License

The code is released under the [MIT License](LICENSE). Movie synopses shown on the site come from Wikipedia and stay under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
