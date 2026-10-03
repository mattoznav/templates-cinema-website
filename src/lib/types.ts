export interface Venue {
  name: string;
  tagline: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  email: string;
  phone: string;
  timezone: string;
  currency: string;
}

export interface Movie {
  id: number;
  slug: string;
  title: string;
  status: "now_showing" | "coming_soon" | "archive";
  release_date: string | null;
  runtime_minutes: number | null;
  synopsis: string;
  genres: string[];
  /** Display names of `genres`, added at build time */
  genre_names: string[];
  directors: string[];
  cast: string[];
  countries: string[];
  languages: string[];
  poster: string;
  trailer_youtube_id: string;
  trailer_url: string;
  popularity: number;
  source_url: string;
}

export interface Genre {
  id: number;
  slug: string;
  name: string;
}

export interface Hall {
  id: number;
  name: string;
  format: string;
  rows: number;
  seats_per_row: number;
  base_price: string;
  capacity: number;
}

export interface SeatType {
  code: string;
  name: string;
  surcharge: string;
}

export interface TicketType {
  code: string;
  name: string;
  description: string;
  price_delta: string;
}

export interface Showtime {
  id: number;
  movie: string;
  movie_title: string;
  hall: number;
  hall_name: string;
  hall_format: string;
  starts_at: string;
  ends_at: string;
  price: string;
  language: string;
  subtitles: string;
  is_bookable: boolean;
}

export interface SeatMap {
  showtime: Showtime;
  rows: number;
  seats_per_row: number;
  ticket_types: TicketType[];
  seats: {
    id: number;
    row: string;
    number: number;
    label: string;
    type: string;
    price: string;
    status: "available" | "held" | "sold";
  }[];
}

export interface Booking {
  id: number;
  reference: string;
  status: "pending" | "confirmed" | "cancelled" | "expired";
  showtime: {
    id: number;
    starts_at: string;
    movie: { slug: string; title: string };
    hall: { id: number; name: string; format: string };
  };
  seats: {
    seat: string;
    seat_type: string;
    ticket_type: string;
    price: string;
    ticket: { code: string; checked_in_at: string | null } | null;
  }[];
  total: string;
  currency: string;
  expires_at: string;
  created_at: string;
  can_cancel: boolean;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  results: T[];
}
