import { defineConfig } from "astro/config";

export default defineConfig({
  // Replace with the cinema's real domain before going live. The GitHub Pages workflow sets
  // SITE_URL and BASE_PATH to publish the demo under the repository's path.
  site: process.env.SITE_URL ?? "https://cinema.example.com",
  base: process.env.BASE_PATH || "/",
  server: { port: 4321 },
  // Keep demos clean when showing the template
  devToolbar: { enabled: false },
});
