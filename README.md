# Cinema template: Website

The public website of the cinema: programme, film pages, seat selection, payment and tickets.

Astro, no UI framework. Part of the [`templates-cinema`](https://github.com/mattoznav/templates-cinema) template, inside the [`templates`](https://github.com/mattoznav/templates) collection.

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

## Customising

- Colours, fonts and shapes are design tokens at the top of `src/styles/global.css`.
- The venue name, address and tagline come from the backend (`data/venue.csv`).
- The logo mark is in `src/components/Logo.astro` and `public/favicon.svg`.
- Set the real domain in `astro.config.mjs` (`site`).

## Credits

Film facts come from Wikidata (CC0) and synopses from Wikipedia (CC BY-SA 4.0): each film page links its source. Posters are generated placeholders served by the backend. Icons are [Phosphor](https://phosphoricons.com) (MIT).

## License

The code is released under the [MIT License](LICENSE). Movie synopses shown on the site come from Wikipedia and stay under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
