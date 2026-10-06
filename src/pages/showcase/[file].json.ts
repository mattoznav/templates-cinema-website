/**
 * Showcase mode only: the programme and seat maps captured at build time,
 * served as a static file to the in-browser backend (src/lib/showcase.ts).
 */
import type { APIRoute } from "astro";
import { SHOWCASE } from "../../lib/catalog";
import { snapshot } from "../../lib/snapshot";

export function getStaticPaths() {
  return SHOWCASE ? [{ params: { file: "snapshot" } }] : [];
}

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await snapshot()), { headers: { "Content-Type": "application/json" } });
