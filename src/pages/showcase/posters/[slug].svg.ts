/**
 * Showcase mode only: copies of the posters the backend generates, so the
 * published site never points at the backend.
 */
import type { APIRoute } from "astro";
import { catalog, SHOWCASE } from "../../../lib/catalog";

export async function getStaticPaths() {
  if (!SHOWCASE) return [];
  const { posters } = await catalog();
  return Object.entries(posters).map(([slug, source]) => ({ params: { slug }, props: { source } }));
}

export const GET: APIRoute = async ({ props }) => {
  const res = await fetch(props.source);
  if (!res.ok) throw new Error(`GET ${props.source} failed with ${res.status}.`);
  return new Response(await res.text(), { headers: { "Content-Type": "image/svg+xml" } });
};
