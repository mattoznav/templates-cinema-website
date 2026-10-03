import { defineConfig } from "astro/config";

export default defineConfig({
  // Replace with the cinema's real domain before going live
  site: "https://cinema.example.com",
  server: { port: 4321 },
  // Keep demos clean when showing the template
  devToolbar: { enabled: false },
});
